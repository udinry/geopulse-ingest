import type { ArticleRow, AssetPriceRow, AssetRow, EventRow, OutlookMarketRow, SituationOutlookRow, SituationRow } from "../shared/types.js";
import { randomUUID } from "node:crypto";
import { buildNowSnapshot, encodeSnapshot, type NowSnapshot } from "../emit/snapshot.js";
import { serializeAsset, serializeAssetSearchResult, serializeOutlook, serializeSearchResult } from "../emit/publicSerializer.js";
import { isOutlookEnabled } from "../outlook/controls.js";
import { setManualOutlookLink, setOutlookKillSwitch } from "../outlook/controls.js";

export interface Queryable {
  all<T>(sql: string, ...bindings: unknown[]): Promise<T[]>;
  first<T>(sql: string, ...bindings: unknown[]): Promise<T | null>;
  run(sql: string, ...bindings: unknown[]): Promise<void>;
}

export interface APIEnvironment {
  db: Queryable;
  now?: () => string;
  opsKey?: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=60, stale-while-revalidate=300",
};

function etag(body: string): string {
  let hash = 2166136261;
  for (let index = 0; index < body.length; index++) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `"${(hash >>> 0).toString(16)}"`;
}

function jsonResponse(body: unknown, request: Request, status = 200): Response {
  const encoded = JSON.stringify(body);
  const tag = etag(encoded);
  if (request.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers: { etag: tag, ...JSON_HEADERS } });
  return new Response(encoded, { status, headers: { etag: tag, ...JSON_HEADERS } });
}

function errorResponse(message: string, status: number, request: Request): Response {
  return jsonResponse({ error: message }, request, status);
}

async function loadNow(env: APIEnvironment, generatedAt: string): Promise<NowSnapshot> {
  const situations = await env.db.all<SituationRow>(
    "SELECT id, title, category, lat, lon, country_iso, status, first_seen_at, last_event_at, trending_score, event_count, source_count, map_rank FROM situations WHERE status IN ('active', 'recent') AND map_rank IS NOT NULL ORDER BY map_rank ASC",
  );
  const assets = await env.db.all<AssetRow>(
    "SELECT id, symbol, name, class, currency, license_class, is_delayed, delay_minutes FROM assets WHERE license_class = 'green' ORDER BY symbol ASC",
  );
  const quotes = await env.db.all<AssetPriceRow & { rn: number }>(
    "SELECT asset_id, ts, price, change_pct, as_of, session_state, ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY ts DESC) AS rn FROM asset_prices WHERE asset_id IN (SELECT id FROM assets WHERE license_class = 'green')",
  );
  const latestQuotes = new Map(quotes.filter((quote) => quote.rn === 1).map((quote) => [quote.asset_id, quote]));
  return buildNowSnapshot({ generatedAt, situations, assets, latestQuotes });
}

async function loadSituation(env: APIEnvironment, id: string, regionISO: string | null): Promise<Record<string, unknown> | null> {
  const situation = await env.db.first<SituationRow>(
    "SELECT id, title, category, lat, lon, country_iso, status, first_seen_at, last_event_at, trending_score, event_count, source_count, map_rank FROM situations WHERE id = ?",
    id,
  );
  if (situation === null) return null;
  const outlookEnabled = await isOutlookEnabled(env.db, regionISO);
  const [events, news, outlookRows, outlookLinks] = await Promise.all([
    env.db.all<EventRow>("SELECT e.id, e.category, e.quad_class, e.goldstein, e.actor1_name, e.actor2_name, e.geo_name, e.occurred_at, e.num_mentions, e.num_sources FROM events e JOIN situation_events se ON se.event_id = e.id WHERE se.situation_id = ? ORDER BY e.occurred_at DESC", id),
    env.db.all<ArticleRow & { source_name: string }>("SELECT a.id, a.source_id, a.url_canonical, a.url_hash, a.title, a.title_norm, a.title_simhash, a.excerpt, a.published_at, a.fetched_at, a.lang, a.country_iso, a.dedup_group_id, a.publisher_domain, a.publisher_name, s.name AS source_name FROM articles a JOIN event_articles ea ON ea.article_id = a.id JOIN situation_events se ON se.event_id = ea.event_id JOIN sources s ON s.id = a.source_id WHERE se.situation_id = ? GROUP BY a.id ORDER BY a.published_at DESC", id),
    outlookEnabled ? env.db.all<OutlookMarketRow>("SELECT om.* FROM outlook_markets om JOIN situation_outlook so ON so.market_id = om.id WHERE so.situation_id = ? AND om.is_resolved = 0", id) : Promise.resolve([]),
    outlookEnabled ? env.db.all<SituationOutlookRow>("SELECT * FROM situation_outlook WHERE situation_id = ?", id) : Promise.resolve([]),
  ]);
  const linksByMarket = new Map(outlookLinks.map((link) => [link.market_id, link]));
  return {
    ...buildNowSnapshot({ generatedAt: env.now?.() ?? new Date().toISOString(), situations: [situation], assets: [], latestQuotes: new Map() }).situations[0],
    events: events.map((event) => ({ ...event, quadClass: event.quad_class, actor1Name: event.actor1_name, actor2Name: event.actor2_name, geoName: event.geo_name, occurredAt: event.occurred_at, numMentions: event.num_mentions, numSources: event.num_sources })),
    news: news.filter((article) => article.published_at !== null).map((article) => ({ id: article.id, sourceName: article.source_name, headline: article.title, excerpt: article.excerpt, publishedAt: article.published_at, url: article.url_canonical })),
    outlook: outlookRows.map((market) => { const link = linksByMarket.get(market.id); return link === undefined ? null : serializeOutlook(market, link); }).filter((outlook) => outlook !== null),
    assets: [],
  };
}

async function body<T>(request: Request): Promise<T> {
  return await request.json() as T;
}

function deviceID(request: Request): string | null {
  const value = request.headers.get("x-device-id")?.trim();
  return value === undefined || value === "" ? null : value;
}

function isAuthorizedOpsRequest(request: Request, env: APIEnvironment): boolean {
  const configured = env.opsKey;
  return configured !== undefined && request.headers.get("authorization") === `Bearer ${configured}`;
}

export async function handleRequest(request: Request, env: APIEnvironment): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "POST" && url.pathname === "/v1/internal/outlook/kill-switch") {
      if (!isAuthorizedOpsRequest(request, env)) return errorResponse("unauthorized", 401, request);
      const input = await body<{ regionISO: string; enabled: boolean; reason?: string | null }>(request);
      if (!input.regionISO || typeof input.enabled !== "boolean") return errorResponse("regionISO and enabled are required", 400, request);
      await setOutlookKillSwitch(env.db, input.regionISO, input.enabled, input.reason ?? null, env.now?.() ?? new Date().toISOString());
      return jsonResponse({ regionISO: input.regionISO.toUpperCase(), enabled: input.enabled }, request);
    }
    if (request.method === "POST" && url.pathname === "/v1/internal/outlook/manual-link") {
      if (!isAuthorizedOpsRequest(request, env)) return errorResponse("unauthorized", 401, request);
      const input = await body<{ situationID: string; marketID: string; verified: boolean }>(request);
      if (!input.situationID || !input.marketID || typeof input.verified !== "boolean") return errorResponse("situationID, marketID, and verified are required", 400, request);
      await setManualOutlookLink(env.db, input.situationID, input.marketID, input.verified);
      return jsonResponse({ situationID: input.situationID, marketID: input.marketID, verified: input.verified }, request);
    }
    if (request.method === "POST" && url.pathname === "/v1/devices") {
      const input = await body<{ id?: string; apnsToken?: string; regionISO?: string | null; isPro?: boolean }>(request);
      if (!input.id || !input.apnsToken) return errorResponse("id and apnsToken are required", 400, request);
      const now = env.now?.() ?? new Date().toISOString();
      await env.db.run("DELETE FROM devices WHERE apns_token = ? AND id != ?", input.apnsToken, input.id);
      await env.db.run("INSERT INTO devices (id, apns_token, region_iso, is_pro, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET apns_token = excluded.apns_token, region_iso = excluded.region_iso, is_pro = excluded.is_pro, last_seen_at = excluded.last_seen_at", input.id, input.apnsToken, input.regionISO ?? null, input.isPro === true ? 1 : 0, now, now);
      return jsonResponse({ id: input.id }, request, 201);
    }
    if (request.method === "POST" && url.pathname === "/v1/alerts") {
      const device = deviceID(request);
      if (device === null) return errorResponse("x-device-id is required", 401, request);
      const input = await body<{ kind: string; subjectType: string; subjectID: string; operator: string; threshold: number; windowMinutes?: number | null; liveActivity?: boolean; cooldownMinutes?: number }>(request);
      if (!input.kind || !input.subjectType || !input.subjectID || !input.operator || !Number.isFinite(input.threshold)) return errorResponse("invalid alert rule", 400, request);
      const owner = await env.db.first<{ id: string }>("SELECT id FROM devices WHERE id = ?", device);
      if (owner === null) return errorResponse("device not found", 404, request);
      const id = randomUUID();
      await env.db.run("INSERT INTO alerts (id, device_id, kind, subject_type, subject_id, operator, threshold, window_minutes, live_activity, cooldown_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, device, input.kind, input.subjectType, input.subjectID, input.operator, input.threshold, input.windowMinutes ?? null, input.liveActivity === true ? 1 : 0, input.cooldownMinutes ?? 15);
      return jsonResponse({ id }, request, 201);
    }
    if (request.method === "GET" && url.pathname === "/v1/alerts") {
      const device = deviceID(request);
      if (device === null) return errorResponse("x-device-id is required", 401, request);
      return jsonResponse({ alerts: await env.db.all("SELECT id, kind, subject_type AS subjectType, subject_id AS subjectID, operator, threshold, window_minutes AS windowMinutes, live_activity AS liveActivity, is_active AS isActive, last_fired_at AS lastFiredAt, cooldown_minutes AS cooldownMinutes FROM alerts WHERE device_id = ? ORDER BY id", device) }, request);
    }
    if ((request.method === "PATCH" || request.method === "DELETE") && url.pathname.startsWith("/v1/alerts/")) {
      const device = deviceID(request);
      if (device === null) return errorResponse("x-device-id is required", 401, request);
      const id = decodeURIComponent(url.pathname.slice("/v1/alerts/".length));
      if (request.method === "DELETE") {
        await env.db.run("DELETE FROM alerts WHERE id = ? AND device_id = ?", id, device);
        return new Response(null, { status: 204 });
      }
      const input = await body<{ isActive?: boolean; liveActivity?: boolean }>(request);
      await env.db.run("UPDATE alerts SET is_active = COALESCE(?, is_active), live_activity = COALESCE(?, live_activity) WHERE id = ? AND device_id = ?", input.isActive === undefined ? null : input.isActive ? 1 : 0, input.liveActivity === undefined ? null : input.liveActivity ? 1 : 0, id, device);
      return jsonResponse({ id }, request);
    }
    if (request.method !== "GET") return errorResponse("method not allowed", 405, request);
    if (url.pathname === "/v1/now") return jsonResponse(await loadNow(env, env.now?.() ?? new Date().toISOString()), request);
    if (url.pathname.startsWith("/v1/situation/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/situation/".length));
      const detail = await loadSituation(env, id, request.headers.get("x-region-iso"));
      return detail === null ? errorResponse("situation not found", 404, request) : jsonResponse(detail, request);
    }
    if (url.pathname === "/v1/search") {
      const query = url.searchParams.get("q")?.trim() ?? "";
      if (query.length < 2) return jsonResponse({ query, sections: { situations: [], assets: [] } }, request);
      const [results, assets] = await Promise.all([
        env.db.all<SituationRow>("SELECT id, title, category, trending_score FROM situations WHERE title LIKE ? ORDER BY trending_score DESC LIMIT 20", `%${query}%`),
        env.db.all<AssetRow>("SELECT id, symbol, name, class FROM assets WHERE license_class = 'green' AND (symbol LIKE ? OR name LIKE ?) ORDER BY symbol ASC LIMIT 20", `%${query}%`, `%${query}%`),
      ]);
      return jsonResponse({ query, sections: { situations: results.map(serializeSearchResult), assets: assets.map((asset) => serializeAssetSearchResult(asset, 1)) } }, request);
    }
    if (url.pathname === "/v1/markets") {
      const assets = await env.db.all<AssetRow>("SELECT id, symbol, name, class, currency, license_class, is_delayed, delay_minutes FROM assets WHERE license_class = 'green' ORDER BY symbol ASC");
      const quotes = await env.db.all<AssetPriceRow & { rn: number }>(
        "SELECT asset_id, ts, price, change_pct, as_of, session_state, ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY ts DESC) AS rn FROM asset_prices WHERE asset_id IN (SELECT id FROM assets WHERE license_class = 'green')",
      );
      const latestQuotes = new Map(quotes.filter((quote) => quote.rn === 1).map((quote) => [quote.asset_id, quote]));
      return jsonResponse({ generatedAt: env.now?.() ?? new Date().toISOString(), assets: assets.map((asset) => serializeAsset(asset, latestQuotes.get(asset.id) ?? null)) }, request);
    }
    return errorResponse("not found", 404, request);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "internal error", 500, request);
  }
}

export { etag };

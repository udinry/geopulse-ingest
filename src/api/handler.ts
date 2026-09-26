import type { ArticleRow, AssetPriceRow, AssetRow, EventCategory, EventRow, OutlookMarketRow, SituationOutlookRow, SituationRow } from "../shared/types.js";
import { randomUUID } from "node:crypto";
import { buildNowSnapshot, encodeSnapshot, type NowSnapshot } from "../emit/snapshot.js";
import { serializeAsset, serializeAssetSearchResult, serializeOutlook, serializeSearchResult } from "../emit/publicSerializer.js";
import { isOutlookEnabled } from "../outlook/controls.js";
import { linkAssets } from "../link/assetLinks.js";
import { COMPANIES, linkCompanies, quoteURL } from "../link/companyLinks.js";
import { WATCHABLE_ASSETS } from "../link/assetLinks.js";
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

type PublicAssetView = ReturnType<typeof serializeAsset>;

/** Green (licensed-for-display) assets with their latest quote; a missing change is derived from the previous day only when one exists. */
async function loadMarketAssets(env: APIEnvironment, now: string): Promise<PublicAssetView[]> {
  const assets = await env.db.all<AssetRow>("SELECT id, symbol, name, class, currency, license_class, is_delayed, delay_minutes FROM assets WHERE license_class = 'green' ORDER BY symbol ASC");
  // Only the two newest observations per asset are needed: the latest quote, and (for sources that publish no
  // change of their own, e.g. ECB/EIA daily rates) the previous one to derive an honest day-on-day change.
  const quotes = await env.db.all<AssetPriceRow & { rn: number }>(
    "SELECT asset_id, ts, price, change_pct, as_of, session_state, rn FROM (SELECT asset_id, ts, price, change_pct, as_of, session_state, ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY ts DESC) AS rn FROM asset_prices WHERE ts >= ? AND asset_id IN (SELECT id FROM assets WHERE license_class = 'green')) WHERE rn <= 2",
    new Date(Date.parse(now) - 14 * 86_400_000).toISOString(),
  );
  const latestQuotes = new Map(quotes.filter((quote) => quote.rn === 1).map((quote) => [quote.asset_id, quote]));
  const previousQuotes = new Map(quotes.filter((quote) => quote.rn === 2).map((quote) => [quote.asset_id, quote]));
  const withChange = (assetId: string): AssetPriceRow | null => {
    const latest = latestQuotes.get(assetId);
    if (latest === undefined) return null;
    const previous = previousQuotes.get(assetId);
    if (latest.change_pct !== null || previous === undefined || previous.price === 0) return latest;
    return { ...latest, change_pct: ((latest.price - previous.price) / previous.price) * 100 };
  };
  return assets.map((asset) => serializeAsset(asset, withChange(asset.id)));
}

async function loadSituation(env: APIEnvironment, id: string, regionISO: string | null): Promise<Record<string, unknown> | null> {
  const situation = await env.db.first<SituationRow>(
    "SELECT id, title, category, lat, lon, geo_name, country_iso, status, first_seen_at, last_event_at, trending_score, event_count, source_count, map_rank FROM situations WHERE id = ?",
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
  const now = env.now?.() ?? new Date().toISOString();
  const marketBySymbol = new Map((await loadMarketAssets(env, now)).map((asset) => [asset.symbol, asset]));
  const impactedAssets = linkAssets(situation).flatMap((link) => {
    const asset = marketBySymbol.get(link.symbol);
    return asset === undefined ? [] : [{ ...asset, rationale: link.rationale }];
  });
  return {
    ...buildNowSnapshot({ generatedAt: env.now?.() ?? new Date().toISOString(), situations: [situation], assets: [], latestQuotes: new Map() }).situations[0],
    events: events.map((event) => ({ ...event, quadClass: event.quad_class, actor1Name: event.actor1_name, actor2Name: event.actor2_name, geoName: event.geo_name, occurredAt: event.occurred_at, numMentions: event.num_mentions, numSources: event.num_sources })),
    news: news.filter((article) => article.published_at !== null).map((article) => ({ id: article.id, sourceName: article.publisher_name ?? article.publisher_domain ?? article.source_name, headline: article.title, excerpt: article.excerpt, publishedAt: article.published_at, url: article.url_canonical })),
    outlook: outlookRows.map((market) => { const link = linksByMarket.get(market.id); return link === undefined ? null : serializeOutlook(market, link); }).filter((outlook) => outlook !== null),
    assets: [],
    impactedAssets,
    companies: linkCompanies(situation),
  };
}

function searchCompanies(query: string) {
  const needle = query.toLowerCase();
  return Object.values(COMPANIES)
    .filter((company) => company.symbol.toLowerCase().includes(needle) || company.name.toLowerCase().includes(needle))
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .slice(0, 20)
    .map((company) => ({ symbol: company.symbol, name: company.name, exchange: company.exchange, country: company.country, quoteURL: quoteURL(company) }));
}

const MAX_WATCHES = 50;
const ALERT_KINDS = new Set(["price", "percent", "velocity", "situation", "outlook"]);
const ALERT_SUBJECTS = new Set(["asset", "situation", "market"]);
const ALERT_OPERATORS = new Set(["gt", "gte", "lt", "lte", "crosses"]);

async function replaceWatches(env: APIEnvironment, device: string, request: Request): Promise<Response> {
  const input = await body<{ watches?: Array<{ kind?: string; symbol?: string; exchange?: string }> }>(request);
  if (!Array.isArray(input.watches) || input.watches.length > MAX_WATCHES) return errorResponse(`watches must be an array of at most ${MAX_WATCHES}`, 400, request);
  const clean: Array<{ kind: "company" | "asset"; symbol: string; exchange: string }> = [];
  for (const watch of input.watches) {
    const exchange = watch.exchange ?? "";
    const valid = watch.kind === "company"
      ? watch.symbol !== undefined && COMPANIES[watch.symbol]?.exchange === exchange
      : watch.kind === "asset" && watch.symbol !== undefined && watch.symbol in WATCHABLE_ASSETS && exchange === "";
    if (!valid) return errorResponse("unknown watch target", 400, request);
    clean.push({ kind: watch.kind as "company" | "asset", symbol: watch.symbol as string, exchange });
  }
  const owner = await env.db.first<{ id: string }>("SELECT id FROM devices WHERE id = ?", device);
  if (owner === null) return errorResponse("device not found", 404, request);
  const now = env.now?.() ?? new Date().toISOString();
  const existing = await env.db.all<{ kind: string; symbol: string; exchange: string; created_at: string }>("SELECT kind, symbol, exchange, created_at FROM device_watches WHERE device_id = ?", device);
  const createdAt = new Map(existing.map((row) => [`${row.kind}|${row.symbol}|${row.exchange}`, row.created_at]));
  await env.db.run("DELETE FROM device_watches WHERE device_id = ?", device);
  for (const watch of clean) {
    await env.db.run("INSERT OR IGNORE INTO device_watches (device_id, kind, symbol, exchange, created_at) VALUES (?, ?, ?, ?, ?)", device, watch.kind, watch.symbol, watch.exchange, createdAt.get(`${watch.kind}|${watch.symbol}|${watch.exchange}`) ?? now);
  }
  return jsonResponse({ count: clean.length }, request);
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
    if (request.method === "DELETE" && url.pathname.startsWith("/v1/devices/")) {
      const target = decodeURIComponent(url.pathname.slice("/v1/devices/".length));
      // Device-scoped identity: a device may delete only itself. This is the data-deletion control.
      if (deviceID(request) !== target) return errorResponse("x-device-id must match the device being deleted", 403, request);
      await env.db.run("DELETE FROM alert_deliveries WHERE alert_id IN (SELECT id FROM alerts WHERE device_id = ?)", target);
      await env.db.run("DELETE FROM alerts WHERE device_id = ?", target);
      await env.db.run("DELETE FROM watch_deliveries WHERE device_id = ?", target);
      await env.db.run("DELETE FROM device_watches WHERE device_id = ?", target);
      await env.db.run("DELETE FROM devices WHERE id = ?", target);
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && url.pathname === "/v1/alerts") {
      const device = deviceID(request);
      if (device === null) return errorResponse("x-device-id is required", 401, request);
      const input = await body<{ kind: string; subjectType: string; subjectID: string; operator: string; threshold: number; windowMinutes?: number | null; liveActivity?: boolean; cooldownMinutes?: number }>(request);
      if (!input.kind || !input.subjectType || !input.subjectID || !input.operator || !Number.isFinite(input.threshold)) return errorResponse("invalid alert rule", 400, request);
      if (!ALERT_KINDS.has(input.kind) || !ALERT_SUBJECTS.has(input.subjectType) || !ALERT_OPERATORS.has(input.operator)) return errorResponse("unsupported alert kind, subject, or operator", 400, request);
      if (input.subjectType === "asset" && await env.db.first("SELECT id FROM assets WHERE id = ? AND license_class = 'green'", input.subjectID) === null) return errorResponse("unknown or unlicensed asset", 400, request);
      const owner = await env.db.first<{ id: string }>("SELECT id FROM devices WHERE id = ?", device);
      if (owner === null) return errorResponse("device not found", 404, request);
      const id = randomUUID();
      await env.db.run("INSERT INTO alerts (id, device_id, kind, subject_type, subject_id, operator, threshold, window_minutes, live_activity, cooldown_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, device, input.kind, input.subjectType, input.subjectID, input.operator, input.threshold, input.windowMinutes ?? null, input.liveActivity === true ? 1 : 0, input.cooldownMinutes ?? 15);
      return jsonResponse({ id }, request, 201);
    }
    if (request.method === "PUT" && url.pathname === "/v1/watches") {
      const device = deviceID(request);
      if (device === null) return errorResponse("x-device-id is required", 401, request);
      return await replaceWatches(env, device, request);
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
      if (query.length < 2) return jsonResponse({ query, sections: { situations: [], assets: [], companies: [] } }, request);
      const [results, assets] = await Promise.all([
        env.db.all<SituationRow>("SELECT id, title, category, trending_score FROM situations WHERE title LIKE ? ORDER BY trending_score DESC LIMIT 20", `%${query}%`),
        env.db.all<AssetRow>("SELECT id, symbol, name, class FROM assets WHERE license_class = 'green' AND (symbol LIKE ? OR name LIKE ?) ORDER BY symbol ASC LIMIT 20", `%${query}%`, `%${query}%`),
      ]);
      return jsonResponse({ query, sections: { situations: results.map(serializeSearchResult), assets: assets.map((asset) => serializeAssetSearchResult(asset, 1)), companies: searchCompanies(query) } }, request);
    }
    if (url.pathname === "/v1/markets") {
      const now = env.now?.() ?? new Date().toISOString();
      return jsonResponse({ generatedAt: now, assets: await loadMarketAssets(env, now) }, request);
    }
    if (url.pathname === "/v1/markets/history") {
      const now = env.now?.() ?? new Date().toISOString();
      const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? "7") || 7, 1), 30);
      const rows = await env.db.all<{ symbol: string; ts: string; price: number }>(
        "SELECT a.symbol AS symbol, p.ts AS ts, p.price AS price FROM asset_prices p JOIN assets a ON a.id = p.asset_id WHERE a.license_class = 'green' AND p.ts >= ? ORDER BY a.symbol ASC, p.ts ASC",
        new Date(Date.parse(now) - days * 86_400_000).toISOString(),
      );
      const bySymbol = new Map<string, { ts: string; price: number }[]>();
      for (const row of rows) {
        const list = bySymbol.get(row.symbol) ?? [];
        list.push({ ts: row.ts, price: row.price });
        bySymbol.set(row.symbol, list);
      }
      return jsonResponse({ generatedAt: now, days, series: [...bySymbol].map(([symbol, points]) => ({ symbol, points: downsample(points, 96) })) }, request);
    }
    if (url.pathname === "/v1/markets/impact") {
      // What the currently visible situations may affect, by the same named rules that drive push notifications.
      const situations = await env.db.all<{ id: string; title: string; category: EventCategory; geo_name: string | null; last_event_at: string; source_count: number }>(
        "SELECT id, title, category, geo_name, last_event_at, source_count FROM situations WHERE status = 'active' AND map_rank IS NOT NULL ORDER BY map_rank ASC",
      );
      const items = situations.map((situation) => ({
        situationID: situation.id,
        title: situation.title,
        category: situation.category,
        lastEventAt: situation.last_event_at,
        sourceCount: situation.source_count,
        assets: linkAssets(situation).map(({ symbol, name, rationale }) => ({ symbol, name, rationale })),
        companies: linkCompanies(situation, 4),
      })).filter((item) => item.assets.length > 0 || item.companies.length > 0);
      return jsonResponse({ generatedAt: env.now?.() ?? new Date().toISOString(), items }, request);
    }
    return errorResponse("not found", 404, request);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "internal error", 500, request);
  }
}

/** Evenly thins a series to at most `limit` points, always keeping the first and the newest. */
function downsample<T>(points: T[], limit: number): T[] {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => points[Math.round(index * step)] as T);
}

export { etag };

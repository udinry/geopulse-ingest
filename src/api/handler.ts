import type { ArticleRow, AssetPriceRow, AssetRow, EventRow, OutlookMarketRow, SituationOutlookRow, SituationRow } from "../shared/types.js";
import { buildNowSnapshot, encodeSnapshot, type NowSnapshot } from "../emit/snapshot.js";
import { serializeOutlook } from "../emit/publicSerializer.js";

export interface Queryable {
  all<T>(sql: string, ...bindings: unknown[]): Promise<T[]>;
  first<T>(sql: string, ...bindings: unknown[]): Promise<T | null>;
}

export interface APIEnvironment {
  db: Queryable;
  now?: () => string;
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

async function loadSituation(env: APIEnvironment, id: string): Promise<Record<string, unknown> | null> {
  const situation = await env.db.first<SituationRow>(
    "SELECT id, title, category, lat, lon, country_iso, status, first_seen_at, last_event_at, trending_score, event_count, source_count, map_rank FROM situations WHERE id = ?",
    id,
  );
  if (situation === null) return null;
  const [events, news, outlookRows, outlookLinks] = await Promise.all([
    env.db.all<EventRow>("SELECT e.id, e.category, e.quad_class, e.goldstein, e.actor1_name, e.actor2_name, e.geo_name, e.occurred_at, e.num_mentions, e.num_sources FROM events e JOIN situation_events se ON se.event_id = e.id WHERE se.situation_id = ? ORDER BY e.occurred_at DESC", id),
    env.db.all<ArticleRow & { source_name: string }>("SELECT a.id, a.source_id, a.url_canonical, a.url_hash, a.title, a.title_norm, a.title_simhash, a.excerpt, a.published_at, a.fetched_at, a.lang, a.country_iso, a.dedup_group_id, a.publisher_domain, a.publisher_name, s.name AS source_name FROM articles a JOIN event_articles ea ON ea.article_id = a.id JOIN situation_events se ON se.event_id = ea.event_id JOIN sources s ON s.id = a.source_id WHERE se.situation_id = ? GROUP BY a.id ORDER BY a.published_at DESC", id),
    env.db.all<OutlookMarketRow>("SELECT om.* FROM outlook_markets om JOIN situation_outlook so ON so.market_id = om.id WHERE so.situation_id = ? AND om.is_resolved = 0", id),
    env.db.all<SituationOutlookRow>("SELECT * FROM situation_outlook WHERE situation_id = ?", id),
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

export async function handleRequest(request: Request, env: APIEnvironment): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") return errorResponse("method not allowed", 405, request);
  try {
    if (url.pathname === "/v1/now") return jsonResponse(await loadNow(env, env.now?.() ?? new Date().toISOString()), request);
    if (url.pathname.startsWith("/v1/situation/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/situation/".length));
      const detail = await loadSituation(env, id);
      return detail === null ? errorResponse("situation not found", 404, request) : jsonResponse(detail, request);
    }
    if (url.pathname === "/v1/search") {
      const query = url.searchParams.get("q")?.trim() ?? "";
      if (query.length < 2) return jsonResponse({ query, results: [] }, request);
      const results = await env.db.all("SELECT id, title, category, trending_score FROM situations WHERE title LIKE ? ORDER BY trending_score DESC LIMIT 20", `%${query}%`);
      return jsonResponse({ query, results }, request);
    }
    if (url.pathname === "/v1/markets") {
      const assets = await env.db.all<AssetRow>("SELECT id, symbol, name, class, currency, license_class, is_delayed, delay_minutes FROM assets WHERE license_class = 'green' ORDER BY symbol ASC");
      return jsonResponse({ generatedAt: env.now?.() ?? new Date().toISOString(), assets }, request);
    }
    return errorResponse("not found", 404, request);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "internal error", 500, request);
  }
}

export { etag };

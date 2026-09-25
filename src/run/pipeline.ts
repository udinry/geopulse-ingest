import { createHash } from "node:crypto";
import type { Queryable } from "../api/handler.js";
import { decideForEvent, isVisibleOnMap, situationFromEvent, updateSituationWithEvent } from "../cluster/cluster.js";
import type { SituationState } from "../cluster/similarity.js";
import { entitySignatureForEvent } from "../cluster/entitySignature.js";
import { normalizeTitle, titleSimHash } from "../dedupe/titleSimHash.js";
import { canonicalizeUrl, canonicalUrlHash } from "../normalize/canonicalUrl.js";
import { lookupCameoRoot } from "../normalize/cameoCategoryMap.js";
import type { GkgTitle } from "../normalize/gkgParser.js";
import { applyImpulse, BOOTSTRAP_PRIOR_WEIGHTS, combineImpulse, decayScore, initialScoreState, type ImpulseComponents, type ScoreState, type TrendingScoreWeights } from "../score/trendingScoreAccumulator.js";
import type { EventCategory, EventRow } from "../shared/types.js";
import type { BatchWriter, Statement } from "./sql.js";

/**
 * An event needs this many distinct sources to be kept at all. That is the same bar a
 * situation needs to appear on the map (MAP_VISIBILITY_MIN_SOURCES), and a situation's
 * source count is a running max over its events — so a 1- or 2-source event can never
 * lift a situation toward visibility. Dropping them costs nothing the map would have
 * shown, and keeps us inside D1's free 100k-writes/day (a raw feed is ~800 events per
 * 15 minutes).
 */
export const MIN_EVENT_SOURCES = 3;
/** Reference magnitudes for log normalisation. Uncalibrated, like the weights (see PLAN.md Phase 4). */
export const VELOCITY_REF_MENTIONS = 300;
export const CONFIRMATION_REF_SOURCES = 50;
export const MAP_TOP_N = 10;
export const MAX_PER_COUNTRY = 2;
export const ACTIVE_HOURS = 48;
export const ARCHIVE_DAYS = 14;

const QUAD_COEFFICIENT: Record<number, number> = { 4: 1, 3: 0.6, 2: 0.4, 1: 0.3 };
const HOUR_MS = 3_600_000;

export interface BatchInput {
  events: readonly EventRow[];
  sourceUrls: ReadonlyMap<string, string>;
  titles: ReadonlyMap<string, GkgTitle>;
  now: string;
}

export interface BatchResult {
  eventsSeen: number;
  eventsKept: number;
  eventsAlreadyStored: number;
  situationsCreated: number;
  situationsTouched: number;
}

type Db = Queryable & Partial<BatchWriter>;

async function execute(db: Db, statements: readonly Statement[]): Promise<void> {
  if (statements.length === 0) return;
  if (db.batch !== undefined) {
    await db.batch(statements);
    return;
  }
  for (const s of statements) await db.run(s.sql, ...s.params);
}

/** Severity in [0,1]: Goldstein destabilisation x CAMEO consequence class x quad class. No Goldstein, no severity. */
export function eventSeverity(event: EventRow): number {
  if (event.goldstein === null) return 0;
  const mapping = event.cameo_root === null ? null : lookupCameoRoot(event.cameo_root);
  if (mapping === null) return 0;
  const base = (10 - event.goldstein) / 20;
  const quad = event.quad_class === null ? 0.3 : QUAD_COEFFICIENT[event.quad_class] ?? 0.3;
  return Math.min(1, Math.max(0, base * mapping.severityCoefficient * quad));
}

/** Only news-derived components exist yet (no market/outlook linking), so the weights
 * renormalise over what is available rather than silently capping every impulse at 0.75. */
export function availableWeights(weights: TrendingScoreWeights = BOOTSTRAP_PRIOR_WEIGHTS): TrendingScoreWeights {
  const total = weights.newsVelocity + weights.sourceConfirmation + weights.severity;
  return {
    newsVelocity: weights.newsVelocity / total,
    sourceConfirmation: weights.sourceConfirmation / total,
    severity: weights.severity / total,
    marketMovement: 0,
    outlookMovement: 0,
  };
}

export function eventImpulse(event: EventRow): { magnitude: number; components: ImpulseComponents } {
  const components: ImpulseComponents = {
    newsVelocity: Math.min(1, Math.log1p(event.num_mentions) / Math.log1p(VELOCITY_REF_MENTIONS)),
    sourceConfirmation: Math.min(1, Math.log1p(event.num_sources) / Math.log1p(CONFIRMATION_REF_SOURCES)),
    severity: eventSeverity(event),
    marketMovement: 0,
    outlookMovement: 0,
  };
  return { magnitude: combineImpulse(availableWeights(), components), components };
}

function articleId(canonicalUrl: string): string {
  return `art-${createHash("sha1").update(canonicalUrl).digest("hex").slice(0, 16)}`;
}

function slugify(title: string, id: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${base || "situation"}-${createHash("sha1").update(id).digest("hex").slice(0, 6)}`;
}

interface ActiveRow { id: string; category: EventCategory; lat: number; lon: number; last_event_at: string; event_count: number; source_count: number }

async function loadActiveSituations(db: Db): Promise<Map<string, SituationState>> {
  const rows = await db.all<ActiveRow>("SELECT id, category, lat, lon, last_event_at, event_count, source_count FROM situations WHERE status = 'active'");
  const states = new Map<string, SituationState>();
  for (const r of rows) {
    states.set(r.id, { id: r.id, category: r.category, centroidLat: r.lat, centroidLon: r.lon, entitySignature: new Set(), lastEventAt: r.last_event_at, eventCount: r.event_count, sourceCount: r.source_count });
  }
  if (states.size === 0) return states;
  const members = await db.all<{ situation_id: string; actor1_code: string | null; actor2_code: string | null; country_iso: string | null }>(
    "SELECT se.situation_id, e.actor1_code, e.actor2_code, e.country_iso FROM situation_events se JOIN events e ON e.id = se.event_id JOIN situations s ON s.id = se.situation_id WHERE s.status = 'active'",
  );
  for (const m of members) {
    const state = states.get(m.situation_id);
    if (state !== undefined) for (const item of entitySignatureForEvent(m)) state.entitySignature.add(item);
  }
  return states;
}

async function existingEventIds(db: Db, ids: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const rows = await db.all<{ id: string }>(`SELECT id FROM events WHERE id IN (${chunk.map(() => "?").join(",")})`, ...chunk);
    for (const r of rows) found.add(r.id);
  }
  return found;
}

/** Ingests one batch of already-parsed GDELT events. Deterministic given its inputs and the current DB state. */
export async function ingestBatch(db: Db, input: BatchInput): Promise<BatchResult> {
  const { now } = input;
  const candidates: Array<{ event: EventRow; url: string; title: GkgTitle }> = [];
  for (const event of input.events) {
    if (event.num_sources < MIN_EVENT_SOURCES || event.lat === null || event.lon === null) continue;
    const raw = input.sourceUrls.get(event.id);
    if (raw === undefined) continue;
    let url: string;
    try { url = canonicalizeUrl(raw); } catch { continue; }
    const title = input.titles.get(url);
    if (title === undefined) continue;
    candidates.push({ event, url, title });
  }
  candidates.sort((a, b) => a.event.first_seen_at.localeCompare(b.event.first_seen_at));

  const already = await existingEventIds(db, candidates.map((c) => c.event.id));
  const fresh = candidates.filter((c) => !already.has(c.event.id));
  const result: BatchResult = { eventsSeen: input.events.length, eventsKept: fresh.length, eventsAlreadyStored: already.size, situationsCreated: 0, situationsTouched: 0 };
  if (fresh.length === 0) return result;

  const active = await loadActiveSituations(db);
  // Same story, however GDELT geolocated its events: an article (or identical headline)
  // already tied to an active situation pulls its other events into that situation.
  const byHeadline = new Map<string, string>();
  for (const row of await db.all<{ id: string; title: string }>("SELECT id, title FROM situations WHERE status = 'active'")) byHeadline.set(normalizeTitle(row.title).join(" "), row.id);
  const byUrl = new Map<string, string>();
  const newIds = new Set<string>();
  const touched = new Set<string>();
  const impulses = new Map<string, number>();
  const statements: Statement[] = [];
  const membership: Statement[] = [];

  for (const { event, url, title } of fresh) {
    // Cluster on report time (DATEADDED), not GDELT's date-only SQLDATE midnight.
    const clusterEvent: EventRow = { ...event, occurred_at: event.first_seen_at };
    const headlineKey = normalizeTitle(title.title).join(" ");
    let sameStory = byUrl.get(url) ?? byHeadline.get(headlineKey);
    if (sameStory === undefined) {
      sameStory = (await db.first<{ situation_id: string }>("SELECT se.situation_id FROM articles a JOIN event_articles ea ON ea.article_id = a.id JOIN situation_events se ON se.event_id = ea.event_id WHERE a.url_canonical = ? LIMIT 1", url))?.situation_id;
    }
    const decision = sameStory !== undefined && active.has(sameStory)
      ? { action: "join" as const, situationId: sameStory, score: 1 }
      : decideForEvent(clusterEvent, [...active.values()]);
    const impulse = eventImpulse(event);
    let situationId: string;
    let similarityScore: number | null = null;

    if (decision.action === "join") {
      situationId = decision.situationId;
      similarityScore = decision.score;
      active.set(situationId, updateSituationWithEvent(active.get(situationId) as SituationState, clusterEvent));
    } else {
      situationId = `sit-${event.id}`;
      active.set(situationId, situationFromEvent(situationId, clusterEvent));
      newIds.add(situationId);
    }
    byUrl.set(url, situationId);
    byHeadline.set(headlineKey, situationId);
    touched.add(situationId);
    impulses.set(situationId, (impulses.get(situationId) ?? 0) + impulse.magnitude);

    const aId = articleId(url);
    statements.push({
      sql: "INSERT OR IGNORE INTO events (id, gdelt_event_id, cameo_code, cameo_root, quad_class, goldstein, actor1_code, actor1_name, actor2_code, actor2_name, lat, lon, geo_name, country_iso, geo_precision, occurred_at, first_seen_at, num_mentions, num_sources, num_articles, avg_tone, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [event.id, event.gdelt_event_id, event.cameo_code, event.cameo_root, event.quad_class, event.goldstein, event.actor1_code, event.actor1_name, event.actor2_code, event.actor2_name, event.lat, event.lon, event.geo_name, event.country_iso, event.geo_precision, event.occurred_at, event.first_seen_at, event.num_mentions, event.num_sources, event.num_articles, event.avg_tone, event.category],
    });
    statements.push({
      sql: "INSERT OR IGNORE INTO articles (id, source_id, url_canonical, url_hash, title, title_norm, title_simhash, published_at, fetched_at, publisher_domain, publisher_name) VALUES (?, 'gdelt', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [aId, url, canonicalUrlHash(url), title.title, normalizeTitle(title.title).join(" "), titleSimHash(title.title).toString(16).padStart(16, "0"), event.first_seen_at, now, title.sourceName || null, title.sourceName || null],
    });
    statements.push({ sql: "INSERT OR IGNORE INTO event_articles (event_id, article_id) SELECT ?, id FROM articles WHERE url_canonical = ?", params: [event.id, url] });

    if (decision.action === "create") {
      statements.push({
        sql: "INSERT OR IGNORE INTO situations (id, slug, title, headline_article_id, category, lat, lon, geo_name, country_iso, status, first_seen_at, last_event_at, event_count, source_count) SELECT ?, ?, ?, id, ?, ?, ?, ?, ?, 'active', ?, ?, 0, 0 FROM articles WHERE url_canonical = ?",
        params: [situationId, slugify(title.title, situationId), title.title, event.category, event.lat, event.lon, event.geo_name, event.country_iso, event.first_seen_at, event.first_seen_at, url],
      });
    }
    membership.push({ sql: "INSERT OR IGNORE INTO situation_events (situation_id, event_id, joined_at, similarity) VALUES (?, ?, ?, ?)", params: [situationId, event.id, now, similarityScore] });
  }

  await execute(db, [...statements, ...membership]);
  result.situationsCreated = newIds.size;
  result.situationsTouched = touched.size;

  // Aggregates + score for every touched situation, recomputed from what is now stored.
  const aggregates: Statement[] = [];
  for (const id of touched) {
    const state = active.get(id) as SituationState;
    const prior = newIds.has(id) ? null : await db.first<{ trending_score: number; score_updated_at: string | null; peak_score: number; last_event_at: string; category: EventCategory }>("SELECT trending_score, score_updated_at, peak_score, last_event_at, category FROM situations WHERE id = ?", id);
    const impulse = impulses.get(id) ?? 0;
    const next: ScoreState = prior === null
      ? initialScoreState(state.category, now, impulse)
      : applyImpulse({ score: prior.trending_score, lastUpdatedIso: prior.score_updated_at ?? prior.last_event_at, category: prior.category }, impulse, now);
    const headline = await db.first<{ id: string; title: string }>(
      "SELECT a.id, a.title FROM situation_events se JOIN events e ON e.id = se.event_id JOIN event_articles ea ON ea.event_id = e.id JOIN articles a ON a.id = ea.article_id WHERE se.situation_id = ? ORDER BY e.num_mentions DESC, e.first_seen_at DESC LIMIT 1",
      id,
    );
    aggregates.push({
      sql: "UPDATE situations SET category = ?, lat = ?, lon = ?, last_event_at = ?, event_count = (SELECT COUNT(*) FROM situation_events WHERE situation_id = ?), source_count = ?, trending_score = ?, score_updated_at = ?, peak_score = MAX(peak_score, ?), title = COALESCE(?, title), headline_article_id = COALESCE(?, headline_article_id) WHERE id = ?",
      params: [state.category, state.centroidLat, state.centroidLon, state.lastEventAt, id, state.sourceCount, next.score, now, next.score, headline?.title ?? null, headline?.id ?? null, id],
    });
    aggregates.push({
      sql: "INSERT OR REPLACE INTO score_history (situation_id, ts, score, components_json) VALUES (?, ?, ?, ?)",
      params: [id, now, next.score, JSON.stringify({ impulse, weights: availableWeights(), calibrated: false })],
    });
  }
  await execute(db, aggregates);
  return result;
}

export interface RankResult { ranked: number }

/** Lifecycle, decay, and map promotion. Runs every tick, independent of whether new events arrived. */
export async function refreshRanking(db: Db, now: string): Promise<RankResult> {
  const nowMs = Date.parse(now);
  const activeCutoff = new Date(nowMs - ACTIVE_HOURS * HOUR_MS).toISOString();
  const archiveCutoff = new Date(nowMs - ARCHIVE_DAYS * 24 * HOUR_MS).toISOString();
  await db.run("UPDATE situations SET status = 'recent', map_rank = NULL WHERE status = 'active' AND last_event_at < ?", activeCutoff);
  await db.run("UPDATE situations SET status = 'archived', map_rank = NULL WHERE status = 'recent' AND last_event_at < ?", archiveCutoff);

  const rows = await db.all<{ id: string; category: EventCategory; country_iso: string | null; trending_score: number; score_updated_at: string | null; last_event_at: string; source_count: number; map_rank: number | null }>(
    "SELECT id, category, country_iso, trending_score, score_updated_at, last_event_at, source_count, map_rank FROM situations WHERE status = 'active'",
  );
  const scored = rows
    .filter((r) => isVisibleOnMap({ sourceCount: r.source_count }))
    .map((r) => ({ ...r, score: decayScore({ score: r.trending_score, lastUpdatedIso: r.score_updated_at ?? r.last_event_at, category: r.category }, now).score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const perCountry = new Map<string, number>();
  const rankById = new Map<string, number>();
  for (const s of scored) {
    if (rankById.size >= MAP_TOP_N) break;
    const country = s.country_iso ?? `unknown-${s.id}`;
    if ((perCountry.get(country) ?? 0) >= MAX_PER_COUNTRY) continue;
    perCountry.set(country, (perCountry.get(country) ?? 0) + 1);
    rankById.set(s.id, rankById.size + 1);
  }

  const updates: Statement[] = [];
  for (const s of scored) {
    updates.push({ sql: "UPDATE situations SET trending_score = ?, score_updated_at = ?, map_rank = ? WHERE id = ?", params: [s.score, now, rankById.get(s.id) ?? null, s.id] });
  }
  await execute(db, updates);
  return { ranked: rankById.size };
}

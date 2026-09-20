/**
 * Row-shape contracts for every table in migrations/000*.sql — 1:1 with the SQL, since
 * these are literally what a D1 `.all()`/`.first()` query returns later (Phase 2+).
 *
 * These are intentionally thin (no mapper/domain logic yet — that's each phase's own
 * job as it's built): Phase 1's job is the contract, not the implementation.
 *
 * SQLite has no native boolean — columns declared CHECK (x IN (0,1)) come back as
 * `0 | 1` here, not `boolean`, to match reality exactly rather than paper over it with
 * a cast that could silently drift from what D1 actually returns.
 */

export type SqliteBool = 0 | 1;

// ── sources & articles (0001) ────────────────────────────────────────────────

export type SourceKind = "rss" | "gdelt" | "api" | "government";
export type LicenseClass = "green" | "amber" | "red";

export interface SourceRow {
  id: string;
  name: string;
  domain: string;
  feed_url: string | null;
  kind: SourceKind;
  credibility_tier: 1 | 2 | 3 | 4;
  license_class: LicenseClass;
  excerpt_allowed: SqliteBool;
  attribution_text: string | null;
  attribution_url: string | null;
  terms_url: string | null;
  terms_reviewed_at: string | null;
  is_active: SqliteBool;
  etag: string | null;
  last_modified: string | null;
  last_ok_at: string | null;
  fail_count: number;
}

export interface ArticleRow {
  id: string;
  source_id: string;
  url_canonical: string;
  url_hash: string;
  title: string;
  title_norm: string;
  title_simhash: string; // hex string — see src/dedupe/titleSimHash.ts
  excerpt: string | null; // only ever non-null when the owning source.excerpt_allowed = 1
  published_at: string | null;
  fetched_at: string;
  lang: string | null;
  country_iso: string | null;
  dedup_group_id: string | null;
}

// ── events (0002) ─────────────────────────────────────────────────────────────

/** Mirrors GeoPulseKit's EventCategory raw values byte-for-byte. Keep in sync. */
export type EventCategory =
  | "warArmedConflict"
  | "militaryMovement"
  | "terrorismSecurityIncident"
  | "electionPoliticalTransition"
  | "protestCivilUnrest"
  | "diplomaticNegotiation"
  | "sanctionsTradeRestriction"
  | "internationalDispute"
  | "centralBankDecision"
  | "macroDataRelease"
  | "fiscalPolicy"
  | "bankingFinancialSystem"
  | "majorCorporateEvent"
  | "oilEnergyDisruption"
  | "shippingMaritimeDisruption"
  | "aviationDisruption"
  | "earthquakeTsunami"
  | "hurricaneExtremeWeather"
  | "majorFireIndustrialAccident";

export interface EventRow {
  id: string;
  gdelt_event_id: string | null;
  cameo_code: string | null;
  cameo_root: string | null;
  quad_class: 1 | 2 | 3 | 4 | null;
  goldstein: number | null;
  actor1_code: string | null;
  actor1_name: string | null;
  actor2_code: string | null;
  actor2_name: string | null;
  lat: number | null;
  lon: number | null;
  geo_name: string | null;
  country_iso: string | null;
  geo_precision: number | null;
  occurred_at: string;
  first_seen_at: string;
  num_mentions: number;
  num_sources: number;
  num_articles: number;
  avg_tone: number | null;
  category: EventCategory;
}

export interface EventArticleRow {
  event_id: string;
  article_id: string;
}

// ── situations (0003) ─────────────────────────────────────────────────────────

export type EntityType = "country" | "org" | "person" | "place" | "asset";
export type SituationStatus = "active" | "recent" | "archived";

export interface EntityRow {
  id: string;
  type: EntityType;
  canonical_name: string;
  wikidata_id: string | null;
  country_iso: string | null;
  aliases_json: string; // JSON-encoded string[]
}

export interface SituationRow {
  id: string;
  slug: string;
  title: string;
  headline_article_id: string | null;
  category: EventCategory;
  lat: number;
  lon: number;
  geo_name: string | null;
  country_iso: string | null;
  bbox_json: string | null;
  status: SituationStatus;
  first_seen_at: string;
  last_event_at: string;
  trending_score: number;
  score_updated_at: string | null;
  peak_score: number;
  event_count: number;
  source_count: number;
  map_rank: number | null;
}

export interface SituationEventRow {
  situation_id: string;
  event_id: string;
  joined_at: string;
  similarity: number | null;
}

export interface SituationEntityRow {
  situation_id: string;
  entity_id: string;
  weight: number;
}

// ── markets (0004) ────────────────────────────────────────────────────────────

export type AssetClass = "equity" | "index" | "fx" | "crypto" | "commodity" | "bond";
export type SessionState = "open" | "closed" | "preMarket" | "postMarket" | "continuous";
export type SituationAssetRelation = "geographic" | "sector" | "supply_chain" | "commodity";

export interface AssetRow {
  id: string;
  symbol: string;
  name: string;
  class: AssetClass;
  exchange: string | null;
  currency: string;
  country_iso: string | null;
  data_source: string;
  license_class: LicenseClass;
  is_delayed: SqliteBool;
  delay_minutes: number;
}

export interface AssetPriceRow {
  asset_id: string;
  ts: string;
  price: number;
  change_pct: number | null;
  as_of: string;
  session_state: SessionState;
}

export interface SituationAssetRow {
  situation_id: string;
  asset_id: string;
  relation_type: SituationAssetRelation;
  weight: number;
  rationale_key: string; // an i18n key — NEVER generated prose
  source: string; // the deterministic rule id that created this link
}

// ── outlook (0005) — see docs/ARCHITECTURE.md's de-branding contract ──────────

export type OutlookMatchedBy = "entity" | "category" | "manual" | "token";

/**
 * ⚠ INTERNAL ONLY. This row shape must never be serialized wholesale to the read API —
 * `venue`, `slug`, and `url` are exactly the fields the de-branding contract forbids
 * sending to any client, in any region. The emit layer (Phase 2+) must map this to a
 * venue-free public shape (mirrors GeoPulseKit's `OutlookIndicator`, which has no field
 * for any of these three) before it reaches `/v1/*`.
 */
export interface OutlookMarketRow {
  id: string;
  venue: string; // ⚠ never serialize
  slug: string; // ⚠ never serialize
  url: string | null; // ⚠ never serialize
  question: string;
  question_normalised: string; // safe to serialize
  description: string | null;
  category: string | null;
  tags_json: string;
  end_date: string | null;
  volume: number | null;
  liquidity: number | null;
  outcome_label: string | null;
  probability: number;
  prev_probability: number | null;
  prob_change_1h: number | null;
  prob_change_24h: number | null;
  updated_at: string;
  is_resolved: SqliteBool;
}

/** The public shape the emit layer must produce — mirrors GeoPulseKit's `OutlookIndicator`. */
export interface OutlookPublic {
  id: string;
  question: string; // = question_normalised
  probability: number;
  change24h: number | null;
  matchConfidence: number;
  method: string;
  asOf: string;
}

export interface SituationOutlookRow {
  situation_id: string;
  market_id: string;
  confidence: number; // must exceed 0.70 to ever be surfaced by the emit query
  matched_by: OutlookMatchedBy;
  is_manually_verified: SqliteBool;
  method: string;
}

// ── scoring & alerts (0006) ───────────────────────────────────────────────────

export interface ScoreHistoryRow {
  situation_id: string;
  ts: string;
  score: number;
  components_json: string; // JSON-encoded ImpulseComponents snapshot
}

export interface DeviceRow {
  id: string;
  apns_token: string;
  region_iso: string | null;
  is_pro: SqliteBool;
  created_at: string;
  last_seen_at: string;
}

export type AlertKind = "price" | "percent" | "velocity" | "situation" | "outlook";
export type AlertSubjectType = "asset" | "situation" | "market";
export type AlertOperator = "gt" | "gte" | "lt" | "lte" | "crosses";

export interface AlertRow {
  id: string;
  device_id: string;
  kind: AlertKind;
  subject_type: AlertSubjectType;
  subject_id: string;
  operator: AlertOperator;
  threshold: number;
  window_minutes: number | null;
  combinator_group_id: string | null;
  live_activity: SqliteBool;
  is_active: SqliteBool;
  last_fired_at: string | null;
  cooldown_minutes: number;
}

export interface AlertDeliveryRow {
  alert_id: string;
  fired_at: string;
  payload_hash: string;
}

// ── ops (0007) ────────────────────────────────────────────────────────────────

export type IngestStage =
  | "fetch"
  | "normalize"
  | "dedupe"
  | "cluster"
  | "score"
  | "link"
  | "emit"
  | "lifecycle"
  | "calibrate";
export type IngestStatus = "running" | "success" | "failed";

export interface IngestRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  stage: IngestStage;
  status: IngestStatus;
  counts_json: string | null;
  error: string | null;
}

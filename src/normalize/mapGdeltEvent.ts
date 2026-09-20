/**
 * Maps a raw parsed GDELT Events row into our schema's EventRow shape, using the
 * committed CAMEO -> EventCategory lookup (cameoCategoryMap.ts). Returns `null` — never
 * a guessed category — when the root code doesn't map to anything we recognize, so an
 * unrecognized/malformed row is skipped rather than silently mis-categorized. This is
 * the "never invent data" principle applied to ingestion, not just to display.
 */
import type { EventRow } from "../shared/types.js";
import { lookupCameoRoot } from "./cameoCategoryMap.js";
import type { RawGdeltEventRow } from "./gdeltEventParser.js";

/** GDELT's SQLDATE (YYYYMMDD) -> an ISO8601 UTC midnight timestamp. */
function sqlDateToIso(sqlDate: string): string | null {
  if (!/^\d{8}$/.test(sqlDate)) return null;
  const year = sqlDate.slice(0, 4);
  const month = sqlDate.slice(4, 6);
  const day = sqlDate.slice(6, 8);
  return `${year}-${month}-${day}T00:00:00Z`;
}

/** GDELT's DATEADDED (YYYYMMDDHHMMSS) -> a full ISO8601 UTC timestamp. */
function dateAddedToIso(dateAdded: string): string | null {
  if (!/^\d{14}$/.test(dateAdded)) return null;
  const year = dateAdded.slice(0, 4);
  const month = dateAdded.slice(4, 6);
  const day = dateAdded.slice(6, 8);
  const hour = dateAdded.slice(8, 10);
  const minute = dateAdded.slice(10, 12);
  const second = dateAdded.slice(12, 14);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

/** Parses a numeric string field, returning null for empty/unparseable rather than 0 or
 * NaN — an absent geo-resolution (empty lat/long) must not become "0,0 = Gulf of Guinea". */
function parseNullableNumber(raw: string): number | null {
  if (raw.trim().length === 0) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function mapGdeltEventToEventRow(raw: RawGdeltEventRow): EventRow | null {
  const mapping = lookupCameoRoot(raw.eventRootCode);
  if (!mapping) return null;

  const occurredAt = sqlDateToIso(raw.sqlDate);
  const firstSeenAt = dateAddedToIso(raw.dateAdded);
  if (!occurredAt || !firstSeenAt) return null;

  const quadClassNum = parseNullableNumber(raw.quadClass);
  const quadClass =
    quadClassNum === 1 || quadClassNum === 2 || quadClassNum === 3 || quadClassNum === 4
      ? quadClassNum
      : null;

  return {
    id: `gdelt-${raw.globalEventId}`,
    gdelt_event_id: raw.globalEventId,
    cameo_code: raw.eventCode || null,
    cameo_root: raw.eventRootCode || null,
    quad_class: quadClass,
    goldstein: parseNullableNumber(raw.goldsteinScale),
    actor1_code: raw.actor1CountryCode || raw.actor1Code || null,
    actor1_name: raw.actor1Name || null,
    actor2_code: raw.actor2CountryCode || raw.actor2Code || null,
    actor2_name: raw.actor2Name || null,
    lat: parseNullableNumber(raw.actionGeoLat),
    lon: parseNullableNumber(raw.actionGeoLong),
    geo_name: raw.actionGeoFullName || null,
    country_iso: raw.actionGeoCountryCode || null,
    geo_precision: parseNullableNumber(raw.actionGeoType),
    occurred_at: occurredAt,
    first_seen_at: firstSeenAt,
    num_mentions: parseNullableNumber(raw.numMentions) ?? 0,
    num_sources: parseNullableNumber(raw.numSources) ?? 0,
    num_articles: parseNullableNumber(raw.numArticles) ?? 0,
    avg_tone: parseNullableNumber(raw.avgTone),
    category: mapping.category,
  };
}

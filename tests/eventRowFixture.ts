import type { EventRow } from "../src/shared/types.js";

/** A minimal, valid EventRow for tests, overridable via partial. Keeps test setup
 * terse without hiding which fields actually matter for a given assertion. */
export function makeEventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "evt-test",
    gdelt_event_id: "1",
    cameo_code: "190",
    cameo_root: "19",
    quad_class: 4,
    goldstein: -8.0,
    actor1_code: "USA",
    actor1_name: "United States",
    actor2_code: "CHN",
    actor2_name: "China",
    lat: 23.5,
    lon: 121.0,
    geo_name: "Taiwan Strait",
    country_iso: "TW",
    geo_precision: 1,
    occurred_at: "2026-09-20T10:00:00Z",
    first_seen_at: "2026-09-20T10:05:00Z",
    num_mentions: 10,
    num_sources: 3,
    num_articles: 10,
    avg_tone: -5.0,
    category: "militaryMovement",
    ...overrides,
  };
}

import { describe, expect, it } from "vitest";
import { serializeAsset, serializeOutlook, serializeSituation } from "../src/emit/publicSerializer.js";
import type { AssetRow, OutlookMarketRow, SituationOutlookRow, SituationRow } from "../src/shared/types.js";

const situation: SituationRow = {
  id: "s1", slug: "internal-slug", title: "A situation", headline_article_id: null,
  category: "militaryMovement", lat: 1, lon: 2, geo_name: "Place", country_iso: "US",
  bbox_json: null, status: "active", first_seen_at: "2026-09-20T00:00:00Z", last_event_at: "2026-09-20T01:00:00Z",
  trending_score: 0.8, score_updated_at: null, peak_score: 1, event_count: 2, source_count: 3, map_rank: 1,
};

const market: OutlookMarketRow = {
  id: "m1", venue: "ForbiddenVenue", slug: "forbidden-slug", url: "https://forbidden.example/m1",
  question: "Internal question", question_normalised: "Major escalation before 31 Dec", description: null,
  category: null, tags_json: "[]", end_date: null, volume: 1, liquidity: 1, outcome_label: null,
  probability: 0.23, prev_probability: 0.2, prob_change_1h: 0.01, prob_change_24h: 0.05,
  updated_at: "2026-09-20T01:00:00Z", is_resolved: 0,
};

const link: SituationOutlookRow = {
  situation_id: "s1", market_id: "m1", confidence: 0.82, matched_by: "category", is_manually_verified: 0, method: "market_implied_v1",
};

describe("public serializers", () => {
  it("maps the situation to the Swift-facing camel-case contract", () => {
    expect(serializeSituation(situation)).toEqual(expect.objectContaining({ id: "s1", coordinate: { latitude: 1, longitude: 2 }, mapRank: 1 }));
    expect(JSON.stringify(serializeSituation(situation))).not.toContain("slug");
  });

  it("strips every venue-identifying outlook field", () => {
    const publicOutlook = serializeOutlook(market, link);
    expect(publicOutlook).toEqual({ id: "m1", question: "Major escalation before 31 Dec", probability: 0.23, change24h: 0.05, matchConfidence: 0.82, method: "market_implied_v1", asOf: "2026-09-20T01:00:00Z" });
    expect(JSON.stringify(publicOutlook)).not.toContain("ForbiddenVenue");
    expect(JSON.stringify(publicOutlook)).not.toContain("forbidden-slug");
    expect(JSON.stringify(publicOutlook)).not.toContain("forbidden.example");
  });

  it("does not serialize an outlook below the display threshold", () => {
    expect(serializeOutlook(market, { ...link, confidence: 0.69 })).toBeNull();
    expect(serializeOutlook(market, { ...link, confidence: 0.69, is_manually_verified: 1 })).not.toBeNull();
  });

  it("keeps the asset licence gate visible in the public quote shape", () => {
    const asset: AssetRow = { id: "btc", symbol: "BTC", name: "Bitcoin", class: "crypto", exchange: "Binance", currency: "USD", country_iso: null, data_source: "binance", license_class: "green", is_delayed: 0, delay_minutes: 0 };
    expect(serializeAsset(asset, null).licenseClass).toBe("green");
  });
});

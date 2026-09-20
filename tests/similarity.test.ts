import { describe, expect, it } from "vitest";
import { JOIN_THRESHOLD } from "../src/cluster/cluster.js";
import { similarity, type SituationState } from "../src/cluster/similarity.js";
import { makeEventRow } from "./eventRowFixture.js";

function makeSituation(overrides: Partial<SituationState> = {}): SituationState {
  return {
    id: "sit-test",
    category: "militaryMovement",
    centroidLat: 23.5,
    centroidLon: 121.0,
    entitySignature: new Set(["actor:USA", "actor:CHN", "geo:TW"]),
    lastEventAt: "2026-09-20T09:00:00Z",
    eventCount: 3,
    sourceCount: 5,
    ...overrides,
  };
}

describe("similarity", () => {
  it("scores very high for an event that matches a situation on every dimension", () => {
    const event = makeEventRow();
    const situation = makeSituation();
    expect(similarity(event, situation)).toBeGreaterThan(0.9);
  });

  it("scores very low for an event unrelated on every dimension", () => {
    const event = makeEventRow({
      actor1_code: "GBR",
      actor2_code: null,
      country_iso: "GB",
      lat: 51.5,
      lon: -0.1,
      category: "centralBankDecision",
      occurred_at: "2026-01-01T00:00:00Z",
    });
    const situation = makeSituation();
    expect(similarity(event, situation)).toBeLessThan(0.15);
  });

  it("falls back to renormalizing across entity/category/time when the event has no resolved location", () => {
    const event = makeEventRow({ lat: null, lon: null });
    const situation = makeSituation();
    const score = similarity(event, situation);
    // Same entities, same category, close in time -> should still score high even
    // without a geo term, because the remaining weights renormalize rather than the
    // missing geo term just being silently treated as 0.
    expect(score).toBeGreaterThan(0.9);
  });

  it("a single shared actor alone (different geo, category, and second actor) contributes some signal but not enough to join", () => {
    const event = makeEventRow({
      actor2_code: null, // was CHN — no longer shared
      country_iso: "US", // was TW — no longer shared
      category: "diplomaticNegotiation", // was militaryMovement — no longer shared
      lat: 38.9,
      lon: -77.0, // Washington, DC — far from Taiwan
    });
    const situation = makeSituation();
    const score = similarity(event, situation); // measured: ~0.349 (actor:USA overlap + close-in-time only)
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(JOIN_THRESHOLD);
  });
});

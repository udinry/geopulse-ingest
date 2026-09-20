import { describe, expect, it } from "vitest";
import {
  decideForEvent,
  isVisibleOnMap,
  JOIN_THRESHOLD,
  mergeSituations,
  MERGE_THRESHOLD,
  situationFromEvent,
  situationSimilarity,
  updateSituationWithEvent,
} from "../src/cluster/cluster.js";
import type { SituationState } from "../src/cluster/similarity.js";
import { makeEventRow } from "./eventRowFixture.js";

describe("decideForEvent", () => {
  it("creates a new situation when there are no active situations at all", () => {
    const event = makeEventRow();
    expect(decideForEvent(event, [])).toEqual({ action: "create" });
  });

  it("joins the best-matching situation when it clears the threshold", () => {
    const situation = situationFromEvent("sit-1", makeEventRow());
    const followUpEvent = makeEventRow({
      gdelt_event_id: "2",
      occurred_at: "2026-09-20T10:30:00Z", // 30 min later, same story
    });
    const decision = decideForEvent(followUpEvent, [situation]);
    expect(decision.action).toBe("join");
    if (decision.action === "join") {
      expect(decision.situationId).toBe("sit-1");
      expect(decision.score).toBeGreaterThanOrEqual(JOIN_THRESHOLD);
    }
  });

  it("creates a new situation rather than force-joining an unrelated one", () => {
    const taiwanSituation = situationFromEvent("sit-taiwan", makeEventRow());
    const centralBankEvent = makeEventRow({
      gdelt_event_id: "99",
      actor1_code: "USAGOV",
      actor2_code: null,
      country_iso: "US",
      lat: 38.9,
      lon: -77.0,
      category: "centralBankDecision",
      occurred_at: "2026-09-20T10:00:00Z",
    });
    expect(decideForEvent(centralBankEvent, [taiwanSituation])).toEqual({ action: "create" });
  });

  it("picks the higher-scoring of two candidate situations", () => {
    const closeMatch = situationFromEvent("sit-close", makeEventRow());
    const looseMatch = situationFromEvent(
      "sit-loose",
      makeEventRow({ actor2_code: null, category: "internationalDispute" })
    );
    const event = makeEventRow({ gdelt_event_id: "3" });
    const decision = decideForEvent(event, [looseMatch, closeMatch]);
    expect(decision.action).toBe("join");
    if (decision.action === "join") expect(decision.situationId).toBe("sit-close");
  });
});

describe("updateSituationWithEvent", () => {
  it("moves the centroid via a running weighted average, not a snap to the new event", () => {
    const situation = situationFromEvent("sit-1", makeEventRow({ lat: 20.0, lon: 120.0 }));
    const updated = updateSituationWithEvent(situation, makeEventRow({ lat: 30.0, lon: 130.0 }));
    // eventCount was 1, so the average should be the midpoint exactly.
    expect(updated.centroidLat).toBeCloseTo(25.0, 6);
    expect(updated.centroidLon).toBeCloseTo(125.0, 6);
    expect(updated.eventCount).toBe(2);
  });

  it("merges entity signatures rather than replacing them", () => {
    const situation = situationFromEvent("sit-1", makeEventRow({ actor2_code: "CHN" }));
    const updated = updateSituationWithEvent(situation, makeEventRow({ actor1_code: "RUS", actor2_code: null }));
    expect(updated.entitySignature.has("actor:USA")).toBe(true);
    expect(updated.entitySignature.has("actor:CHN")).toBe(true);
    expect(updated.entitySignature.has("actor:RUS")).toBe(true);
  });

  it("uses a running max for sourceCount, not a sum (avoids double-counting the same outlets)", () => {
    const situation = situationFromEvent("sit-1", makeEventRow({ num_sources: 5 }));
    const updated = updateSituationWithEvent(situation, makeEventRow({ num_sources: 3 }));
    expect(updated.sourceCount).toBe(5);
    const updatedHigher = updateSituationWithEvent(situation, makeEventRow({ num_sources: 8 }));
    expect(updatedHigher.sourceCount).toBe(8);
  });

  it("advances lastEventAt only when the new event is actually later", () => {
    const situation = situationFromEvent("sit-1", makeEventRow({ occurred_at: "2026-09-20T12:00:00Z" }));
    const updatedEarlier = updateSituationWithEvent(situation, makeEventRow({ occurred_at: "2026-09-20T08:00:00Z" }));
    expect(updatedEarlier.lastEventAt).toBe("2026-09-20T12:00:00Z");
    const updatedLater = updateSituationWithEvent(situation, makeEventRow({ occurred_at: "2026-09-20T18:00:00Z" }));
    expect(updatedLater.lastEventAt).toBe("2026-09-20T18:00:00Z");
  });
});

describe("situationSimilarity + mergeSituations", () => {
  function makeSituation(overrides: Partial<SituationState> = {}): SituationState {
    return {
      id: "s",
      category: "militaryMovement",
      centroidLat: 23.5,
      centroidLon: 121.0,
      entitySignature: new Set(["actor:USA", "geo:TW"]),
      lastEventAt: "2026-09-20T10:00:00Z",
      eventCount: 2,
      sourceCount: 4,
      ...overrides,
    };
  }

  it("scores two near-identical situations above the merge threshold", () => {
    const a = makeSituation({ id: "a" });
    const b = makeSituation({ id: "b", lastEventAt: "2026-09-20T10:30:00Z" });
    expect(situationSimilarity(a, b)).toBeGreaterThanOrEqual(MERGE_THRESHOLD);
  });

  it("scores two unrelated situations well below the merge threshold", () => {
    const a = makeSituation({ id: "a" });
    const b = makeSituation({
      id: "b",
      category: "centralBankDecision",
      centroidLat: 38.9,
      centroidLon: -77.0,
      entitySignature: new Set(["actor:USAGOV"]),
    });
    expect(situationSimilarity(a, b)).toBeLessThan(MERGE_THRESHOLD);
  });

  it("mergeSituations combines event counts, unions entities, and keeps the survivor's id", () => {
    const survivor = makeSituation({ id: "survivor", eventCount: 5, sourceCount: 5 });
    const absorbed = makeSituation({
      id: "absorbed",
      eventCount: 2,
      sourceCount: 3,
      entitySignature: new Set(["actor:RUS"]),
    });
    const merged = mergeSituations(survivor, absorbed);
    expect(merged.id).toBe("survivor");
    expect(merged.eventCount).toBe(7);
    expect(merged.sourceCount).toBe(5);
    expect(merged.entitySignature.has("actor:USA")).toBe(true);
    expect(merged.entitySignature.has("actor:RUS")).toBe(true);
  });

  it("mergeSituations keeps the survivor's category when it has more events, else the absorbed one's", () => {
    const survivor = makeSituation({ id: "survivor", eventCount: 5, category: "militaryMovement" });
    const absorbedWithMoreEvents = makeSituation({ id: "absorbed", eventCount: 10, category: "warArmedConflict" });
    const merged = mergeSituations(survivor, absorbedWithMoreEvents);
    expect(merged.category).toBe("warArmedConflict");
  });
});

describe("isVisibleOnMap", () => {
  it("is false below the minimum corroborating-source count", () => {
    expect(isVisibleOnMap({ sourceCount: 1 })).toBe(false);
    expect(isVisibleOnMap({ sourceCount: 2 })).toBe(false);
  });

  it("is true at and above the minimum", () => {
    expect(isVisibleOnMap({ sourceCount: 3 })).toBe(true);
    expect(isVisibleOnMap({ sourceCount: 10 })).toBe(true);
  });
});

describe("end-to-end: a realistic multi-event situation forms and stays hidden until 3 sources corroborate", () => {
  it("walks through create -> join -> join, becoming visible only on the third source", () => {
    let situations: SituationState[] = [];

    const first = makeEventRow({ gdelt_event_id: "1", num_sources: 1, occurred_at: "2026-09-20T10:00:00Z" });
    const decision1 = decideForEvent(first, situations);
    expect(decision1.action).toBe("create");
    const situation = situationFromEvent("sit-1", first);
    situations = [situation];
    expect(isVisibleOnMap(situation)).toBe(false);

    const second = makeEventRow({ gdelt_event_id: "2", num_sources: 2, occurred_at: "2026-09-20T10:20:00Z" });
    const decision2 = decideForEvent(second, situations);
    expect(decision2.action).toBe("join");
    situations = [updateSituationWithEvent(situation, second)];
    expect(isVisibleOnMap(situations[0]!)).toBe(false); // max(1,2)=2, still below 3

    const third = makeEventRow({ gdelt_event_id: "3", num_sources: 3, occurred_at: "2026-09-20T10:40:00Z" });
    const decision3 = decideForEvent(third, situations);
    expect(decision3.action).toBe("join");
    situations = [updateSituationWithEvent(situations[0]!, third)];
    expect(isVisibleOnMap(situations[0]!)).toBe(true); // max(2,3)=3, now visible
    expect(situations[0]!.eventCount).toBe(3);
  });
});

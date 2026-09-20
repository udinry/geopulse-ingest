import { describe, expect, it } from "vitest";
import { entitySignatureForEvent, jaccardOverlap } from "../src/cluster/entitySignature.js";

describe("entitySignatureForEvent", () => {
  it("builds actor: and geo: prefixed entries from structured GDELT fields", () => {
    const sig = entitySignatureForEvent({ actor1_code: "USA", actor2_code: "CHN", country_iso: "TW" });
    expect(sig).toEqual(new Set(["actor:USA", "actor:CHN", "geo:TW"]));
  });

  it("omits entries for null fields rather than adding a placeholder", () => {
    const sig = entitySignatureForEvent({ actor1_code: null, actor2_code: null, country_iso: "TW" });
    expect(sig).toEqual(new Set(["geo:TW"]));
  });

  it("produces an empty set when nothing is resolved", () => {
    const sig = entitySignatureForEvent({ actor1_code: null, actor2_code: null, country_iso: null });
    expect(sig.size).toBe(0);
  });
});

describe("jaccardOverlap", () => {
  it("scores 1.0 for identical signatures", () => {
    const a = entitySignatureForEvent({ actor1_code: "USA", actor2_code: "CHN", country_iso: "TW" });
    expect(jaccardOverlap(a, new Set(a))).toBe(1);
  });

  it("scores partial overlap correctly for two events sharing one actor", () => {
    const a = entitySignatureForEvent({ actor1_code: "USA", actor2_code: "CHN", country_iso: "TW" });
    const b = entitySignatureForEvent({ actor1_code: "USA", actor2_code: "RUS", country_iso: "TW" });
    // shared: actor:USA, geo:TW (2) — union: actor:USA, actor:CHN, actor:RUS, geo:TW (4)
    expect(jaccardOverlap(a, b)).toBeCloseTo(0.5, 6);
  });

  it("scores 0 for two empty signatures rather than NaN", () => {
    expect(jaccardOverlap(new Set(), new Set())).toBe(0);
  });
});

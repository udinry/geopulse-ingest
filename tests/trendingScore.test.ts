import { describe, expect, it } from "vitest";
import {
  applyImpulse,
  combineImpulse,
  decayScore,
  initialScoreState,
  makeImpulseComponents,
  BOOTSTRAP_PRIOR_WEIGHTS,
} from "../src/score/trendingScoreAccumulator.js";

describe("trending score accumulator", () => {
  it("decays to exactly half after one category half-life", () => {
    const state = initialScoreState("earthquakeTsunami", "2026-09-20T00:00:00Z", 1);
    const decayed = decayScore(state, "2026-09-20T06:00:00Z");
    expect(decayed.score).toBeCloseTo(0.5, 12);
    expect(decayed.lastUpdatedIso).toBe("2026-09-20T06:00:00Z");
  });

  it("decays before adding a new impulse and can rise again", () => {
    const state = initialScoreState("earthquakeTsunami", "2026-09-20T00:00:00Z", 1);
    const updated = applyImpulse(state, 0.75, "2026-09-20T06:00:00Z");
    expect(updated.score).toBeCloseTo(1.25, 12);
  });

  it("clamps component inputs but does not let a negative impulse enter the accumulator", () => {
    expect(makeImpulseComponents({
      newsVelocity: -1,
      sourceConfirmation: 0.5,
      severity: 2,
      marketMovement: 0,
      outlookMovement: 0,
    })).toEqual({ newsVelocity: 0, sourceConfirmation: 0.5, severity: 1, marketMovement: 0, outlookMovement: 0 });
    const state = initialScoreState("militaryMovement", "2026-09-20T00:00:00Z", -2);
    expect(applyImpulse(state, -1, "2026-09-20T00:00:00Z").score).toBe(0);
  });

  it("combines the bootstrap prior as a weighted sum", () => {
    expect(combineImpulse(BOOTSTRAP_PRIOR_WEIGHTS, {
      newsVelocity: 1,
      sourceConfirmation: 0,
      severity: 1,
      marketMovement: 0,
      outlookMovement: 0,
    })).toBeCloseTo(0.55, 12);
  });
});

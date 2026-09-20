import { describe, expect, it } from "vitest";
import {
  hasSignificantAssetMove,
  hasSignificantOutlookMove,
  hasSustainedCoverage,
  isObjectivelyMajor,
  type MajorSituationEvidence,
} from "../src/score/labelSet.js";

const none: MajorSituationEvidence = {
  coverageHours: 0,
  distinctSources: 0,
  maxAssetMoveSigma: 0,
  maxOutlookMovePoints: 0,
};

describe("objective major-situation labels", () => {
  it("uses inclusive thresholds for sustained coverage", () => {
    expect(hasSustainedCoverage({ ...none, coverageHours: 72, distinctSources: 30 })).toBe(true);
    expect(hasSustainedCoverage({ ...none, coverageHours: 71.99, distinctSources: 30 })).toBe(false);
    expect(hasSustainedCoverage({ ...none, coverageHours: 72, distinctSources: 29 })).toBe(false);
  });

  it("requires strictly more than the movement thresholds", () => {
    expect(hasSignificantAssetMove({ ...none, maxAssetMoveSigma: 2 })).toBe(false);
    expect(hasSignificantAssetMove({ ...none, maxAssetMoveSigma: 2.01 })).toBe(true);
    expect(hasSignificantOutlookMove({ ...none, maxOutlookMovePoints: 15 })).toBe(false);
    expect(hasSignificantOutlookMove({ ...none, maxOutlookMovePoints: 15.01 })).toBe(true);
  });

  it("labels a situation major only when at least two criteria are met", () => {
    expect(isObjectivelyMajor({ ...none, maxAssetMoveSigma: 3 })).toBe(false);
    expect(isObjectivelyMajor({ ...none, maxAssetMoveSigma: 3, maxOutlookMovePoints: 20 })).toBe(true);
    expect(isObjectivelyMajor({ ...none, coverageHours: 72, distinctSources: 30, maxOutlookMovePoints: 16 })).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { enumerateSimplexWeights, gridSearchWeights, weightVector, type CalibrationExample } from "../src/score/gridSearch.js";

describe("weight grid search", () => {
  it("enumerates the complete five-weight simplex at 0.5 resolution", () => {
    const weights = enumerateSimplexWeights(0.5);
    expect(weights).toHaveLength(15); // C(2 + 5 - 1, 5 - 1)
    for (const weight of weights) expect(weightVector(weight).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
  });

  it("finds the component that ranks major examples highest", () => {
    const examples: CalibrationExample[] = [
      { components: { newsVelocity: 0, sourceConfirmation: 0, severity: 0, marketMovement: 0, outlookMovement: 0 }, relevance: 0 },
      { components: { newsVelocity: 1, sourceConfirmation: 0, severity: 0, marketMovement: 0, outlookMovement: 0 }, relevance: 1 },
      { components: { newsVelocity: 0, sourceConfirmation: 1, severity: 0, marketMovement: 0, outlookMovement: 0 }, relevance: 0 },
      { components: { newsVelocity: 0, sourceConfirmation: 0, severity: 1, marketMovement: 0, outlookMovement: 0 }, relevance: 0 },
    ];
    const result = gridSearchWeights(examples, 1, 0.5);
    expect(result.ndcg).toBe(1);
    expect(result.weights.newsVelocity).toBeGreaterThan(0);
  });

  it("rejects invalid calibration inputs", () => {
    expect(() => enumerateSimplexWeights(0.3)).toThrow();
    expect(() => gridSearchWeights([], 10, 0.5)).toThrow();
    expect(() => gridSearchWeights([{ components: { newsVelocity: 0, sourceConfirmation: 0, severity: 0, marketMovement: 0, outlookMovement: 0 }, relevance: 0 }], 0, 0.5)).toThrow();
  });
});

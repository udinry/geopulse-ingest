import { combineImpulse, type ImpulseComponents, type TrendingScoreWeights } from "./trendingScoreAccumulator.js";
import { ndcgAtK } from "./ndcg.js";

export interface CalibrationExample {
  components: ImpulseComponents;
  /** Binary relevance: 1 for an objectively major situation, otherwise 0. */
  relevance: 0 | 1;
}

export interface GridSearchResult {
  weights: TrendingScoreWeights;
  ndcg: number;
}

const WEIGHT_KEYS: (keyof TrendingScoreWeights)[] = [
  "newsVelocity",
  "sourceConfirmation",
  "severity",
  "marketMovement",
  "outlookMovement",
];

/**
 * Enumerates every non-negative five-weight vector on the requested simplex.
 * `resolution` must represent an exact integer number of steps per unit (the
 * calibration run uses 0.05, or 20 steps), avoiding floating-point drift.
 */
export function enumerateSimplexWeights(resolution = 0.05): TrendingScoreWeights[] {
  if (!Number.isFinite(resolution) || resolution <= 0) {
    throw new Error("resolution must be a positive finite number");
  }
  const steps = Math.round(1 / resolution);
  if (!Number.isInteger(steps) || Math.abs(steps * resolution - 1) > 1e-9) {
    throw new Error("resolution must divide 1 exactly");
  }

  const weights: TrendingScoreWeights[] = [];
  for (let a = 0; a <= steps; a++) {
    for (let b = 0; b <= steps - a; b++) {
      for (let c = 0; c <= steps - a - b; c++) {
        for (let d = 0; d <= steps - a - b - c; d++) {
          const e = steps - a - b - c - d;
          weights.push({
            newsVelocity: a / steps,
            sourceConfirmation: b / steps,
            severity: c / steps,
            marketMovement: d / steps,
            outlookMovement: e / steps,
          });
        }
      }
    }
  }
  return weights;
}

/** Finds the highest-NDCG weight vector, retaining the first vector on ties. */
export function gridSearchWeights(
  examples: readonly CalibrationExample[],
  k = 10,
  resolution = 0.05,
): GridSearchResult {
  if (examples.length === 0) throw new Error("at least one calibration example is required");
  if (!Number.isInteger(k) || k <= 0) throw new Error("k must be a positive integer");

  let best: GridSearchResult | undefined;
  for (const weights of enumerateSimplexWeights(resolution)) {
    const ranked = [...examples]
      .map((example, index) => ({ score: combineImpulse(weights, example.components), index, relevance: example.relevance }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const score = ndcgAtK(ranked.map((item) => item.relevance), k);
    if (best === undefined || score > best.ndcg) best = { weights, ndcg: score };
  }
  return best as GridSearchResult;
}

/** Keeps the public weight object order explicit when serializing or comparing results. */
export function weightVector(weights: TrendingScoreWeights): number[] {
  return WEIGHT_KEYS.map((key) => weights[key]);
}

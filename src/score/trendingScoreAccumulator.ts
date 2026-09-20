/**
 * Server-side mirror of GeoPulseKit's TrendingScoreAccumulator (Swift) — the decaying
 * accumulator formula from planning doc §5: `S(t) = Σ Iᵢ · e^(-λ_c · (t - tᵢ))`,
 * λ_c = ln2 / halflife(category). This is the FOURTH independent copy of the
 * category half-life concept across the two repos/languages (Swift enum property, this
 * repo's eventCategoryHalfLife.ts already used by clustering, and now this scoring
 * module) — reuses eventCategoryHalfLife.ts rather than a fifth copy.
 *
 * See GeoPulseKit's TrendingScoreAccumulator.swift for the full rationale (decays AND
 * can re-rise, incrementally computable in O(1) rather than O(history)) — this is the
 * same algorithm, kept in sync deliberately.
 */
import { EVENT_CATEGORY_HALF_LIFE_HOURS } from "../shared/eventCategoryHalfLife.js";
import type { EventCategory } from "../shared/types.js";

export interface ScoreState {
  score: number;
  lastUpdatedIso: string;
  category: EventCategory;
}

function lambdaPerHour(category: EventCategory): number {
  return Math.LN2 / EVENT_CATEGORY_HALF_LIFE_HOURS[category];
}

/** Decays a score state to `nowIso` without adding any new impulse. */
export function decayScore(state: ScoreState, nowIso: string): ScoreState {
  const hours = (new Date(nowIso).getTime() - new Date(state.lastUpdatedIso).getTime()) / (1000 * 60 * 60);
  if (hours <= 0) return state;
  const decayed = state.score * Math.exp(-lambdaPerHour(state.category) * hours);
  return { ...state, score: decayed, lastUpdatedIso: nowIso };
}

/** Decays to `atIso`, then adds a new impulse magnitude (already clamped to [0,1] by
 * the caller — see ImpulseComponents/combineImpulse below). */
export function applyImpulse(state: ScoreState, magnitude: number, atIso: string): ScoreState {
  const decayed = decayScore(state, atIso);
  return { ...decayed, score: decayed.score + Math.max(0, magnitude) };
}

export function initialScoreState(category: EventCategory, atIso: string, magnitude: number): ScoreState {
  return { score: Math.max(0, magnitude), lastUpdatedIso: atIso, category };
}

// ── Impulse components + weights — mirrors GeoPulseKit's ImpulseComponents/
// TrendingScoreWeights exactly. ─────────────────────────────────────────────────

export interface ImpulseComponents {
  newsVelocity: number;
  sourceConfirmation: number;
  severity: number;
  marketMovement: number;
  outlookMovement: number;
}

function clampUnit(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function makeImpulseComponents(raw: ImpulseComponents): ImpulseComponents {
  return {
    newsVelocity: clampUnit(raw.newsVelocity),
    sourceConfirmation: clampUnit(raw.sourceConfirmation),
    severity: clampUnit(raw.severity),
    marketMovement: clampUnit(raw.marketMovement),
    outlookMovement: clampUnit(raw.outlookMovement),
  };
}

export interface TrendingScoreWeights {
  newsVelocity: number;
  sourceConfirmation: number;
  severity: number;
  marketMovement: number;
  outlookMovement: number;
}

/** The pre-calibration bootstrap prior — see planning doc §5.4 and data/weights.json's
 * own "calibrated: false" flag. Identical to GeoPulseKit's TrendingScoreWeights.bootstrapPrior. */
export const BOOTSTRAP_PRIOR_WEIGHTS: TrendingScoreWeights = {
  newsVelocity: 0.25,
  sourceConfirmation: 0.2,
  severity: 0.3,
  marketMovement: 0.15,
  outlookMovement: 0.1,
};

export function combineImpulse(weights: TrendingScoreWeights, components: ImpulseComponents): number {
  const c = makeImpulseComponents(components);
  return (
    weights.newsVelocity * c.newsVelocity +
    weights.sourceConfirmation * c.sourceConfirmation +
    weights.severity * c.severity +
    weights.marketMovement * c.marketMovement +
    weights.outlookMovement * c.outlookMovement
  );
}

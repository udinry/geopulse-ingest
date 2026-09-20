/**
 * The clustering similarity function itself — planning doc §8:
 *
 *   sim(e,s) = 0.40·entityOverlap(e,s) + 0.25·geoProximity(e,s)
 *            + 0.20·categoryCompat(e,s) + 0.15·timeProximity(e,s)
 *
 * `SituationState` is the lightweight in-memory aggregate a candidate event is
 * compared against — deliberately not tied to a live D1 connection (that wiring is
 * Phase 5's job, same deferred-IO pattern as Phase 2's fetch/parse pipeline being pure
 * functions). In production this is what a Phase 5 read-then-decide step builds from
 * `situations` + `situation_entities` + the most recent `situation_events` row.
 */
import { categoryCompat } from "./categoryCompat.js";
import { entitySignatureForEvent, jaccardOverlap } from "./entitySignature.js";
import { geoProximity } from "./geoProximity.js";
import { EVENT_CATEGORY_HALF_LIFE_HOURS } from "../shared/eventCategoryHalfLife.js";
import type { EventCategory, EventRow } from "../shared/types.js";

export interface SituationState {
  id: string;
  category: EventCategory;
  centroidLat: number;
  centroidLon: number;
  entitySignature: Set<string>;
  lastEventAt: string;
  eventCount: number;
  sourceCount: number;
}

export interface SimilarityWeights {
  entityOverlap: number;
  geoProximity: number;
  categoryCompat: number;
  timeProximity: number;
}

/** The weights from planning doc §8. Unlike the trending score's weights, these are
 * not (yet) backtested against historical data — see PLAN.md's Phase 3 notes for the
 * same calibration treatment being a reasonable future refinement, not required to ship
 * a working first version, since the plan itself specifies these as fixed values
 * rather than "starting priors" the way it explicitly calls out for the trending score. */
export const SIMILARITY_WEIGHTS: SimilarityWeights = {
  entityOverlap: 0.4,
  geoProximity: 0.25,
  categoryCompat: 0.2,
  timeProximity: 0.15,
};

function timeProximity(eventOccurredAtIso: string, situationLastEventAtIso: string, category: EventCategory): number {
  const eventTime = new Date(eventOccurredAtIso).getTime();
  const situationTime = new Date(situationLastEventAtIso).getTime();
  if (Number.isNaN(eventTime) || Number.isNaN(situationTime)) return 0;
  const deltaHours = Math.abs(eventTime - situationTime) / (1000 * 60 * 60);
  const halfLife = EVENT_CATEGORY_HALF_LIFE_HOURS[category];
  return Math.exp((-Math.LN2 * deltaHours) / halfLife);
}

export function similarity(
  event: EventRow,
  situation: SituationState,
  weights: SimilarityWeights = SIMILARITY_WEIGHTS
): number {
  if (event.lat === null || event.lon === null) {
    // No resolved location: geoProximity can't be computed meaningfully. Rather than
    // guess a coordinate, fall back to renormalizing across the remaining three terms
    // — the same "missing component renormalizes rather than zeroing the whole score"
    // principle the trending score's outlook component uses (docs/ARCHITECTURE.md §9).
    const remaining = weights.entityOverlap + weights.categoryCompat + weights.timeProximity;
    const entity = jaccardOverlap(entitySignatureForEvent(event), situation.entitySignature);
    const category = categoryCompat(event.category, situation.category);
    const time = timeProximity(event.occurred_at, situation.lastEventAt, situation.category);
    return (
      (weights.entityOverlap * entity + weights.categoryCompat * category + weights.timeProximity * time) /
      remaining
    );
  }

  const entity = jaccardOverlap(entitySignatureForEvent(event), situation.entitySignature);
  const geo = geoProximity(event.lat, event.lon, situation.centroidLat, situation.centroidLon);
  const category = categoryCompat(event.category, situation.category);
  const time = timeProximity(event.occurred_at, situation.lastEventAt, situation.category);

  return (
    weights.entityOverlap * entity +
    weights.geoProximity * geo +
    weights.categoryCompat * category +
    weights.timeProximity * time
  );
}

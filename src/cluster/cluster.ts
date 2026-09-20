/**
 * Incremental single-link clustering: events join existing situations, or start new
 * ones — planning doc §8. Pure functions operating on in-memory `SituationState`;
 * reading the current active-situation set from D1 and writing decisions back is
 * Phase 5's job (same deferred-IO boundary as Phase 2's fetch/parse pipeline).
 */
import { categoryCompat } from "./categoryCompat.js";
import { entitySignatureForEvent, jaccardOverlap } from "./entitySignature.js";
import { geoProximity } from "./geoProximity.js";
import { similarity, type SituationState } from "./similarity.js";
import { EVENT_CATEGORY_HALF_LIFE_HOURS } from "../shared/eventCategoryHalfLife.js";
import type { EventRow } from "../shared/types.js";

/** sim >= this joins an existing situation — planning doc §8. */
export const JOIN_THRESHOLD = 0.55;
/** Two situations' centroid similarity >= this triggers a merge — planning doc §8. */
export const MERGE_THRESHOLD = 0.75;
/** A situation stays hidden from the map until it has this many corroborating
 * sources — suppresses single-source noise (planning doc §8). */
export const MAP_VISIBILITY_MIN_SOURCES = 3;

export interface JoinDecision {
  action: "join";
  situationId: string;
  score: number;
}
export interface CreateDecision {
  action: "create";
}
export type ClusterDecision = JoinDecision | CreateDecision;

/** Finds the best-matching active situation for a new event, or signals that a new
 * situation should be created. Never joins below threshold, even if it's the closest
 * match available — a bad join is worse than a new (possibly later-merged) situation. */
export function decideForEvent(
  event: EventRow,
  activeSituations: readonly SituationState[],
  joinThreshold: number = JOIN_THRESHOLD
): ClusterDecision {
  let best: { situation: SituationState; score: number } | null = null;
  for (const situation of activeSituations) {
    const score = similarity(event, situation);
    if (best === null || score > best.score) {
      best = { situation, score };
    }
  }
  if (best !== null && best.score >= joinThreshold) {
    return { action: "join", situationId: best.situation.id, score: best.score };
  }
  return { action: "create" };
}

/** Creates a brand-new SituationState from the first event of a new situation. */
export function situationFromEvent(situationId: string, event: EventRow): SituationState {
  return {
    id: situationId,
    category: event.category,
    centroidLat: event.lat ?? 0,
    centroidLon: event.lon ?? 0,
    entitySignature: entitySignatureForEvent(event),
    lastEventAt: event.occurred_at,
    eventCount: 1,
    sourceCount: event.num_sources,
  };
}

/** Folds a joining event into an existing situation's aggregate state. The centroid
 * moves via a running weighted average (by event count so far) rather than snapping
 * to the new event's location outright — one late outlier report shouldn't relocate
 * an entire situation. sourceCount uses a running max, not a sum: GDELT's per-event
 * num_sources already counts distinct outlets for THAT event, and summing across
 * events in the same situation would double-count outlets that cover multiple
 * developments in the same story — see PLAN.md's Phase 3 notes for why this is a
 * deliberately conservative proxy pending Phase 5's real distinct-source count from
 * joined article data. */
export function updateSituationWithEvent(situation: SituationState, event: EventRow): SituationState {
  const n = situation.eventCount;
  const newCentroidLat =
    event.lat !== null ? (situation.centroidLat * n + event.lat) / (n + 1) : situation.centroidLat;
  const newCentroidLon =
    event.lon !== null ? (situation.centroidLon * n + event.lon) / (n + 1) : situation.centroidLon;

  const mergedSignature = new Set(situation.entitySignature);
  for (const item of entitySignatureForEvent(event)) mergedSignature.add(item);

  const eventTime = new Date(event.occurred_at).getTime();
  const situationTime = new Date(situation.lastEventAt).getTime();
  const lastEventAt = eventTime > situationTime ? event.occurred_at : situation.lastEventAt;

  return {
    ...situation,
    centroidLat: newCentroidLat,
    centroidLon: newCentroidLon,
    entitySignature: mergedSignature,
    lastEventAt,
    eventCount: n + 1,
    sourceCount: Math.max(situation.sourceCount, event.num_sources),
  };
}

/** Symmetric situation-to-situation similarity, for the merge check. Reuses the same
 * four terms as event-to-situation similarity; time proximity uses the average of the
 * two situations' category half-lives since neither side is more "authoritative" than
 * the other here (unlike event-to-situation, where the situation's established pace
 * is what a new event is being measured against). */
export function situationSimilarity(a: SituationState, b: SituationState): number {
  const entity = jaccardOverlap(a.entitySignature, b.entitySignature);
  const geo = geoProximity(a.centroidLat, a.centroidLon, b.centroidLat, b.centroidLon);
  const category = categoryCompat(a.category, b.category);

  const timeA = new Date(a.lastEventAt).getTime();
  const timeB = new Date(b.lastEventAt).getTime();
  const deltaHours = Number.isNaN(timeA) || Number.isNaN(timeB) ? Infinity : Math.abs(timeA - timeB) / (1000 * 60 * 60);
  const avgHalfLife = (EVENT_CATEGORY_HALF_LIFE_HOURS[a.category] + EVENT_CATEGORY_HALF_LIFE_HOURS[b.category]) / 2;
  const time = Math.exp((-Math.LN2 * deltaHours) / avgHalfLife);

  return 0.4 * entity + 0.25 * geo + 0.2 * category + 0.15 * time;
}

/** Merges two situations into one aggregate (the caller decides which `id` survives —
 * conventionally the earlier-created one, with the other redirected, so deep links and
 * alerts on the merged-away situation keep resolving — see planning doc §8). */
export function mergeSituations(survivor: SituationState, absorbed: SituationState): SituationState {
  const totalEvents = survivor.eventCount + absorbed.eventCount;
  const mergedSignature = new Set(survivor.entitySignature);
  for (const item of absorbed.entitySignature) mergedSignature.add(item);

  const survivorTime = new Date(survivor.lastEventAt).getTime();
  const absorbedTime = new Date(absorbed.lastEventAt).getTime();

  return {
    id: survivor.id,
    // The situation with more corroborating events keeps its category — a better
    // proxy for "what this story is actually about" than an arbitrary tie-break.
    category: survivor.eventCount >= absorbed.eventCount ? survivor.category : absorbed.category,
    centroidLat: (survivor.centroidLat * survivor.eventCount + absorbed.centroidLat * absorbed.eventCount) / totalEvents,
    centroidLon: (survivor.centroidLon * survivor.eventCount + absorbed.centroidLon * absorbed.eventCount) / totalEvents,
    entitySignature: mergedSignature,
    lastEventAt: survivorTime >= absorbedTime ? survivor.lastEventAt : absorbed.lastEventAt,
    eventCount: totalEvents,
    sourceCount: Math.max(survivor.sourceCount, absorbed.sourceCount),
  };
}

export function isVisibleOnMap(situation: Pick<SituationState, "sourceCount">): boolean {
  return situation.sourceCount >= MAP_VISIBILITY_MIN_SOURCES;
}

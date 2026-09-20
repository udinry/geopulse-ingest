/**
 * The `entityOverlap` term's input: a comparable entity signature for an event, built
 * from GDELT's own STRUCTURED actor/country codes rather than free-text NER.
 *
 * This is a real improvement over Phase 2 dedup's coarse capitalized-token proxy
 * (src/dedupe/entityOverlap.ts — kept as-is there, it operates on headline text where
 * structured codes aren't available): every GDELT event already carries Actor1/Actor2
 * country codes and a resolved event-location country, all deterministic and reliable.
 * No gazetteer-building was needed to get a real signature for THIS purpose — the
 * `entities` table (situation_entities, Phase 1's schema) is populated from these same
 * signatures as situations accumulate events, not from a separately-built NER pass.
 */
import type { EventRow } from "../shared/types.js";

export function entitySignatureForEvent(event: Pick<EventRow, "actor1_code" | "actor2_code" | "country_iso">): Set<string> {
  const signature = new Set<string>();
  if (event.actor1_code) signature.add(`actor:${event.actor1_code}`);
  if (event.actor2_code) signature.add(`actor:${event.actor2_code}`);
  if (event.country_iso) signature.add(`geo:${event.country_iso}`);
  return signature;
}

export function jaccardOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

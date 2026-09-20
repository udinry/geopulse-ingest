/**
 * The `categoryCompat` term of the clustering similarity function (planning doc §8:
 * `sim(e,s) = 0.40·entityOverlap + 0.25·geoProximity + 0.20·categoryCompat + 0.15·timeProximity`).
 *
 * Rather than hand-curate a 19x19 category-pair matrix (361 mostly-arbitrary-looking
 * numbers — exactly the kind of fabricated precision the project avoids elsewhere,
 * e.g. the trending score's weights are a named, calibrated prior, not invented), this
 * uses the product brief's own three pillars (Geopolitical / Economic-Financial /
 * Physical-World — see docs/planning/2026-09-20-initial-plan.md §8): same category is
 * a perfect match, same pillar is meaningfully compatible (a military movement and a
 * territorial dispute are often the same unfolding story), cross-pillar is low but
 * non-zero (a military escalation CAN cause an oil disruption — the other three
 * similarity terms, especially entity overlap, are what should carry a genuine
 * cross-pillar join, not this term pretending to know the specific relationship).
 */
import type { EventCategory } from "../shared/types.js";

export type CategoryPillar = "geopolitical" | "economic" | "physical";

const PILLAR_BY_CATEGORY: Readonly<Record<EventCategory, CategoryPillar>> = {
  warArmedConflict: "geopolitical",
  militaryMovement: "geopolitical",
  terrorismSecurityIncident: "geopolitical",
  electionPoliticalTransition: "geopolitical",
  protestCivilUnrest: "geopolitical",
  diplomaticNegotiation: "geopolitical",
  sanctionsTradeRestriction: "geopolitical",
  internationalDispute: "geopolitical",
  centralBankDecision: "economic",
  macroDataRelease: "economic",
  fiscalPolicy: "economic",
  bankingFinancialSystem: "economic",
  majorCorporateEvent: "economic",
  oilEnergyDisruption: "physical",
  shippingMaritimeDisruption: "physical",
  aviationDisruption: "physical",
  earthquakeTsunami: "physical",
  hurricaneExtremeWeather: "physical",
  majorFireIndustrialAccident: "physical",
};

const SAME_CATEGORY = 1.0;
const SAME_PILLAR = 0.5;
const CROSS_PILLAR = 0.1;

export function pillarOf(category: EventCategory): CategoryPillar {
  return PILLAR_BY_CATEGORY[category];
}

export function categoryCompat(a: EventCategory, b: EventCategory): number {
  if (a === b) return SAME_CATEGORY;
  return PILLAR_BY_CATEGORY[a] === PILLAR_BY_CATEGORY[b] ? SAME_PILLAR : CROSS_PILLAR;
}

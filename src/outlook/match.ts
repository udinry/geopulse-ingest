import type { OutlookMarketRow, SituationRow } from "../shared/types.js";

export interface OutlookMatch {
  situationId: string;
  marketId: string;
  confidence: number;
  matchedBy: "category" | "token";
  method: "outlook_match_v1";
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((token) => token.length >= 4));
}

/** Auditable token/category matcher. It never uses venue, slug, or URL. */
export function matchOutlook(situation: Pick<SituationRow, "id" | "title" | "category">, market: Pick<OutlookMarketRow, "id" | "question_normalised" | "category">): OutlookMatch | null {
  const left = tokens(situation.title);
  const right = tokens(market.question_normalised);
  const overlap = [...left].filter((token) => right.has(token)).length;
  const categoryMatch = market.category !== null && market.category === situation.category;
  const confidence = Math.min(1, (overlap / Math.max(1, Math.min(left.size, right.size))) * 0.8 + (categoryMatch ? 0.2 : 0));
  if (confidence < 0.7) return null;
  return { situationId: situation.id, marketId: market.id, confidence, matchedBy: categoryMatch ? "category" : "token", method: "outlook_match_v1" };
}

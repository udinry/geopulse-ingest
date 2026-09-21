import type { EventCategory } from "../shared/types.js";

/** Shared, deterministic rule matching for situation -> company and situation -> asset links. */
export interface RuleBase {
  id: string;
  /** Matches when the situation's category is in this list... */
  categories?: readonly EventCategory[];
  /** ...and/or its title/place contains any of these (lowercase) substrings. */
  keywords?: readonly string[];
  /** When true, BOTH must match (a keyword alone in an unrelated category doesn't link). */
  requireBoth?: boolean;
}

export interface LinkInput {
  category: EventCategory;
  title: string;
  geo_name: string | null;
}

export const CONFLICT: readonly EventCategory[] = ["warArmedConflict", "militaryMovement", "internationalDispute", "sanctionsTradeRestriction"];

export function ruleMatches(rule: RuleBase, input: LinkInput): boolean {
  const haystack = `${input.title} ${input.geo_name ?? ""}`.toLowerCase();
  const categoryHit = rule.categories?.includes(input.category) ?? false;
  const keywordHit = rule.keywords?.some((keyword) => haystack.includes(keyword)) ?? false;
  return rule.requireBoth === true ? categoryHit && keywordHit : categoryHit || keywordHit;
}

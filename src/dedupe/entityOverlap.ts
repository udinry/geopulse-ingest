/**
 * Dedup cascade stage 3 (entity overlap) — see
 * GeoPulse/docs/planning/2026-09-20-initial-plan.md §7.
 *
 * ⚠ SCOPE NOTE: the plan describes this stage as "Jaccard over entity sets from the
 * gazetteer" — the real gazetteer (entities table, resolved via GKG + hand curation)
 * doesn't exist yet; it's built as part of Phase 3's situation clustering. Standing
 * that work up here would mean building Phase 3 to finish Phase 2. Instead, this stage
 * uses a lightweight, deterministic proper-noun heuristic (consecutive capitalized
 * tokens) as an interim entity proxy — a real, documented technique, just a coarser one
 * than full gazetteer resolution. It's ALSO deliberately a confirming signal, not the
 * primary one: stage 2 (SimHash) already does the heavy lifting, so stage 3 only needs
 * to distinguish "these titles are also about the same named things" from "these titles
 * just happen to be structurally similar" — replace with real gazetteer lookups once
 * Phase 3 builds `entities`, without needing to change this stage's role in the cascade.
 */

const STOPWORD_CAPITALS = new Set(["The", "A", "An", "In", "On", "At", "For", "With", "This"]);

/** Extracts a set of likely proper nouns from a title: runs of 1+ capitalized words,
 * joined (so "Taiwan Strait" extracts as one entity, not two). Case-sensitive by
 * design — this is what distinguishes a proper noun from a normal word.
 *
 * One deliberate refinement: a SINGLE capitalized word at the very start of the title
 * (index 0) is excluded — that position is capitalized in virtually every title purely
 * by sentence-case convention ("Military activity reported..."), not because it's a
 * proper noun, and counting it would flood the entity set with noise. A MULTI-word run
 * starting at index 0 ("Taiwan Strait sees...") is still captured — that pattern is a
 * real named entity, sentence-case coincidence doesn't explain two consecutive
 * capitals. Positions after 0 are unaffected by this rule. */
export function extractCapitalizedEntities(title: string): Set<string> {
  const tokens = title.split(/\s+/).filter((t) => t.length > 0);
  const entities = new Set<string>();
  let current: string[] = [];
  let currentRunStartIndex = -1;

  const flush = () => {
    if (current.length > 0) {
      const isLeadingSentenceCaseSingleton = currentRunStartIndex === 0 && current.length === 1;
      const phrase = current.join(" ");
      if (!isLeadingSentenceCaseSingleton && !STOPWORD_CAPITALS.has(phrase)) {
        entities.add(phrase.toLowerCase());
      }
    }
    current = [];
    currentRunStartIndex = -1;
  };

  tokens.forEach((token, index) => {
    const stripped = token.replace(/[^\p{L}\p{N}]/gu, "");
    const isCapitalized = stripped.length > 0 && stripped[0] === stripped[0]?.toUpperCase() && /[A-Z]/.test(stripped[0] ?? "");
    if (isCapitalized && !STOPWORD_CAPITALS.has(stripped)) {
      if (current.length === 0) currentRunStartIndex = index;
      current.push(stripped);
    } else {
      flush();
    }
  });
  flush();

  return entities;
}

export function jaccardSimilarity<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function entityOverlapScore(titleA: string, titleB: string): number {
  return jaccardSimilarity(extractCapitalizedEntities(titleA), extractCapitalizedEntities(titleB));
}

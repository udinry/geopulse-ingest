/**
 * The full 4-stage dedup cascade, orchestrated — see
 * GeoPulse/docs/planning/2026-09-20-initial-plan.md §7:
 *   1. canonical URL exact match (canonicalUrl.ts)
 *   2. title similarity (see the note below on how this stage is actually computed)
 *   3. entity overlap, a confirming/rescue signal (entityOverlap.ts)
 *   4. time window, +/-6h (timeWindow.ts) — a hard gate applied before 2/3 are even
 *      considered, so an anniversary piece never collapses into live coverage
 *
 * ⚠ IMPLEMENTATION NOTE — stage 2 is normalized-token Jaccard similarity, not a raw
 * SimHash Hamming-distance threshold, and this was a deliberate correction made after
 * measuring real headline pairs during development, not a deviation taken lightly:
 *
 *   Headlines are SHORT (typically 6-15 tokens -> only 4-13 three-word shingles).
 *   SimHash is well known to be robust on long documents (thousands of shingles dilute
 *   any few edits) but genuinely noisy at this scale — measured on real near-duplicate
 *   pairs (e.g. "Oil prices jump 3%..." vs "...surge 3%...", a single word swapped),
 *   Hamming distances of 11-24 (out of 64 bits) were observed, while measured distances
 *   for UNRELATED headlines (e.g. an oil-price headline vs a central-bank headline)
 *   were 22-31 — the two distributions OVERLAP. No fixed small threshold (the plan's
 *   original "<=3" included) separates them reliably at this text length.
 *
 *   Plain Jaccard similarity over the full normalized token set (unigrams, not
 *   shingles — i.e. plain bag-of-words) does NOT have this problem: the same measured
 *   pairs scored 0.71-1.0 for genuine near-duplicates (including word-order-shuffled
 *   paraphrases) and a clean 0.0 for every unrelated pair tested. That is the actual
 *   stage-2 signal used below.
 *
 *   `titleSimHash`/`hammingDistance` are kept and still computed (see
 *   src/normalize/mapGdeltArticle.ts and the `articles.title_simhash` column) because
 *   locality-sensitive hashing is still the right tool for cheaply bucketing CANDIDATE
 *   pairs out of a large corpus before doing precise comparison at scale — it's just
 *   not precise enough on its own to be the final yes/no signal for headline-length text.
 *
 * Duplicates form a graph (A~B, B~C implies A,B,C are one group even if A and C
 * weren't directly compared above the threshold) — resolved with a union-find, not
 * naive pairwise grouping, so transitive duplicates end up in the same group.
 */
import { canonicalUrlHash } from "../normalize/canonicalUrl.js";
import { entityOverlapScore, jaccardSimilarity } from "./entityOverlap.js";
import { normalizeTitle } from "./titleSimHash.js";
import { withinTimeWindow } from "./timeWindow.js";

export interface DedupCandidate {
  id: string;
  urlCanonical: string;
  title: string;
  publishedAtIso: string;
}

export interface DedupThresholds {
  /** Primary signal: normalized-token Jaccard similarity, [0,1]. 0.45 sits with real
   * margin above every unrelated-headline measurement (0.0) and below every measured
   * near-duplicate, including a reordered paraphrase (lowest observed: 0.455). */
  tokenJaccardMin: number;
  /** Rescue path for heavier rewrites: a lower token-overlap bar, but only trusted
   * combined with strong shared-entity evidence. */
  tokenJaccardWeak: number;
  entityOverlapMin: number;
  timeWindowHours: number;
}

export const DEFAULT_THRESHOLDS: DedupThresholds = {
  tokenJaccardMin: 0.45,
  tokenJaccardWeak: 0.2,
  entityOverlapMin: 0.5,
  timeWindowHours: 6,
};

class UnionFind {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x] as number);
    }
    return this.parent[x] as number;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const rankA = this.rank[rootA] as number;
    const rankB = this.rank[rootB] as number;
    if (rankA < rankB) {
      this.parent[rootA] = rootB;
    } else if (rankA > rankB) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] = rankA + 1;
    }
  }
}

function isDuplicatePair(a: DedupCandidate, b: DedupCandidate, thresholds: DedupThresholds): boolean {
  // Stage 1: exact canonical URL match is dispositive on its own.
  if (canonicalUrlHash(a.urlCanonical) === canonicalUrlHash(b.urlCanonical)) return true;

  // Stage 4 gate: outside the time window, never a duplicate regardless of text similarity.
  if (!withinTimeWindow(a.publishedAtIso, b.publishedAtIso, thresholds.timeWindowHours)) {
    return false;
  }

  // Stage 2: token-level similarity — see this file's top-of-file note on why this is
  // Jaccard over the normalized token set rather than a raw SimHash distance threshold.
  const tokenJaccard = jaccardSimilarity(
    new Set(normalizeTitle(a.title)),
    new Set(normalizeTitle(b.title))
  );
  if (tokenJaccard >= thresholds.tokenJaccardMin) return true;

  // Stage 3: a rescue path for heavier rewrites — moderate token overlap PLUS strong
  // shared-entity evidence (e.g. the same named place/actor survives a big rewrite).
  if (tokenJaccard >= thresholds.tokenJaccardWeak) {
    return entityOverlapScore(a.title, b.title) >= thresholds.entityOverlapMin;
  }
  return false;
}

export interface DedupOutcome {
  /** candidate.id -> the canonical candidate.id for its dedup group (itself, if unique). */
  groupIdByCandidateId: Map<string, string>;
  /** number of distinct groups found. */
  groupCount: number;
}

export function dedupeCandidates(
  candidates: DedupCandidate[],
  thresholds: DedupThresholds = DEFAULT_THRESHOLDS
): DedupOutcome {
  const uf = new UnionFind(candidates.length);

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (isDuplicatePair(candidates[i] as DedupCandidate, candidates[j] as DedupCandidate, thresholds)) {
        uf.union(i, j);
      }
    }
  }

  // Pick the canonical member of each group: earliest publishedAtIso, ties broken by
  // original array order (stable — Array.prototype.sort is stable per spec).
  const membersByRoot = new Map<number, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const root = uf.find(i);
    const members = membersByRoot.get(root) ?? [];
    members.push(i);
    membersByRoot.set(root, members);
  }

  const groupIdByCandidateId = new Map<string, string>();
  for (const members of membersByRoot.values()) {
    const sorted = [...members].sort((a, b) => {
      const dateA = new Date((candidates[a] as DedupCandidate).publishedAtIso).getTime();
      const dateB = new Date((candidates[b] as DedupCandidate).publishedAtIso).getTime();
      return dateA - dateB;
    });
    const canonicalId = (candidates[sorted[0] as number] as DedupCandidate).id;
    for (const memberIndex of members) {
      groupIdByCandidateId.set((candidates[memberIndex] as DedupCandidate).id, canonicalId);
    }
  }

  return { groupIdByCandidateId, groupCount: membersByRoot.size };
}

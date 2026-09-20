/**
 * Standard NDCG@k (Normalized Discounted Cumulative Gain) — the metric planning doc
 * §5.4 specifies for calibrating the trending-score weights: "grid search... maximising
 * NDCG@10 between predicted ranking and label set." A well-established, standard
 * information-retrieval metric (Järvelin & Kekäläinen, 2002) — not something invented
 * for this project.
 *
 *   DCG@k  = Σ_{i=1}^{k} (2^rel_i - 1) / log2(i + 1)     (i is the 1-based rank)
 *   IDCG@k = DCG@k computed on the ideal (relevance-sorted) ordering
 *   NDCG@k = DCG@k / IDCG@k   (0 when IDCG@k is 0 — no relevant items to rank at all)
 */

/** `relevancesInPredictedOrder[i]` is the true relevance of whatever the predictor
 * ranked in position i (0-based here; the DCG formula's rank i+1 is applied internally). */
export function dcgAtK(relevancesInPredictedOrder: readonly number[], k: number): number {
  let sum = 0;
  const limit = Math.min(k, relevancesInPredictedOrder.length);
  for (let i = 0; i < limit; i++) {
    const relevance = relevancesInPredictedOrder[i] as number;
    sum += (2 ** relevance - 1) / Math.log2(i + 2); // rank = i+1, so log2((i+1)+1)
  }
  return sum;
}

export function ndcgAtK(relevancesInPredictedOrder: readonly number[], k: number): number {
  const dcg = dcgAtK(relevancesInPredictedOrder, k);
  const ideal = [...relevancesInPredictedOrder].sort((a, b) => b - a);
  const idcg = dcgAtK(ideal, k);
  return idcg === 0 ? 0 : dcg / idcg;
}

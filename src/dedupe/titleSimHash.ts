/**
 * Stage 2 of the four-stage news dedup cascade (see
 * GeoPulse/docs/planning/2026-09-20-initial-plan.md §7): a 64-bit SimHash over
 * normalized title 3-shingles. Two titles describing the same event from different
 * publishers ("Reuters: X strikes Y" vs "AP — X strikes Y") should land within a small
 * Hamming distance; two titles about unrelated events should not.
 *
 * This is classic, deterministic, O(1)-comparable locality-sensitive hashing — not a
 * learned embedding, and satisfies the no-AI constraint for the same reason TF-IDF does
 * elsewhere in this project: it's fixed arithmetic over fixed features, nothing learned.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with",
  "is", "are", "was", "were", "be", "been", "as", "by", "from", "this", "that",
]);

const PUBLISHER_SUFFIX = /\s*[|–—-]\s*[A-Za-z0-9 .]+$/; // strips " | Reuters", " - AP", " — BBC"

/** Lowercases, strips a trailing " | Publisher" suffix, strips punctuation, drops stopwords. */
export function normalizeTitle(title: string): string[] {
  const withoutSuffix = title.replace(PUBLISHER_SUFFIX, "");
  const cleaned = withoutSuffix
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned
    .split(" ")
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

function shingles(tokens: string[], size = 3): string[] {
  if (tokens.length < size) return tokens.length > 0 ? [tokens.join(" ")] : [];
  const result: string[] = [];
  for (let i = 0; i <= tokens.length - size; i++) {
    result.push(tokens.slice(i, i + size).join(" "));
  }
  return result;
}

/** 64-bit FNV-1a-style hash of a string, returned as a BigInt. */
function hash64(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash;
}

/** Computes the 64-bit SimHash fingerprint for a title, returned as a BigInt. */
export function titleSimHash(title: string): bigint {
  const tokens = normalizeTitle(title);
  const features = shingles(tokens);
  if (features.length === 0) return 0n;

  const bitWeights = new Array<number>(64).fill(0);
  for (const feature of features) {
    const h = hash64(feature);
    for (let bit = 0; bit < 64; bit++) {
      const isSet = (h >> BigInt(bit)) & 1n;
      // Safe: bit ranges over [0, 64) and bitWeights has exactly 64 elements.
      bitWeights[bit]! += isSet === 1n ? 1 : -1;
    }
  }

  let fingerprint = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (bitWeights[bit]! > 0) {
      fingerprint |= 1n << BigInt(bit);
    }
  }
  return fingerprint;
}

/** Hamming distance between two 64-bit fingerprints — the dedup cascade's stage-2 threshold is <= 3. */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x !== 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

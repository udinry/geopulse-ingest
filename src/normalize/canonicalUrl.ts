/**
 * Stage 1 of the four-stage news dedup cascade (cheapest filter first — see
 * GeoPulse/docs/planning/2026-09-20-initial-plan.md §7). Two article URLs that differ
 * only by tracking parameters, casing, or a trailing fragment should hash identically.
 *
 * Deliberately conservative: it strips known tracking params and normalizes structure,
 * but never rewrites path segments — a wrong canonicalization here would silently merge
 * two distinct articles, which is worse than missing a duplicate (stages 2–4 catch what
 * this stage misses).
 */

const TRACKING_PARAM_PREFIXES = ["utm_", "fbclid", "gclid", "mc_", "ref", "ref_src", "cmp", "icid"];

/** Returns the canonical form of a URL for exact-match dedup, or the original string on parse failure. */
export function canonicalizeUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim();
  }

  url.hostname = url.hostname.toLowerCase();
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
  }

  const keptParams = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    const lowerKey = key.toLowerCase();
    const isTracking = TRACKING_PARAM_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));
    if (!isTracking) {
      keptParams.append(key, value);
    }
  }
  const sortedParams = new URLSearchParams([...keptParams.entries()].sort(([a], [b]) => a.localeCompare(b)));
  url.search = sortedParams.toString();
  url.hash = "";

  // Strip a single trailing slash (but keep root "/").
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

/** Cheap 32-bit FNV-1a hash of the canonical URL, for use as a fast dedup index key. */
export function canonicalUrlHash(rawUrl: string): string {
  const canonical = canonicalizeUrl(rawUrl);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

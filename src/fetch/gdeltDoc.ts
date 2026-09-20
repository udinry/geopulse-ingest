/**
 * GDELT 2.0 DOC API client — this, not the bulk Events/Mentions files, is our source
 * for article TITLES: the bulk Events export (gdeltEvents.ts) and Mentions table carry
 * actor/geo/CAMEO/tone data and a source URL, but genuinely no headline text field at
 * all (confirmed against the GDELT 2.0 Event Codebook's full 61/16-column layouts).
 * The DOC API is GDELT's own article index (title, url, domain, seendate, language,
 * sourcecountry) and is covered by the same permissive GDELT licence as the bulk files
 * (docs/ARCHITECTURE.md) — articles ingested through it get `source_id = 'gdelt'` in
 * our schema, with the actual publisher name/domain stored separately for display (see
 * migrations/0008 and mapGdeltArticle.ts).
 *
 * ⚠ PROVENANCE NOTE: the query/response shape below is built from GDELT's documented,
 * stable API contract (unchanged for years), NOT from a live capture in this session —
 * two attempts to verify it live both hit the endpoint's explicit throttle message
 * ("please limit requests to one every 5 seconds... contact ... for larger queries"),
 * and a third space-out attempt still hit it, suggesting a longer-lived block on this
 * environment's shared egress IP rather than a simple per-request timer. Continuing to
 * retry against an explicit throttle request would be the wrong call even spaced out
 * further, so this was NOT live-verified here — do that verification before trusting
 * this in production, and once trusted, don't change it without a real reason (the
 * shape has been stable for years, so this is a one-time gap, not an ongoing risk).
 *
 * The built-in `MIN_REQUEST_INTERVAL_MS` throttle below is a real safeguard regardless
 * of the above — respect it in production, not just because I got blocked in dev.
 */

const DOC_API_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const MIN_REQUEST_INTERVAL_MS = 5_000;

let lastRequestAt = 0;

export interface DocApiQuery {
  query: string;
  /** e.g. "1d", "6h" — GDELT's own timespan syntax. */
  timespan: string;
  maxRecords: number;
}

export interface RawGdeltDocArticle {
  url: string;
  title: string;
  seendate: string; // e.g. "20260920T130000Z"
  domain: string;
  language: string;
  sourcecountry: string;
}

interface DocApiResponse {
  articles?: RawGdeltDocArticle[];
}

/** Parses the DOC API's documented JSON response shape: `{ "articles": [...] }`. */
export function parseDocApiResponse(json: string): RawGdeltDocArticle[] {
  const parsed = JSON.parse(json) as DocApiResponse;
  return parsed.articles ?? [];
}

async function waitForThrottle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
}

export async function fetchDocApiArticles(params: DocApiQuery): Promise<RawGdeltDocArticle[]> {
  await waitForThrottle();
  lastRequestAt = Date.now();

  const url = new URL(DOC_API_BASE);
  url.searchParams.set("query", params.query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(params.maxRecords));
  url.searchParams.set("timespan", params.timespan);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GDELT DOC API fetch failed: HTTP ${response.status}`);
  }
  return parseDocApiResponse(await response.text());
}

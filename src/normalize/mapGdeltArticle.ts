/**
 * Maps a raw GDELT DOC API article into our schema's ArticleRow. Every article from
 * this path gets source_id = 'gdelt' — see migrations/0008's comment for why that's
 * correct (GDELT's licence covers the link+headline+timestamp; publisher_name/domain
 * are separate, display-only fields for whichever outlet actually wrote it).
 */
import { canonicalizeUrl, canonicalUrlHash } from "./canonicalUrl.js";
import { normalizeTitle, titleSimHash } from "../dedupe/titleSimHash.js";
import type { ArticleRow } from "../shared/types.js";
import type { RawGdeltDocArticle } from "../fetch/gdeltDoc.js";

/** A small, deliberately incomplete curated map for well-known outlets' display names.
 * Falls back to `null` (never a guessed capitalization of the raw domain) for anything
 * not in this list — an honest "we don't know" beats a plausible-looking wrong guess.
 * Extend this as real publisher domains are actually seen in production, not
 * speculatively. */
const KNOWN_PUBLISHER_NAMES: Readonly<Record<string, string>> = {
  "reuters.com": "Reuters",
  "apnews.com": "AP",
  "bbc.com": "BBC",
  "bbc.co.uk": "BBC",
  "aljazeera.com": "Al Jazeera",
  "theguardian.com": "The Guardian",
  "bloomberg.com": "Bloomberg",
};

/** GDELT DOC API's seendate format ("20260920T130000Z") -> standard ISO8601. */
function seendateToIso(seendate: string): string | null {
  const match = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

export function mapGdeltDocArticleToArticleRow(
  raw: RawGdeltDocArticle,
  fetchedAtIso: string
): ArticleRow | null {
  if (!raw.url || !raw.title) return null;

  const canonical = canonicalizeUrl(raw.url);
  const publishedAt = seendateToIso(raw.seendate);
  const domain = raw.domain?.toLowerCase() ?? null;

  return {
    id: `art-${canonicalUrlHash(raw.url)}`,
    source_id: "gdelt",
    url_canonical: canonical,
    url_hash: canonicalUrlHash(raw.url),
    title: raw.title,
    title_norm: normalizeTitle(raw.title).join(" "),
    title_simhash: titleSimHash(raw.title).toString(16),
    excerpt: null, // gdelt source has excerpt_allowed = false — see data/sources.seed.json
    published_at: publishedAt,
    fetched_at: fetchedAtIso,
    lang: raw.language || null,
    // Not populated: sourcecountry is a country NAME ("United States"), not an ISO code,
    // and mapping it correctly needs a real gazetteer (planned for the entities/
    // situation-clustering work) — left null rather than an invented/partial mapping.
    country_iso: null,
    dedup_group_id: null, // computed by the dedup cascade after ingestion, not here
    publisher_domain: domain,
    publisher_name: domain ? (KNOWN_PUBLISHER_NAMES[domain] ?? null) : null,
  };
}

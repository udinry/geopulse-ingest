import { canonicalizeUrl } from "./canonicalUrl.js";

/** GKG 2.1 column indexes (tab-separated, 27 columns). */
const COL = { date: 1, sourceName: 3, url: 4, themes: 8, extras: 26 } as const;

/**
 * GKG topic themes that mark an article as being about a crisis: armed conflict, terrorism,
 * coercion, or civil unrest. Chosen from themes that actually occur in the feed; the very
 * broad ones (MANMADE_DISASTER_IMPLIED, WB_2433_CONFLICT_AND_VIOLENCE — on 15-20% of all
 * articles, including crime and entertainment) are deliberately excluded.
 */
export const CRISIS_THEMES: ReadonlySet<string> = new Set([
  "ARMEDCONFLICT", "MILITARY", "TERROR", "REBELS", "UNREST_BELLIGERENT", "SEIGE", "BLOCKADE",
  "CEASEFIRE", "WMD", "SANCTIONS", "CYBER_ATTACK", "WB_2462_POLITICAL_VIOLENCE_AND_WAR", "PROTEST",
]);

export interface GkgTitle {
  title: string;
  sourceName: string;
  /** The article itself is tagged with at least one crisis theme. */
  crisis: boolean;
}

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'");
}

/**
 * The bulk Events export has no headline; the GKG file does (`<PAGE_TITLE>` in its
 * extras column) for the same 15-minute batch — no throttled DOC API needed.
 * Keyed by canonical URL so it joins to an event's SOURCEURL. Rows with no usable
 * title are skipped, never given a made-up one.
 */
export function parseGkgTitles(csv: string): Map<string, GkgTitle> {
  const titles = new Map<string, GkgTitle>();
  for (const line of csv.split("\n")) {
    if (line.length === 0) continue;
    const cols = line.split("\t");
    const url = cols[COL.url];
    const title = cols[COL.extras]?.match(/<PAGE_TITLE>([^<]*)<\/PAGE_TITLE>/)?.[1];
    if (!url || !title) continue;
    const clean = decodeXmlEntities(title).trim();
    if (clean.length < 8) continue;
    try {
      const crisis = (cols[COL.themes] ?? "").split(";").some((entry) => CRISIS_THEMES.has(entry.split(",")[0] ?? ""));
      titles.set(canonicalizeUrl(url), { title: clean, sourceName: cols[COL.sourceName] ?? "", crisis });
    } catch {
      // unparseable URL: skip rather than guess
    }
  }
  return titles;
}

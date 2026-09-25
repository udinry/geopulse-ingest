import type { Queryable } from "../api/handler.js";
import { matchOutlook } from "./match.js";
import type { EventCategory } from "../shared/types.js";
import type { BatchWriter, Statement } from "../run/sql.js";

/**
 * Reads public, keyless event-contract pricing and turns it into de-branded outlook rows.
 * The venue name/slug/url are stored ONLY in outlook_markets (needed to re-fetch); the emit
 * layer (publicSerializer) never sends them to a client — see docs/ARCHITECTURE.md.
 * Fetched only from ingestion (US runners); the app never talks to this source.
 */
const ENDPOINT = "https://gamma-api.polymarket.com/markets";
const VENUE = "gamma";
const STALE_AFTER_HOURS = 6;
/** Vocabulary that must not reach the client, even inside a market's own question text. */
const BANNED = /\b(bet|bets|betting|odds|wager|stake|trade|trading)\b/i;

export interface GammaMarket {
  id?: string | number;
  question?: string;
  slug?: string;
  endDate?: string;
  volume?: string | number;
  liquidity?: string | number;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  oneDayPriceChange?: number | string;
  closed?: boolean;
  active?: boolean;
}

export interface OutlookCandidate {
  id: string;
  slug: string;
  question: string;
  endDate: string | null;
  volume: number | null;
  liquidity: number | null;
  probability: number;
  change24h: number | null;
}

const asArray = (value: string | string[] | undefined): string[] | null => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : null; } catch { return null; }
};
const asNumber = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Binary Yes/No, open, priced, and free of banned vocabulary — anything else is skipped, never guessed. */
export function parseGammaMarket(m: GammaMarket): OutlookCandidate | null {
  if (m.closed === true || m.active === false) return null;
  const question = typeof m.question === "string" ? m.question.trim() : "";
  if (question.length < 8 || BANNED.test(question) || m.slug === undefined || m.id === undefined) return null;
  const outcomes = asArray(m.outcomes);
  const prices = asArray(m.outcomePrices);
  if (outcomes === null || prices === null || outcomes.length !== 2 || prices.length !== 2) return null;
  const yes = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  if (yes === -1 || outcomes[1 - yes]?.toLowerCase() !== "no") return null;
  const probability = asNumber(prices[yes]);
  if (probability === null || probability < 0 || probability > 1) return null;
  return {
    id: `om-${String(m.id)}`,
    slug: m.slug,
    question,
    endDate: typeof m.endDate === "string" ? m.endDate : null,
    volume: asNumber(m.volume),
    liquidity: asNumber(m.liquidity),
    probability,
    change24h: asNumber(m.oneDayPriceChange),
  };
}

export async function fetchOutlookCandidates(limit = 200, fetchImpl: typeof fetch = fetch): Promise<OutlookCandidate[]> {
  const url = `${ENDPOINT}?active=true&closed=false&limit=${limit}&order=volume24hr&ascending=false`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`outlook source returned ${response.status}`);
  const body = await response.json() as unknown;
  if (!Array.isArray(body)) throw new Error("outlook source returned an unexpected shape");
  return (body as GammaMarket[]).map(parseGammaMarket).filter((c): c is OutlookCandidate => c !== null);
}

type Db = Queryable & Partial<BatchWriter>;

/** Upserts markets (keeping the previous probability for change tracking), then re-links active map situations. */
export async function storeAndLinkOutlook(db: Db, candidates: readonly OutlookCandidate[], now: string): Promise<{ stored: number; linked: number }> {
  const statements: Statement[] = candidates.map((c) => ({
    sql: "INSERT INTO outlook_markets (id, venue, slug, url, question, question_normalised, end_date, volume, liquidity, probability, prev_probability, prob_change_24h, updated_at, is_resolved) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0) ON CONFLICT(venue, slug) DO UPDATE SET question = excluded.question, question_normalised = excluded.question_normalised, end_date = excluded.end_date, volume = excluded.volume, liquidity = excluded.liquidity, prev_probability = CASE WHEN outlook_markets.probability <> excluded.probability THEN outlook_markets.probability ELSE outlook_markets.prev_probability END, probability = excluded.probability, prob_change_24h = excluded.prob_change_24h, updated_at = excluded.updated_at, is_resolved = 0",
    params: [c.id, VENUE, c.slug, c.question, c.question, c.endDate, c.volume, c.liquidity, c.probability, c.change24h, now],
  }));
  for (let i = 0; i < statements.length; i += 50) {
    const chunk = statements.slice(i, i + 50);
    if (db.batch !== undefined) await db.batch(chunk); else for (const s of chunk) await db.run(s.sql, ...s.params);
  }
  // Absent from one fetch is not "resolved" (it may just have dropped out of the top by volume);
  // only retire a market that has not been seen for several hours.
  const staleBefore = new Date(Date.parse(now) - STALE_AFTER_HOURS * 3_600_000).toISOString();
  await db.run("UPDATE outlook_markets SET is_resolved = 1 WHERE venue = ? AND updated_at < ?", VENUE, staleBefore);

  const situations = await db.all<{ id: string; title: string; category: EventCategory }>("SELECT id, title, category FROM situations WHERE status = 'active' AND map_rank IS NOT NULL");
  const markets = await db.all<{ id: string; question_normalised: string; category: string | null }>("SELECT id, question_normalised, category FROM outlook_markets WHERE is_resolved = 0");
  const links: Statement[] = [];
  for (const situation of situations) {
    for (const market of markets) {
      const match = matchOutlook(situation, market);
      if (match === null) continue;
      links.push({
        sql: "INSERT INTO situation_outlook (situation_id, market_id, confidence, matched_by, is_manually_verified, method) VALUES (?, ?, ?, ?, 0, 'market_implied_v1') ON CONFLICT(situation_id, market_id) DO UPDATE SET confidence = excluded.confidence, matched_by = excluded.matched_by WHERE situation_outlook.matched_by <> 'manual'",
        params: [situation.id, market.id, match.confidence, match.matchedBy],
      });
    }
  }
  for (let i = 0; i < links.length; i += 50) {
    const chunk = links.slice(i, i + 50);
    if (db.batch !== undefined) await db.batch(chunk); else for (const s of chunk) await db.run(s.sql, ...s.params);
  }
  return { stored: candidates.length, linked: links.length };
}

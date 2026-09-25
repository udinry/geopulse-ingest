import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRequest, type Queryable } from "../src/api/handler.js";
import { eventImpulse, eventSeverity, ingestBatch, refreshRanking, MIN_EVENT_SOURCES } from "../src/run/pipeline.js";
import { inlineParams, type BatchWriter, type Statement } from "../src/run/sql.js";
import { parseGkgTitles } from "../src/normalize/gkgParser.js";
import type { EventRow } from "../src/shared/types.js";
import { TestDb } from "./dbTestHelper.js";

/** A real SQLite database (same dialect as D1) behind the Queryable the pipeline and API use. */
class SqliteDb implements Queryable, BatchWriter {
  constructor(private readonly db: TestDb) {}
  async all<T>(sql: string, ...b: unknown[]): Promise<T[]> {
    return this.db.query<T>(`PRAGMA foreign_keys=ON; ${inlineParams(sql, b)}`.replace(/^PRAGMA foreign_keys=ON; /, ""));
  }
  async first<T>(sql: string, ...b: unknown[]): Promise<T | null> { return (await this.all<T>(sql, ...b))[0] ?? null; }
  async run(sql: string, ...b: unknown[]): Promise<void> { this.exec([{ sql, params: b }]); }
  async batch(statements: readonly Statement[]): Promise<void> { this.exec(statements); }
  private exec(statements: readonly Statement[]): void {
    const script = ["PRAGMA foreign_keys=ON;", "BEGIN;", ...statements.map((s) => `${inlineParams(s.sql, s.params)};`), "COMMIT;"].join("\n");
    const r = spawnSync("sqlite3", [this.db.path], { input: script, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`sqlite failed: ${r.stderr}\n${script.slice(0, 400)}`);
  }
}

const NOW = "2026-09-25T12:00:00Z";
function ev(id: string, over: Partial<EventRow> = {}): EventRow {
  return {
    id: `gdelt-${id}`, gdelt_event_id: id, cameo_code: "190", cameo_root: "19", quad_class: 4, goldstein: -10,
    actor1_code: "IRN", actor1_name: "IRAN", actor2_code: "USA", actor2_name: "UNITED STATES",
    lat: 26.5, lon: 56.3, geo_name: "Strait of Hormuz", country_iso: "IR", geo_precision: 3,
    occurred_at: "2026-09-25T00:00:00Z", first_seen_at: "2026-09-25T11:30:00Z", num_mentions: 40, num_sources: 8, num_articles: 8,
    avg_tone: -5, category: "warArmedConflict", ...over,
  };
}
const gkg = (rows: Array<[string, string]>) => parseGkgTitles(rows.map(([url, title]) => `0\t0\t0\texample.com\t${url}${"\t".repeat(22)}<PAGE_TITLE>${title}</PAGE_TITLE>`).join("\n"));

let db: TestDb;
let sqlite: SqliteDb;
beforeEach(() => {
  db = TestDb.createWithMigrations();
  db.exec("INSERT INTO sources (id, name, domain, kind, credibility_tier, license_class, excerpt_allowed, is_active) VALUES ('gdelt', 'GDELT', 'gdeltproject.org', 'gdelt', 1, 'green', 0, 1);");
  sqlite = new SqliteDb(db);
});
afterEach(() => db.cleanup());

describe("GKG titles", () => {
  it("joins by canonical URL, decodes entities, and skips rows without a usable title", () => {
    const titles = parseGkgTitles([
      `0\t0\t0\ta.com\thttps://a.com/x?utm_source=z${"\t".repeat(22)}<PAGE_TITLE>Iran &amp; US talks stall</PAGE_TITLE>`,
      `0\t0\t0\tb.com\thttps://b.com/y${"\t".repeat(22)}`,
      `0\t0\t0\tc.com\thttps://c.com/z${"\t".repeat(22)}<PAGE_TITLE>x</PAGE_TITLE>`,
    ].join("\n"));
    expect(titles.size).toBe(1);
    expect(titles.get("https://a.com/x")?.title).toBe("Iran & US talks stall");
    expect(parseGkgTitles(`0\t0\t0\td.com\thttps://d.com/p${"\t".repeat(22)}<PAGE_TITLE>Pok&#xE9;mon set drops &#8217;fast&#8217;</PAGE_TITLE>`).get("https://d.com/p")?.title).toBe("Pokémon set drops ’fast’");
  });
});

describe("event impulse", () => {
  it("scores severity from Goldstein, CAMEO class and quad class, and is zero without Goldstein", () => {
    expect(eventSeverity(ev("1"))).toBeCloseTo(1);
    expect(eventSeverity(ev("2", { goldstein: null }))).toBe(0);
    expect(eventSeverity(ev("3", { cameo_root: "01", goldstein: 0, quad_class: 1 }))).toBeLessThan(0.05);
    const { magnitude } = eventImpulse(ev("1"));
    expect(magnitude).toBeGreaterThan(0.4);
    expect(magnitude).toBeLessThanOrEqual(1);
  });
});

describe("ingestBatch against a real SQLite database", () => {
  const events = [ev("1"), ev("2", { first_seen_at: "2026-09-25T11:45:00Z" }), ev("3", { num_sources: MIN_EVENT_SOURCES - 1 }), ev("4"), ev("5", { lat: -33.8, lon: 151.2, geo_name: "Sydney", country_iso: "AU", actor1_code: "AUS", actor2_code: null, category: "protestCivilUnrest", cameo_root: "14", quad_class: 3, goldstein: -6 })];
  const urls = new Map(events.map((e) => [e.id, `https://news.example/${e.gdelt_event_id}`]));
  const titles = gkg([
    ["https://news.example/1", "Naval buildup near the Strait of Hormuz"],
    ["https://news.example/2", "Tehran warns of response in the Gulf"],
    ["https://news.example/3", "Low-source story"],
    ["https://news.example/5", "Sydney rally draws thousands"],
  ]);

  it("keeps only corroborated, titled, located events, groups the related ones, and keeps unrelated ones apart", async () => {
    const result = await ingestBatch(sqlite, { events, sourceUrls: urls, titles, now: NOW });
    expect(result.eventsSeen).toBe(5);
    expect(result.eventsKept).toBe(3); // ev3 low sources, ev4 has no headline
    expect(result.situationsCreated).toBe(2);
    const sits = db.query<{ title: string; event_count: number; category: string; source_count: number }>("SELECT title, event_count, category, source_count FROM situations ORDER BY event_count DESC");
    expect(sits[0]).toMatchObject({ event_count: 2, category: "warArmedConflict", source_count: 8 });
    expect(sits[1]).toMatchObject({ event_count: 1, category: "protestCivilUnrest" });
    expect(db.query("SELECT * FROM articles")).toHaveLength(3);
    expect(db.query<{ source_id: string; excerpt: string | null }>("SELECT source_id, excerpt FROM articles").every((a) => a.source_id === "gdelt" && a.excerpt === null)).toBe(true);
    expect(db.query("SELECT * FROM score_history")).toHaveLength(2);
  });

  it("pulls events from the same article or headline into one situation even when geolocated far apart", async () => {
    const a = ev("10", { lat: 26.5, lon: 56.3, country_iso: "IR" });
    const b = ev("11", { lat: 50.4, lon: 30.5, country_iso: "UA", actor1_code: "UKR", actor2_code: "RUS", category: "diplomaticNegotiation", cameo_root: "04", quad_class: 1, goldstein: 2 });
    const c = ev("12", { lat: 30.0, lon: 31.2, country_iso: "EG", actor1_code: "EGY", actor2_code: null, category: "diplomaticNegotiation", cameo_root: "04", quad_class: 1, goldstein: 2 });
    const u = new Map([[a.id, "https://x.example/story"], [b.id, "https://x.example/story"], [c.id, "https://y.example/syndicated"]]);
    const t = gkg([["https://x.example/story", "Saudi cleric urges troops to defend against Houthis"], ["https://y.example/syndicated", "Saudi cleric urges troops to defend against Houthis"]]);
    const result = await ingestBatch(sqlite, { events: [a, b, c], sourceUrls: u, titles: t, now: NOW });
    expect(result.situationsCreated).toBe(1);
    expect(db.query<{ event_count: number }>("SELECT event_count FROM situations")[0]?.event_count).toBe(3);
  });

  it("is idempotent: re-ingesting the same batch changes nothing", async () => {
    await ingestBatch(sqlite, { events, sourceUrls: urls, titles, now: NOW });
    const before = db.query("SELECT (SELECT COUNT(*) FROM events) e, (SELECT COUNT(*) FROM situations) s, (SELECT COUNT(*) FROM situation_events) se");
    const again = await ingestBatch(sqlite, { events, sourceUrls: urls, titles, now: "2026-09-25T12:15:00Z" });
    expect(again.eventsKept).toBe(0);
    expect(again.eventsAlreadyStored).toBe(3);
    expect(db.query("SELECT (SELECT COUNT(*) FROM events) e, (SELECT COUNT(*) FROM situations) s, (SELECT COUNT(*) FROM situation_events) se")).toEqual(before);
  });

  it("a later related event joins the existing situation and raises its score", async () => {
    await ingestBatch(sqlite, { events: [events[0]!], sourceUrls: urls, titles, now: NOW });
    const first = db.query<{ id: string; trending_score: number }>("SELECT id, trending_score FROM situations")[0]!;
    await ingestBatch(sqlite, { events: [events[1]!], sourceUrls: urls, titles, now: "2026-09-25T12:10:00Z" });
    const rows = db.query<{ id: string; event_count: number; trending_score: number }>("SELECT id, event_count, trending_score FROM situations");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, event_count: 2 });
    expect(rows[0]!.trending_score).toBeGreaterThan(first.trending_score);
  });

  it("ranks visible situations, decays them, and ages inactive ones out — then the real API serves them", async () => {
    await ingestBatch(sqlite, { events, sourceUrls: urls, titles, now: NOW });
    const ranked = await refreshRanking(sqlite, NOW);
    expect(ranked.ranked).toBe(2);
    const ranks = db.query<{ map_rank: number }>("SELECT map_rank FROM situations ORDER BY map_rank").map((r) => r.map_rank);
    expect(ranks).toEqual([1, 2]);

    const now = await (await handleRequest(new Request("https://api.test/v1/now"), { db: sqlite })).json() as { situations: Array<{ id: string; title: string; mapRank: number }> };
    expect(now.situations.map((s) => s.mapRank)).toEqual([1, 2]);
    const top = now.situations[0]!;
    const detail = await (await handleRequest(new Request(`https://api.test/v1/situation/${top.id}`), { db: sqlite })).json() as { news: Array<{ headline: string; url: string }>; events: unknown[]; companies: Array<{ symbol: string }> };
    expect(detail.events).toHaveLength(2);
    expect(detail.news.map((n) => n.headline).sort()).toEqual(["Naval buildup near the Strait of Hormuz", "Tehran warns of response in the Gulf"]);
    expect(detail.companies.map((c) => c.symbol)).toEqual(expect.arrayContaining(["XOM", "RELIANCE", "ZIM"]));

    await refreshRanking(sqlite, "2026-09-28T12:00:00Z"); // 3 days later, nothing new
    expect(db.query<{ status: string }>("SELECT DISTINCT status FROM situations")).toEqual([{ status: "recent" }]);
    expect(db.query("SELECT * FROM situations WHERE map_rank IS NOT NULL")).toHaveLength(0);
  });
});

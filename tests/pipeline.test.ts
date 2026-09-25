import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRequest, type Queryable } from "../src/api/handler.js";
import { eventImpulse, eventSeverity, ingestBatch, refreshRanking, SEVERITY_FLOOR } from "../src/run/pipeline.js";
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
const row = (url: string, title: string, themes: string) => `0\t0\t0\t${new URL(url).hostname}\t${url}\t\t\t\t${themes}${"\t".repeat(18)}<PAGE_TITLE>${title}</PAGE_TITLE>`;
const gkg = (rows: Array<[string, string]>, themes = "ARMEDCONFLICT,5;TAX_FNCACT,9") => parseGkgTitles(rows.map(([url, title]) => row(url, title, themes)).join("\n"));

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

describe("crisis themes", () => {
  it("flags articles tagged with a crisis theme and not those tagged only with broad ones", () => {
    const titles = parseGkgTitles([
      row("https://a.example/1", "Heavy fighting near the border", "ARMEDCONFLICT,10;TAX_FNCACT,4"),
      row("https://b.example/2", "Streaming documentary about a bomber", "WOUND,5;MANMADE_DISASTER_IMPLIED,8;ARREST,9"),
    ].join("\n"));
    expect(titles.get("https://a.example/1")?.crisis).toBe(true);
    expect(titles.get("https://b.example/2")?.crisis).toBe(false);
  });

  it("the pipeline drops a severe, relevant event whose article is not about a crisis", async () => {
    const e = ev("50");
    const r = await ingestBatch(sqlite, { events: [e], sourceUrls: new Map([[e.id, "https://b.example/2"]]), titles: gkg([["https://b.example/2", "Streaming documentary about a bomber"]], "WOUND,5;ARREST,9"), now: NOW });
    expect(r.eventsKept).toBe(0);
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
  // Three publishers cover the Hormuz story; one covers the Sydney rally; ev4 has no headline.
  const events = [
    ev("1"), ev("2", { first_seen_at: "2026-09-25T11:45:00Z" }), ev("6", { first_seen_at: "2026-09-25T11:50:00Z", num_mentions: 12 }), ev("4"),
    ev("5", { lat: -33.8, lon: 151.2, geo_name: "Sydney", country_iso: "AU", actor1_code: "AUS", actor2_code: null, category: "protestCivilUnrest", cameo_root: "14", quad_class: 3, goldstein: -8 }),
  ];
  const urls = new Map(events.map((e) => [e.id, `https://${e.gdelt_event_id === "5" ? "sydney" : `pub${e.gdelt_event_id}`}.example/${e.gdelt_event_id}`]));
  const titles = gkg([
    ["https://pub1.example/1", "Naval buildup near the Strait of Hormuz"],
    ["https://pub2.example/2", "Tehran warns of response in the Gulf"],
    ["https://pub6.example/6", "Gulf shipping insurers raise war-risk rates"],
    ["https://sydney.example/5", "Sydney rally draws thousands"],
  ]);

  it("keeps titled, severe, located events, groups related ones by geography/actors, and keeps unrelated ones apart", async () => {
    const result = await ingestBatch(sqlite, { events, sourceUrls: urls, titles, now: NOW });
    expect(result.eventsSeen).toBe(5);
    expect(result.eventsKept).toBe(4); // ev4 has no headline
    expect(result.situationsCreated).toBe(2);
    const sits = db.query<{ event_count: number; category: string; source_count: number }>("SELECT event_count, category, source_count FROM situations ORDER BY event_count DESC");
    expect(sits[0]).toMatchObject({ event_count: 3, category: "warArmedConflict", source_count: 3 });
    expect(sits[1]).toMatchObject({ event_count: 1, category: "protestCivilUnrest", source_count: 1 });
    expect(db.query("SELECT * FROM articles")).toHaveLength(4);
    expect(db.query<{ source_id: string; excerpt: string | null }>("SELECT source_id, excerpt FROM articles").every((a) => a.source_id === "gdelt" && a.excerpt === null)).toBe(true);
  });

  it("is idempotent: re-ingesting the same batch changes nothing", async () => {
    await ingestBatch(sqlite, { events, sourceUrls: urls, titles, now: NOW });
    const q = "SELECT (SELECT COUNT(*) FROM events) e, (SELECT COUNT(*) FROM situations) s, (SELECT COUNT(*) FROM situation_events) se";
    const before = db.query(q);
    const again = await ingestBatch(sqlite, { events, sourceUrls: urls, titles, now: "2026-09-25T12:15:00Z" });
    expect(again.eventsKept).toBe(0);
    expect(again.eventsAlreadyStored).toBe(4);
    expect(db.query(q)).toEqual(before);
  });

  it("a later related article joins the existing situation and raises its score", async () => {
    await ingestBatch(sqlite, { events: [events[0]!], sourceUrls: urls, titles, now: NOW });
    const first = db.query<{ id: string; trending_score: number }>("SELECT id, trending_score FROM situations")[0]!;
    await ingestBatch(sqlite, { events: [events[1]!], sourceUrls: urls, titles, now: "2026-09-25T12:10:00Z" });
    const rows = db.query<{ id: string; event_count: number; trending_score: number }>("SELECT id, event_count, trending_score FROM situations");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, event_count: 2 });
    expect(rows[0]!.trending_score).toBeGreaterThan(first.trending_score);
  });

  it("puts only situations with >=3 distinct publishers on the map, ages them out, and the real API serves them", async () => {
    await ingestBatch(sqlite, { events, sourceUrls: urls, titles, now: NOW });
    const ranked = await refreshRanking(sqlite, NOW);
    expect(ranked.ranked).toBe(1); // the single-publisher Sydney story stays off the map
    expect(db.query<{ map_rank: number | null }>("SELECT map_rank FROM situations ORDER BY event_count DESC").map((r) => r.map_rank)).toEqual([1, null]);

    const now = await (await handleRequest(new Request("https://api.test/v1/now"), { db: sqlite })).json() as { situations: Array<{ id: string; mapRank: number }> };
    expect(now.situations.map((x) => x.mapRank)).toEqual([1]);
    const detail = await (await handleRequest(new Request(`https://api.test/v1/situation/${now.situations[0]!.id}`), { db: sqlite })).json() as { news: Array<{ headline: string }>; events: unknown[]; companies: Array<{ symbol: string }> };
    expect(detail.events).toHaveLength(3);
    expect(detail.news.map((n) => n.headline).sort()).toEqual(["Gulf shipping insurers raise war-risk rates", "Naval buildup near the Strait of Hormuz", "Tehran warns of response in the Gulf"]);
    expect(detail.companies.map((c) => c.symbol)).toEqual(expect.arrayContaining(["XOM", "RELIANCE", "ZIM"]));

    await refreshRanking(sqlite, "2026-09-28T12:00:00Z"); // 3 days later, nothing new
    expect(db.query<{ status: string }>("SELECT DISTINCT status FROM situations")).toEqual([{ status: "recent" }]);
    expect(db.query("SELECT * FROM situations WHERE map_rank IS NOT NULL")).toHaveLength(0);
  });

  it("drops cooperative/diplomatic chatter that GDELT extracts from ordinary stories", async () => {
    const chatter = ev("20", { cameo_root: "04", quad_class: 1, goldstein: 1, category: "diplomaticNegotiation" });
    expect(eventSeverity(chatter)).toBeLessThan(SEVERITY_FLOOR);
    const r = await ingestBatch(sqlite, { events: [chatter], sourceUrls: new Map([[chatter.id, "https://x.example/summit"]]), titles: gkg([["https://x.example/summit", "Leaders pose for photo at summit"]]), now: NOW });
    expect(r.eventsKept).toBe(0);
    expect(db.query("SELECT * FROM situations")).toHaveLength(0);
  });

  it("scores a story once, however many event rows one article produced", async () => {
    const one = [ev("30")];
    const many = [ev("31"), ev("32"), ev("33"), ev("34"), ev("35")];
    const single = new Map(one.map((e) => [e.id, "https://x.example/one"]));
    const multi = new Map(many.map((e) => [e.id, "https://y.example/two"]));
    await ingestBatch(sqlite, { events: one, sourceUrls: single, titles: gkg([["https://x.example/one", "Naval buildup near the Strait of Hormuz"]]), now: NOW });
    const a = db.query<{ trending_score: number }>("SELECT trending_score FROM situations")[0]!.trending_score;
    db.exec("DELETE FROM situation_events; DELETE FROM event_articles; DELETE FROM score_history; DELETE FROM situations; DELETE FROM articles; DELETE FROM events;");
    await ingestBatch(sqlite, { events: many, sourceUrls: multi, titles: gkg([["https://y.example/two", "Tehran warns of response in the Gulf"]]), now: NOW });
    const row = db.query<{ trending_score: number; event_count: number }>("SELECT trending_score, event_count FROM situations")[0]!;
    expect(row.trending_score).toBeCloseTo(a);
    expect(row.event_count).toBe(1); // one article, however many rows it produced
  });

  it("places a situation at its most-reported event, not the average of far-apart events", async () => {
    const a = ev("40", { num_mentions: 90, lat: 26.5, lon: 56.3, geo_name: "Strait of Hormuz", country_iso: "IR" });
    const b = ev("41", { num_mentions: 10, lat: 37.7, lon: -122.4, geo_name: "San Francisco", country_iso: "US" });
    const u = new Map([[a.id, "https://x.example/story"], [b.id, "https://y.example/syndicated"]]);
    await ingestBatch(sqlite, { events: [a, b], sourceUrls: u, titles: gkg([["https://x.example/story", "Naval buildup near the Strait of Hormuz"], ["https://y.example/syndicated", "Naval buildup near the Strait of Hormuz"]]), now: NOW });
    expect(db.query("SELECT * FROM situation_events")).toHaveLength(2);
    expect(db.query<{ lat: number; lon: number; geo_name: string; country_iso: string }>("SELECT lat, lon, geo_name, country_iso FROM situations")[0]).toEqual({ lat: 26.5, lon: 56.3, geo_name: "Strait of Hormuz", country_iso: "IR" });
  });

  it("pulls events from the same article or headline into one situation even when geolocated far apart", async () => {
    const a = ev("10", { lat: 26.5, lon: 56.3, country_iso: "IR" });
    const b = ev("11", { lat: 50.4, lon: 30.5, country_iso: "UA", actor1_code: "UKR", actor2_code: "RUS", category: "internationalDispute", cameo_root: "13", quad_class: 3, goldstein: -6 });
    const c = ev("12", { lat: 30.0, lon: 31.2, country_iso: "EG", actor1_code: "EGY", actor2_code: null, category: "internationalDispute", cameo_root: "13", quad_class: 3, goldstein: -6 });
    const u = new Map([[a.id, "https://x.example/story"], [b.id, "https://x.example/story"], [c.id, "https://y.example/syndicated"]]);
    const t = gkg([["https://x.example/story", "Saudi cleric urges troops to defend against Houthis"], ["https://y.example/syndicated", "Saudi cleric urges troops to defend against Houthis"]]);
    const result = await ingestBatch(sqlite, { events: [a, b, c], sourceUrls: u, titles: t, now: NOW });
    expect(result.situationsCreated).toBe(1);
    expect(db.query<{ event_count: number }>("SELECT event_count FROM situations")[0]?.event_count).toBe(2); // two distinct articles
  });
});

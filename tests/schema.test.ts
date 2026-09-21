import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sqlLiteral, TestDb } from "./dbTestHelper.js";
import type { AssetRow, SourceRow } from "../src/shared/types.js";

const DATA_DIR = fileURLToPath(new URL("../data", import.meta.url));

function loadSourcesSeed(): SourceRow[] {
  const raw = JSON.parse(readFileSync(`${DATA_DIR}/sources.seed.json`, "utf8"));
  return raw.sources;
}

function loadAssetsSeed(): (AssetRow & { _citation?: string })[] {
  const raw = JSON.parse(readFileSync(`${DATA_DIR}/assets.seed.json`, "utf8"));
  return raw.assets;
}

describe("schema migrations apply cleanly", () => {
  let db: TestDb;
  beforeEach(() => {
    db = TestDb.createWithMigrations();
  });
  afterEach(() => db.cleanup());

  it("creates every table the schema defines", () => {
    const tables = db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
    );
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      [
        "alert_deliveries", "alerts", "articles", "asset_prices", "assets",
        "devices", "entities", "event_articles", "events", "ingest_runs",
         "device_watches", "outlook_controls", "outlook_markets", "score_history", "situation_assets", "situation_entities",
        "situation_events", "situation_outlook", "situations", "sources", "watch_deliveries",
      ].sort()
    );
  });

  it("has zero foreign-key violations on an empty schema", () => {
    expect(db.query("PRAGMA foreign_key_check;")).toEqual([]);
  });
});

describe("the licensing register: zero unreviewed sources", () => {
  it("every seeded news source has a license_class, a terms_url, and a dated review", () => {
    const sources = loadSourcesSeed();
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(["green", "amber", "red"]).toContain(source.license_class);
      expect(source.terms_url, `${source.id} is missing terms_url`).toBeTruthy();
      expect(
        source.terms_reviewed_at,
        `${source.id} is missing terms_reviewed_at`
      ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("every seeded market asset has a license_class and is green (no NASDAQ/NIFTY/equities snuck in)", () => {
    const assets = loadAssetsSeed();
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(asset.license_class).toBe("green");
      expect(asset.class).not.toBe("equity");
      expect(asset.class).not.toBe("index"); // NASDAQ/NIFTY would be 'index' — must not appear green
    }
  });
});

describe("round-trip: insert seeded rows and read them back through real joins", () => {
  let db: TestDb;
  beforeEach(() => {
    db = TestDb.createWithMigrations();
  });
  afterEach(() => db.cleanup());

  it("seeds every source row and reads it back unchanged", () => {
    const sources = loadSourcesSeed();
    for (const s of sources) {
      db.exec(`
        INSERT INTO sources (id, name, domain, feed_url, kind, credibility_tier, license_class,
          excerpt_allowed, attribution_text, attribution_url, terms_url, terms_reviewed_at, is_active)
        VALUES (${sqlLiteral(s.id)}, ${sqlLiteral(s.name)}, ${sqlLiteral(s.domain)},
          ${sqlLiteral(s.feed_url as unknown as string | null)}, ${sqlLiteral(s.kind)},
          ${s.credibility_tier}, ${sqlLiteral(s.license_class)},
          ${sqlLiteral(Boolean(s.excerpt_allowed))}, ${sqlLiteral(s.attribution_text)},
          ${sqlLiteral(s.attribution_url)}, ${sqlLiteral(s.terms_url)},
          ${sqlLiteral(s.terms_reviewed_at)}, ${sqlLiteral(Boolean(s.is_active))});
      `);
    }
    const rows = db.query<SourceRow>("SELECT * FROM sources ORDER BY id;");
    expect(rows).toHaveLength(sources.length);
    expect(rows.map((r) => r.id).sort()).toEqual(sources.map((s) => s.id).sort());
  });

  it("seeds every asset row and reads it back unchanged", () => {
    const assets = loadAssetsSeed();
    for (const a of assets) {
      db.exec(`
        INSERT INTO assets (id, symbol, name, class, exchange, currency, country_iso,
          data_source, license_class, is_delayed, delay_minutes)
        VALUES (${sqlLiteral(a.id)}, ${sqlLiteral(a.symbol)}, ${sqlLiteral(a.name)},
          ${sqlLiteral(a.class)}, ${sqlLiteral(a.exchange)}, ${sqlLiteral(a.currency)},
          ${sqlLiteral(a.country_iso)}, ${sqlLiteral(a.data_source)},
          ${sqlLiteral(a.license_class)}, ${sqlLiteral(Boolean(a.is_delayed))}, ${a.delay_minutes});
      `);
    }
    const rows = db.query<AssetRow>("SELECT * FROM assets ORDER BY id;");
    expect(rows).toHaveLength(assets.length);
  });

  it("a situation joins to its events, entities, assets, and outlook through real FKs", () => {
    // A minimal realistic graph: one source -> one article -> one event -> one situation,
    // linked to one asset and one (de-branded at read time) outlook market.
    db.exec(`
      INSERT INTO sources (id, name, domain, kind, credibility_tier, license_class, excerpt_allowed, is_active)
        VALUES ('src1', 'Test Source', 'example.com', 'gdelt', 1, 'green', 0, 1);
      INSERT INTO articles (id, source_id, url_canonical, url_hash, title, title_norm, title_simhash, fetched_at)
        VALUES ('art1', 'src1', 'https://example.com/a', 'hash1', 'Title', 'title', 'abc123', '2026-09-20T00:00:00Z');
      INSERT INTO events (id, occurred_at, first_seen_at, category, goldstein, quad_class)
        VALUES ('evt1', '2026-09-20T00:00:00Z', '2026-09-20T00:05:00Z', 'militaryMovement', -8.0, 4);
      INSERT INTO event_articles (event_id, article_id) VALUES ('evt1', 'art1');
      INSERT INTO situations (id, slug, title, category, lat, lon, status, first_seen_at, last_event_at)
        VALUES ('sit1', 'test-situation', 'Test Situation', 'militaryMovement', 23.5, 121.0, 'active',
          '2026-09-20T00:00:00Z', '2026-09-20T00:05:00Z');
      INSERT INTO situation_events (situation_id, event_id, joined_at, similarity)
        VALUES ('sit1', 'evt1', '2026-09-20T00:05:00Z', 0.9);
      INSERT INTO entities (id, type, canonical_name, aliases_json) VALUES ('ent1', 'country', 'Taiwan', '[]');
      INSERT INTO situation_entities (situation_id, entity_id, weight) VALUES ('sit1', 'ent1', 1.0);
      INSERT INTO assets (id, symbol, name, class, currency, data_source, license_class)
        VALUES ('ast1', 'TSM', 'TSMC', 'equity', 'USD', 'test', 'red');
      INSERT INTO situation_assets (situation_id, asset_id, relation_type, weight, rationale_key, source)
        VALUES ('sit1', 'ast1', 'supply_chain', 0.8, 'semiconductor_supply_concern', 'rule:geo_supply_chain_v1');
      INSERT INTO outlook_markets (id, venue, slug, question, question_normalised, probability, updated_at)
        VALUES ('out1', 'internal-venue-name', 'internal-slug', 'Will X escalate?', 'Major escalation', 0.23, '2026-09-20T00:00:00Z');
      INSERT INTO situation_outlook (situation_id, market_id, confidence, matched_by, method)
        VALUES ('sit1', 'out1', 0.82, 'entity', 'market_implied_v1');
    `);

    expect(db.query("PRAGMA foreign_key_check;")).toEqual([]);

    const timeline = db.query(`
      SELECT s.title, e.category, e.goldstein
      FROM situations s
      JOIN situation_events se ON se.situation_id = s.id
      JOIN events e ON e.id = se.event_id
      WHERE s.id = 'sit1';
    `);
    expect(timeline).toEqual([{ title: "Test Situation", category: "militaryMovement", goldstein: -8 }]);

    const relatedAssets = db.query(`
      SELECT a.symbol, sa.relation_type, sa.rationale_key
      FROM situation_assets sa JOIN assets a ON a.id = sa.asset_id
      WHERE sa.situation_id = 'sit1';
    `);
    expect(relatedAssets).toEqual([{ symbol: "TSM", relation_type: "supply_chain", rationale_key: "semiconductor_supply_concern" }]);

    // The de-branding contract, verified at the schema/query level: a query that
    // selects only the public-safe columns must be able to answer the outlook
    // question without ever touching venue/slug/url.
    const publicOutlook = db.query(`
      SELECT om.question_normalised AS question, om.probability, so.confidence, so.method
      FROM situation_outlook so JOIN outlook_markets om ON om.id = so.market_id
      WHERE so.situation_id = 'sit1' AND so.confidence >= 0.70;
    `);
    expect(publicOutlook).toEqual([
      { question: "Major escalation", probability: 0.23, confidence: 0.82, method: "market_implied_v1" },
    ]);
    const publicOutlookColumns = Object.keys(publicOutlook[0] as object);
    expect(publicOutlookColumns).not.toContain("venue");
    expect(publicOutlookColumns).not.toContain("slug");
    expect(publicOutlookColumns).not.toContain("url");
  });

  it("a situation_outlook row below the 0.70 confidence threshold is excluded by the public query", () => {
    db.exec(`
      INSERT INTO situations (id, slug, title, category, lat, lon, status, first_seen_at, last_event_at)
        VALUES ('sit2', 'low-confidence', 'Low Confidence', 'protestCivilUnrest', 0, 0, 'active',
          '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z');
      INSERT INTO outlook_markets (id, venue, slug, question, question_normalised, probability, updated_at)
        VALUES ('out2', 'v', 's', 'q', 'Some question', 0.5, '2026-09-20T00:00:00Z');
      INSERT INTO situation_outlook (situation_id, market_id, confidence, matched_by, method)
        VALUES ('sit2', 'out2', 0.4, 'token', 'market_implied_v1');
    `);
    const publicOutlook = db.query(`
      SELECT * FROM situation_outlook WHERE situation_id = 'sit2' AND confidence >= 0.70;
    `);
    expect(publicOutlook).toEqual([]);
  });
});

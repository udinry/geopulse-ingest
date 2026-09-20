-- Sources & their licensing register, and the articles ingested from them.
-- See GeoPulse/docs/ARCHITECTURE.md's market-data/news-licensing table — every row
-- inserted here must have a real, dated terms_reviewed_at citation. This is the
-- enforcement point for CLAUDE.md's "never invent data" / licence-gating rules at
-- the schema level: nothing should be fetched from a source that isn't first a row here.

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  feed_url TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('rss', 'gdelt', 'api', 'government')),
  credibility_tier INTEGER NOT NULL CHECK (credibility_tier BETWEEN 1 AND 4), -- 1=wire/official ... 4=aggregator
  license_class TEXT NOT NULL CHECK (license_class IN ('green', 'amber', 'red')),
  excerpt_allowed INTEGER NOT NULL DEFAULT 0 CHECK (excerpt_allowed IN (0, 1)),
  attribution_text TEXT,
  attribution_url TEXT,
  terms_url TEXT,
  terms_reviewed_at TEXT, -- ISO8601 date of the last manual ToS review (the audit trail)
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  etag TEXT,
  last_modified TEXT,
  last_ok_at TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_sources_active ON sources (is_active);
CREATE INDEX idx_sources_kind ON sources (kind);

CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  url_canonical TEXT NOT NULL,
  url_hash TEXT NOT NULL, -- see src/normalize/canonicalUrl.ts — dedup cascade stage 1
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  title_simhash TEXT NOT NULL, -- 64-bit SimHash fingerprint as a hex string — see src/dedupe/titleSimHash.ts
  -- Populated ONLY when the owning source's excerpt_allowed = 1. SQLite CHECK
  -- constraints can't reference another table, so this is enforced in the emit
  -- layer (Phase 2+) and covered by a contract test there, not here.
  excerpt TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  lang TEXT,
  country_iso TEXT,
  dedup_group_id TEXT -- the canonical article's own id for this dedup cluster
);

CREATE UNIQUE INDEX idx_articles_url_canonical ON articles (url_canonical);
CREATE INDEX idx_articles_url_hash ON articles (url_hash);
CREATE INDEX idx_articles_dedup_group ON articles (dedup_group_id);
CREATE INDEX idx_articles_source ON articles (source_id);
CREATE INDEX idx_articles_published_at ON articles (published_at);

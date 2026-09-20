-- The outlook (probability) layer. This table is the ENFORCEMENT POINT of the
-- de-branding contract described in docs/ARCHITECTURE.md — venue/slug/url are
-- required here (to refetch prices) but the emit layer must NEVER serialise them
-- to the read API, in any region. See CLAUDE.md non-negotiable #3 and the
-- emit-layer contract test (added when Phase 5/13 build the actual emit path).

CREATE TABLE outlook_markets (
  id TEXT PRIMARY KEY,
  -- ⚠ INTERNAL ONLY — venue, slug, url must never leave this table for the client.
  venue TEXT NOT NULL,
  slug TEXT NOT NULL,
  url TEXT,
  question TEXT NOT NULL,
  question_normalised TEXT NOT NULL, -- venue-neutral phrasing — this IS safe to serialise
  description TEXT,
  category TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  end_date TEXT,
  volume REAL,
  liquidity REAL,
  outcome_label TEXT,
  probability REAL NOT NULL CHECK (probability BETWEEN 0 AND 1),
  prev_probability REAL,
  prob_change_1h REAL,
  prob_change_24h REAL,
  updated_at TEXT NOT NULL,
  is_resolved INTEGER NOT NULL DEFAULT 0 CHECK (is_resolved IN (0, 1))
);

CREATE UNIQUE INDEX idx_outlook_markets_venue_slug ON outlook_markets (venue, slug);
CREATE INDEX idx_outlook_markets_resolved ON outlook_markets (is_resolved);

CREATE TABLE situation_outlook (
  situation_id TEXT NOT NULL REFERENCES situations(id),
  market_id TEXT NOT NULL REFERENCES outlook_markets(id),
  -- Must exceed tau=0.70 to display at all — see planning doc §9.3. A row below
  -- threshold should simply not exist / not be surfaced by the emit query.
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  matched_by TEXT NOT NULL CHECK (matched_by IN ('entity', 'category', 'manual', 'token')),
  is_manually_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_manually_verified IN (0, 1)),
  method TEXT NOT NULL DEFAULT 'market_implied_v1', -- the NAMED rule shown to users instead of a venue
  PRIMARY KEY (situation_id, market_id)
);

CREATE INDEX idx_situation_outlook_market ON situation_outlook (market_id);

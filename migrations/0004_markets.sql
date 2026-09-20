-- Market data. `license_class` is the legal gate — see docs/ARCHITECTURE.md's
-- market-data table and CLAUDE.md non-negotiable #4. Every row inserted here must
-- correspond to an asset class actually cleared for commercial display; NASDAQ,
-- NIFTY and individual equities are 'red' and must never appear in the seed data
-- without an explicit licensing decision (see the seed file's own note on this).

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('equity', 'index', 'fx', 'crypto', 'commodity', 'bond')),
  exchange TEXT,
  currency TEXT NOT NULL,
  country_iso TEXT,
  data_source TEXT NOT NULL, -- e.g. 'binance', 'ecb_frankfurter', 'eia'
  license_class TEXT NOT NULL CHECK (license_class IN ('green', 'amber', 'red')),
  is_delayed INTEGER NOT NULL DEFAULT 0 CHECK (is_delayed IN (0, 1)),
  delay_minutes INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_assets_symbol_class ON assets (symbol, class);
CREATE INDEX idx_assets_license_class ON assets (license_class);

CREATE TABLE asset_prices (
  asset_id TEXT NOT NULL REFERENCES assets(id),
  ts TEXT NOT NULL,
  price REAL NOT NULL,
  change_pct REAL,
  as_of TEXT NOT NULL, -- source-stamped time; drives GeoPulseKit's FreshnessLabel, never implied
  session_state TEXT NOT NULL CHECK (session_state IN ('open', 'closed', 'preMarket', 'postMarket', 'continuous')),
  PRIMARY KEY (asset_id, ts)
);

CREATE TABLE situation_assets (
  situation_id TEXT NOT NULL REFERENCES situations(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('geographic', 'sector', 'supply_chain', 'commodity')),
  weight REAL NOT NULL DEFAULT 1.0,
  rationale_key TEXT NOT NULL, -- an i18n key — NEVER generated prose, see docs/ARCHITECTURE.md
  source TEXT NOT NULL, -- the deterministic rule id that created this link
  PRIMARY KEY (situation_id, asset_id, relation_type)
);

CREATE INDEX idx_situation_assets_asset ON situation_assets (asset_id);

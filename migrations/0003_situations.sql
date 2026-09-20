-- Situations: the ongoing story made of related EVENTS. This is what the map renders
-- and what the Situation Detail screen opens into — see planning doc §6.

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('country', 'org', 'person', 'place', 'asset')),
  canonical_name TEXT NOT NULL,
  wikidata_id TEXT,
  country_iso TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]' -- the gazetteer: hand-curated + GKG-derived aliases
);

CREATE INDEX idx_entities_type ON entities (type);
CREATE INDEX idx_entities_canonical_name ON entities (canonical_name);

CREATE TABLE situations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, -- extractive, never AI-generated — see docs/ARCHITECTURE.md
  headline_article_id TEXT REFERENCES articles(id), -- most-cited article from the top-tier source
  -- Same category list as events.category (0002) — SQLite CHECK constraints can't share a
  -- domain across tables, so this is duplicated by necessity; keep both in sync with
  -- GeoPulseKit's EventCategory.
  category TEXT NOT NULL CHECK (category IN (
    'warArmedConflict', 'militaryMovement', 'terrorismSecurityIncident',
    'electionPoliticalTransition', 'protestCivilUnrest', 'diplomaticNegotiation',
    'sanctionsTradeRestriction', 'internationalDispute',
    'centralBankDecision', 'macroDataRelease', 'fiscalPolicy',
    'bankingFinancialSystem', 'majorCorporateEvent',
    'oilEnergyDisruption', 'shippingMaritimeDisruption', 'aviationDisruption',
    'earthquakeTsunami', 'hurricaneExtremeWeather', 'majorFireIndustrialAccident'
  )),
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  geo_name TEXT,
  country_iso TEXT,
  bbox_json TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'recent', 'archived')),
  first_seen_at TEXT NOT NULL,
  last_event_at TEXT NOT NULL,
  trending_score REAL NOT NULL DEFAULT 0,
  score_updated_at TEXT,
  peak_score REAL NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  map_rank INTEGER -- 1..10 when promoted onto the global map view; NULL otherwise
);

CREATE INDEX idx_situations_status ON situations (status);
CREATE INDEX idx_situations_trending_score ON situations (trending_score DESC);
CREATE INDEX idx_situations_map_rank ON situations (map_rank);
CREATE INDEX idx_situations_country ON situations (country_iso);

CREATE TABLE situation_events (
  situation_id TEXT NOT NULL REFERENCES situations(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  joined_at TEXT NOT NULL,
  similarity REAL, -- the clustering score at the moment this event joined — see planning doc §8
  PRIMARY KEY (situation_id, event_id)
);

CREATE INDEX idx_situation_events_event ON situation_events (event_id);

CREATE TABLE situation_entities (
  situation_id TEXT NOT NULL REFERENCES situations(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  weight REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (situation_id, entity_id)
);

CREATE INDEX idx_situation_entities_entity ON situation_entities (entity_id);

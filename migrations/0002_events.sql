-- Atomic developments (an individual report/development), as distinct from a
-- SITUATION (the ongoing story made of related events) — see
-- GeoPulse/docs/planning/2026-09-20-initial-plan.md §6.

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  gdelt_event_id TEXT UNIQUE, -- NULL for events sourced from non-GDELT feeds (USGS, NOAA, ...)
  cameo_code TEXT,
  cameo_root TEXT,
  quad_class INTEGER CHECK (quad_class BETWEEN 1 AND 4), -- 1=verbal coop 2=material coop 3=verbal conflict 4=material conflict
  goldstein REAL, -- -10..+10, the severity primitive — see docs/ARCHITECTURE.md's severity model
  actor1_code TEXT,
  actor1_name TEXT,
  actor2_code TEXT,
  actor2_name TEXT,
  lat REAL,
  lon REAL,
  geo_name TEXT,
  country_iso TEXT,
  geo_precision INTEGER,
  occurred_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  num_mentions INTEGER NOT NULL DEFAULT 0,
  num_sources INTEGER NOT NULL DEFAULT 0,
  num_articles INTEGER NOT NULL DEFAULT 0,
  avg_tone REAL,
  -- Mirrors GeoPulseKit's EventCategory raw values byte-for-byte — keep this list in sync
  -- with Packages/GeoPulseKit/Sources/GeoPulseKit/Models/EventCategory.swift if it ever changes.
  category TEXT NOT NULL CHECK (category IN (
    'warArmedConflict', 'militaryMovement', 'terrorismSecurityIncident',
    'electionPoliticalTransition', 'protestCivilUnrest', 'diplomaticNegotiation',
    'sanctionsTradeRestriction', 'internationalDispute',
    'centralBankDecision', 'macroDataRelease', 'fiscalPolicy',
    'bankingFinancialSystem', 'majorCorporateEvent',
    'oilEnergyDisruption', 'shippingMaritimeDisruption', 'aviationDisruption',
    'earthquakeTsunami', 'hurricaneExtremeWeather', 'majorFireIndustrialAccident'
  ))
);

CREATE INDEX idx_events_category ON events (category);
CREATE INDEX idx_events_occurred_at ON events (occurred_at);
CREATE INDEX idx_events_country ON events (country_iso);

CREATE TABLE event_articles (
  event_id TEXT NOT NULL REFERENCES events(id),
  article_id TEXT NOT NULL REFERENCES articles(id),
  PRIMARY KEY (event_id, article_id)
);

CREATE INDEX idx_event_articles_article ON event_articles (article_id);

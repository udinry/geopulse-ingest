-- Trending-score audit history, and the alerts/devices tables. No account, no
-- email, no PII anywhere here by design — see docs/ARCHITECTURE.md's privacy notes.

CREATE TABLE score_history (
  situation_id TEXT NOT NULL REFERENCES situations(id),
  ts TEXT NOT NULL,
  score REAL NOT NULL,
  components_json TEXT NOT NULL, -- an ImpulseComponents snapshot, for audit + the Phase 4 backtest
  PRIMARY KEY (situation_id, ts)
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  apns_token TEXT NOT NULL UNIQUE,
  region_iso TEXT, -- for the outlook kill-switch only (docs/ARCHITECTURE.md §9.4) — never joined to identity
  is_pro INTEGER NOT NULL DEFAULT 0 CHECK (is_pro IN (0, 1)),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  kind TEXT NOT NULL CHECK (kind IN ('price', 'percent', 'velocity', 'situation', 'outlook')),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('asset', 'situation', 'market')),
  subject_id TEXT NOT NULL,
  operator TEXT NOT NULL CHECK (operator IN ('gt', 'gte', 'lt', 'lte', 'crosses')),
  threshold REAL NOT NULL,
  window_minutes INTEGER,
  combinator_group_id TEXT, -- AND/OR group id for advanced conditions (progressive disclosure, planning doc §16)
  live_activity INTEGER NOT NULL DEFAULT 0 CHECK (live_activity IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_fired_at TEXT,
  cooldown_minutes INTEGER NOT NULL DEFAULT 15
);

CREATE INDEX idx_alerts_subject ON alerts (subject_type, subject_id, is_active);
CREATE INDEX idx_alerts_device ON alerts (device_id);

CREATE TABLE alert_deliveries (
  alert_id TEXT NOT NULL REFERENCES alerts(id),
  fired_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL, -- dedup + audit
  PRIMARY KEY (alert_id, fired_at)
);

-- What a device follows, so the server can push when a situation may affect it.
-- Symbols only: no prices, no account, no identity beyond the existing device row.
CREATE TABLE device_watches (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('company', 'asset')),
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (device_id, kind, symbol, exchange)
);

-- One push per (watch, situation), ever: the dedup record for impact notifications.
CREATE TABLE watch_deliveries (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT '',
  situation_id TEXT NOT NULL,
  delivered_at TEXT NOT NULL,
  PRIMARY KEY (device_id, kind, symbol, exchange, situation_id)
);

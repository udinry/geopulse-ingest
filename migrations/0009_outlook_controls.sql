-- Regional operational control for the de-branded outlook layer. This is a
-- kill-switch, not a visibility preference: disabled regions receive no rows.
CREATE TABLE outlook_controls (
  region_iso TEXT PRIMARY KEY,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  reason TEXT,
  updated_at TEXT NOT NULL
);

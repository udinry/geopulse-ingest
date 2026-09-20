-- Observability without paid tools: every ingestion run records its own outcome here,
-- which is the entire "monitoring" story for a project targeting ~₹0/month.

CREATE TABLE ingest_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  stage TEXT NOT NULL CHECK (stage IN (
    'fetch', 'normalize', 'dedupe', 'cluster', 'score', 'link', 'emit', 'lifecycle', 'calibrate'
  )),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  counts_json TEXT,
  error TEXT
);

CREATE INDEX idx_ingest_runs_started_at ON ingest_runs (started_at);
CREATE INDEX idx_ingest_runs_status ON ingest_runs (status);

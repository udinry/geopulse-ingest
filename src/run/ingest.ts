import type { Queryable } from "../api/handler.js";
import { downloadAndExtractCsv, fetchLastUpdatePointers, type GdeltFilePointer } from "../fetch/gdeltEvents.js";
import { ingestLicensedQuotes } from "../markets/ingest.js";
import { isGeopoliticallyRelevant } from "../normalize/actorRelevance.js";
import { parseEventsExport } from "../normalize/gdeltEventParser.js";
import { mapGdeltEventToEventRow } from "../normalize/mapGdeltEvent.js";
import { parseGkgTitles } from "../normalize/gkgParser.js";
import type { EventRow } from "../shared/types.js";
import { ingestBatch, refreshRanking, type BatchResult } from "./pipeline.js";
import type { BatchWriter } from "./sql.js";

const BASE = "https://data.gdeltproject.org/gdeltv2";
const INTERVAL_MS = 15 * 60_000;
/** Bound one run's work; a backlog drains over the next runs. */
const MAX_INTERVALS_PER_RUN = 6;
/** First run (no watermark) looks back this far rather than the whole archive. */
const FIRST_RUN_LOOKBACK_INTERVALS = 24;

type Db = Queryable & Partial<BatchWriter>;

export interface IngestOptions {
  now?: () => string;
  eiaAPIKey?: string;
  log?: (message: string) => void;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function formatInterval(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

export function parseInterval(ts: string): number {
  return Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10), +ts.slice(10, 12), +ts.slice(12, 14));
}

async function exists(url: string): Promise<boolean> {
  const response = await fetch(url, { method: "HEAD" });
  return response.ok;
}

function pointer(kind: "export" | "gkg", ts: string): GdeltFilePointer {
  const suffix = kind === "export" ? "export.CSV.zip" : "gkg.csv.zip";
  return { kind, sizeBytes: 0, md5: "", url: `${BASE}/${ts}.${suffix}`, timestamp: ts };
}

/**
 * The GKG (headlines) file for an interval is published a little after its Events
 * export, and `lastupdate.txt` lists it before it exists. So an interval is processed
 * only once BOTH files are retrievable; otherwise the run stops there and the next
 * run resumes from the same watermark. Events without a headline are never stored.
 */
async function processInterval(db: Db, ts: string, now: string): Promise<BatchResult> {
  const [exportCsv, gkgCsv] = await Promise.all([downloadAndExtractCsv(pointer("export", ts)), downloadAndExtractCsv(pointer("gkg", ts))]);
  const parsed = parseEventsExport(exportCsv);
  const events: EventRow[] = [];
  const sourceUrls = new Map<string, string>();
  for (const raw of parsed.rows) {
    if (!isGeopoliticallyRelevant(raw)) continue;
    const event = mapGdeltEventToEventRow(raw);
    if (event === null) continue;
    events.push(event);
    sourceUrls.set(event.id, raw.sourceUrl);
  }
  return ingestBatch(db, { events, sourceUrls, titles: parseGkgTitles(gkgCsv), now });
}

export async function runIngest(db: Db, options: IngestOptions = {}): Promise<Record<string, unknown>> {
  const log = options.log ?? (() => {});
  const startedAt = (options.now ?? (() => new Date().toISOString()))();
  const runId = `run-${startedAt}`;
  await db.run("INSERT INTO ingest_runs (id, started_at, stage, status) VALUES (?, ?, 'fetch', 'running')", runId, startedAt);
  const counts: Record<string, unknown> = { intervals: [] as string[], eventsKept: 0, situationsCreated: 0 };

  try {
    const last = await db.first<{ counts_json: string | null }>("SELECT counts_json FROM ingest_runs WHERE stage = 'fetch' AND status = 'success' ORDER BY started_at DESC LIMIT 1");
    const watermark = last?.counts_json ? (JSON.parse(last.counts_json) as { lastInterval?: string }).lastInterval : undefined;

    const latest = (await fetchLastUpdatePointers()).find((p) => p.kind === "export");
    if (latest === undefined) throw new Error("lastupdate.txt listed no export file");
    const latestMs = parseInterval(latest.timestamp);
    const firstMs = watermark ? parseInterval(watermark) + INTERVAL_MS : latestMs - FIRST_RUN_LOOKBACK_INTERVALS * INTERVAL_MS;

    let lastDone = watermark;
    let processed = 0;
    for (let ms = firstMs; ms <= latestMs && processed < MAX_INTERVALS_PER_RUN; ms += INTERVAL_MS) {
      const ts = formatInterval(ms);
      if (!(await exists(pointer("export", ts).url)) || !(await exists(pointer("gkg", ts).url))) {
        log(`interval ${ts}: files not both published yet, stopping here`);
        break;
      }
      const result = await processInterval(db, ts, startedAt);
      log(`interval ${ts}: seen ${result.eventsSeen}, kept ${result.eventsKept}, new situations ${result.situationsCreated}, touched ${result.situationsTouched}`);
      (counts.intervals as string[]).push(ts);
      counts.eventsKept = (counts.eventsKept as number) + result.eventsKept;
      counts.situationsCreated = (counts.situationsCreated as number) + result.situationsCreated;
      lastDone = ts;
      processed += 1;
    }

    const ranking = await refreshRanking(db, startedAt);
    counts.ranked = ranking.ranked;
    log(`ranked ${ranking.ranked} situations onto the map`);

    const quoteOptions = options.eiaAPIKey === undefined ? {} : { eiaAPIKey: options.eiaAPIKey };
    counts.quotes = await ingestLicensedQuotes(db, { now: () => startedAt, ...quoteOptions });
    log(`stored ${counts.quotes} quotes`);

    counts.lastInterval = lastDone;
    await db.run("UPDATE ingest_runs SET status = 'success', finished_at = ?, counts_json = ? WHERE id = ?", new Date().toISOString(), JSON.stringify(counts), runId);
    return counts;
  } catch (error) {
    await db.run("UPDATE ingest_runs SET status = 'failed', finished_at = ?, counts_json = ?, error = ? WHERE id = ?", new Date().toISOString(), JSON.stringify(counts), String(error), runId);
    throw error;
  }
}

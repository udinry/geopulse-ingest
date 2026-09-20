/**
 * GDELT 2.0 Events real-time ingestion: the documented production pattern is to poll
 * `lastupdate.txt` (updated every 15 minutes) for the three latest file pointers
 * (export/mentions/gkg), then download and parse whichever are new — see
 * docs/planning/2026-09-20-initial-plan.md §10 and the GDELT 2.0 Event Codebook
 * (http://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf).
 *
 * This intentionally does NOT use the DOC 2.0 search API (api.gdeltproject.org) for
 * event data — that endpoint is throttled hard per-IP ("one request every 5 seconds",
 * confirmed by hitting it directly during development) and is meant for keyword search,
 * not bulk real-time polling. `lastupdate.txt` and the dated file URLs are the correct,
 * lower-load path and were verified live against production GDELT infrastructure.
 *
 * IO (fetchLastUpdatePointers, downloadAndExtractCsv) is kept separate from parsing
 * (parseEventsExport, in gdeltEventParser.ts) precisely so the parser can be tested
 * against a frozen real fixture without a network call in the test suite.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LAST_UPDATE_URL = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt";

export type GdeltFileKind = "export" | "mentions" | "gkg";

export interface GdeltFilePointer {
  kind: GdeltFileKind;
  sizeBytes: number;
  md5: string;
  url: string;
  /** The YYYYMMDDHHMMSS timestamp embedded in the filename — this is what change
   * detection (brief §25: "do not repeatedly process unchanged data") should compare
   * against the last value recorded in `ingest_runs`, not a wall-clock poll interval. */
  timestamp: string;
}

function kindFromUrl(url: string): GdeltFileKind | null {
  if (url.endsWith(".export.CSV.zip")) return "export";
  if (url.endsWith(".mentions.CSV.zip")) return "mentions";
  if (url.endsWith(".gkg.csv.zip")) return "gkg";
  return null;
}

/** Parses the 3-line lastupdate.txt format: "<size> <md5> <url>" per line, one per kind. */
export function parseLastUpdate(text: string): GdeltFilePointer[] {
  const pointers: GdeltFilePointer[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 3) continue;
    const [sizeStr, md5, url] = parts as [string, string, string];
    const kind = kindFromUrl(url);
    if (!kind) continue;
    const filenameMatch = url.match(/(\d{14})\./);
    if (!filenameMatch) continue;
    pointers.push({
      kind,
      sizeBytes: Number(sizeStr),
      md5,
      url,
      timestamp: filenameMatch[1] as string,
    });
  }
  return pointers;
}

export async function fetchLastUpdatePointers(): Promise<GdeltFilePointer[]> {
  const response = await fetch(LAST_UPDATE_URL);
  if (!response.ok) {
    throw new Error(`lastupdate.txt fetch failed: HTTP ${response.status}`);
  }
  return parseLastUpdate(await response.text());
}

/** Downloads a GDELT zip and returns the decompressed CSV text. Shells out to the
 * system `unzip` CLI rather than adding a zip-parsing dependency — same dependency-free
 * pattern as tests/dbTestHelper.ts's use of the system `sqlite3` CLI. */
export async function downloadAndExtractCsv(pointer: GdeltFilePointer): Promise<string> {
  const response = await fetch(pointer.url);
  if (!response.ok) {
    throw new Error(`GDELT file fetch failed (${pointer.url}): HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const dir = mkdtempSync(join(tmpdir(), "geopulse-gdelt-"));
  try {
    const zipPath = join(dir, "file.zip");
    writeFileSync(zipPath, buffer);
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", dir]);
    const csvName = pointer.url.split("/").pop()!.replace(/\.zip$/, "");
    return readFileSync(join(dir, csvName), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Parses GDELT 2.0's Events export CSV (tab-separated, 61 columns, no header row) —
 * column order confirmed against a real file downloaded from
 * data.gdeltproject.org/gdeltv2/ during development (see the GDELT 2.0 Event Codebook
 * for the authoritative field list: http://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf).
 */

export interface RawGdeltEventRow {
  globalEventId: string;
  sqlDate: string; // YYYYMMDD
  actor1Code: string;
  actor1Name: string;
  actor1CountryCode: string;
  actor2Code: string;
  actor2Name: string;
  actor2CountryCode: string;
  eventCode: string;
  eventRootCode: string;
  quadClass: string;
  goldsteinScale: string;
  numMentions: string;
  numSources: string;
  numArticles: string;
  avgTone: string;
  actionGeoType: string;
  actionGeoFullName: string;
  actionGeoCountryCode: string;
  actionGeoLat: string;
  actionGeoLong: string;
  dateAdded: string; // YYYYMMDDHHMMSS
  sourceUrl: string;
}

const EXPECTED_COLUMN_COUNT = 61;

// Zero-based column indices for the fields we actually use — see the codebook for the
// full 61-column layout; unused columns (actor ethnic/religion/type codes, the Actor1/
// Actor2 geo blocks, ADM1/ADM2/FeatureID, EventBaseCode) are intentionally skipped
// rather than modeled, since nothing in our schema consumes them yet.
const COL = {
  globalEventId: 0,
  sqlDate: 1,
  actor1Code: 5,
  actor1Name: 6,
  actor1CountryCode: 7,
  actor2Code: 15,
  actor2Name: 16,
  actor2CountryCode: 17,
  eventCode: 26,
  eventRootCode: 28,
  quadClass: 29,
  goldsteinScale: 30,
  numMentions: 31,
  numSources: 32,
  numArticles: 33,
  avgTone: 34,
  actionGeoType: 51,
  actionGeoFullName: 52,
  actionGeoCountryCode: 53,
  actionGeoLat: 56,
  actionGeoLong: 57,
  dateAdded: 59,
  sourceUrl: 60,
} as const;

export interface ParseResult<T> {
  rows: T[];
  skippedLineCount: number;
}

export function parseEventsExport(csvText: string): ParseResult<RawGdeltEventRow> {
  const rows: RawGdeltEventRow[] = [];
  let skippedLineCount = 0;

  for (const line of csvText.split("\n")) {
    if (line.trim().length === 0) continue;
    const fields = line.split("\t");
    if (fields.length !== EXPECTED_COLUMN_COUNT) {
      skippedLineCount++;
      continue;
    }
    rows.push({
      globalEventId: fields[COL.globalEventId] as string,
      sqlDate: fields[COL.sqlDate] as string,
      actor1Code: fields[COL.actor1Code] as string,
      actor1Name: fields[COL.actor1Name] as string,
      actor1CountryCode: fields[COL.actor1CountryCode] as string,
      actor2Code: fields[COL.actor2Code] as string,
      actor2Name: fields[COL.actor2Name] as string,
      actor2CountryCode: fields[COL.actor2CountryCode] as string,
      eventCode: fields[COL.eventCode] as string,
      eventRootCode: fields[COL.eventRootCode] as string,
      quadClass: fields[COL.quadClass] as string,
      goldsteinScale: fields[COL.goldsteinScale] as string,
      numMentions: fields[COL.numMentions] as string,
      numSources: fields[COL.numSources] as string,
      numArticles: fields[COL.numArticles] as string,
      avgTone: fields[COL.avgTone] as string,
      actionGeoType: fields[COL.actionGeoType] as string,
      actionGeoFullName: fields[COL.actionGeoFullName] as string,
      actionGeoCountryCode: fields[COL.actionGeoCountryCode] as string,
      actionGeoLat: fields[COL.actionGeoLat] as string,
      actionGeoLong: fields[COL.actionGeoLong] as string,
      dateAdded: fields[COL.dateAdded] as string,
      sourceUrl: fields[COL.sourceUrl] as string,
    });
  }

  return { rows, skippedLineCount };
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseLastUpdate } from "../src/fetch/gdeltEvents.js";
import { parseEventsExport } from "../src/normalize/gdeltEventParser.js";
import { mapGdeltEventToEventRow } from "../src/normalize/mapGdeltEvent.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/gdelt-events-sample.tsv", import.meta.url));

describe("parseLastUpdate", () => {
  it("parses the real 3-line lastupdate.txt format into typed pointers", () => {
    // This exact text was fetched live from data.gdeltproject.org during development.
    const text = [
      "54071 9767e9829c3ffed66ddcb526d481129b http://data.gdeltproject.org/gdeltv2/20260920130000.export.CSV.zip",
      "72583 9d8943c762a40f2971ae97039ea56d2a http://data.gdeltproject.org/gdeltv2/20260920130000.mentions.CSV.zip",
      "3117025 9949bbd05dafd2e216a85b30dc7b1d72 http://data.gdeltproject.org/gdeltv2/20260920130000.gkg.csv.zip",
      "",
    ].join("\n");
    const pointers = parseLastUpdate(text);
    expect(pointers).toHaveLength(3);
    expect(pointers.map((p) => p.kind)).toEqual(["export", "mentions", "gkg"]);
    expect(pointers[0]).toEqual({
      kind: "export",
      sizeBytes: 54071,
      md5: "9767e9829c3ffed66ddcb526d481129b",
      url: "http://data.gdeltproject.org/gdeltv2/20260920130000.export.CSV.zip",
      timestamp: "20260920130000",
    });
  });

  it("ignores malformed or unrecognized lines rather than throwing", () => {
    expect(parseLastUpdate("garbage\nnot enough fields\n")).toEqual([]);
  });
});

describe("parseEventsExport against a real GDELT sample (40 rows, live-downloaded)", () => {
  const csvText = readFileSync(FIXTURE, "utf8");

  it("parses every row with none skipped (column count matches the documented 61-field layout)", () => {
    const { rows, skippedLineCount } = parseEventsExport(csvText);
    expect(rows).toHaveLength(40);
    expect(skippedLineCount).toBe(0);
  });

  it("extracts recognizable real fields from the first row", () => {
    const { rows } = parseEventsExport(csvText);
    const first = rows[0]!;
    expect(first.globalEventId).toMatch(/^\d+$/);
    expect(first.sqlDate).toMatch(/^\d{8}$/);
    expect(first.dateAdded).toMatch(/^\d{14}$/);
    expect(first.sourceUrl).toMatch(/^https?:\/\//);
  });
});

describe("mapGdeltEventToEventRow against the same real sample", () => {
  const csvText = readFileSync(FIXTURE, "utf8");
  const { rows } = parseEventsExport(csvText);

  it("maps every real row to a valid EventRow (all root codes 01-20 are covered by the CAMEO map)", () => {
    const mapped = rows.map(mapGdeltEventToEventRow);
    const nullCount = mapped.filter((m) => m === null).length;
    expect(nullCount).toBe(0);
  });

  it("produces a stable, GDELT-prefixed id and preserves the raw gdelt_event_id", () => {
    const mapped = mapGdeltEventToEventRow(rows[0]!);
    expect(mapped).not.toBeNull();
    expect(mapped!.id).toBe(`gdelt-${rows[0]!.globalEventId}`);
    expect(mapped!.gdelt_event_id).toBe(rows[0]!.globalEventId);
  });

  it("converts SQLDATE and DATEADDED to correct ISO8601 timestamps", () => {
    const mapped = mapGdeltEventToEventRow(rows[0]!)!;
    expect(mapped.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
    expect(mapped.first_seen_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("assigns a category consistent with the CAMEO root code map, not a guess", () => {
    const mapped = mapGdeltEventToEventRow(rows[0]!)!;
    const validCategories = [
      "warArmedConflict", "militaryMovement", "terrorismSecurityIncident",
      "electionPoliticalTransition", "protestCivilUnrest", "diplomaticNegotiation",
      "sanctionsTradeRestriction", "internationalDispute", "centralBankDecision",
      "macroDataRelease", "fiscalPolicy", "bankingFinancialSystem", "majorCorporateEvent",
      "oilEnergyDisruption", "shippingMaritimeDisruption", "aviationDisruption",
      "earthquakeTsunami", "hurricaneExtremeWeather", "majorFireIndustrialAccident",
    ];
    expect(validCategories).toContain(mapped.category);
  });

  it("returns null (never a guessed category) for an unrecognized root code", () => {
    const badRow = { ...rows[0]!, eventRootCode: "99" };
    expect(mapGdeltEventToEventRow(badRow)).toBeNull();
  });

  it("leaves lat/lon null rather than defaulting to 0,0 when geo fields are empty", () => {
    const rowWithNoGeo = { ...rows[0]!, actionGeoLat: "", actionGeoLong: "" };
    const mapped = mapGdeltEventToEventRow(rowWithNoGeo)!;
    expect(mapped.lat).toBeNull();
    expect(mapped.lon).toBeNull();
  });

  it("converts ActionGeo_CountryCode (FIPS) to ISO 3166-1 alpha-2, not the raw FIPS code — regression test for a real bug found while building Phase 3's gazetteer", () => {
    // Real row 18 in the fixture (globalEventId 1323952165) has ActionGeo_CountryCode
    // = "CH" (FIPS for China). Storing that raw into country_iso would make a Chinese
    // event look Swiss (ISO "CH" = Switzerland) to anything consuming the field.
    const chinaRow = rows.find((r) => r.globalEventId === "1323952165");
    expect(chinaRow).toBeDefined();
    expect(chinaRow!.actionGeoCountryCode).toBe("CH");
    const mapped = mapGdeltEventToEventRow(chinaRow!)!;
    expect(mapped.country_iso).toBe("CN");
  });
});

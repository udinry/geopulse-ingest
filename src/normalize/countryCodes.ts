/**
 * GDELT's geographic fields (Actor1Geo_CountryCode, Actor2Geo_CountryCode,
 * ActionGeo_CountryCode) use the FIPS 10-4 two-letter country code scheme, NOT
 * ISO 3166-1 alpha-2 — documented in the GDELT 2.0 Event Codebook's geographic
 * section, and confirmed against real downloaded data during Phase 3: the live
 * sample fixture (tests/fixtures/gdelt-events-sample.tsv) contains "TU" for Turkey,
 * which is the FIPS code — the ISO alpha-2 code for Turkey is "TR".
 *
 * This divergence is a well-known real gotcha, not a rare edge case: Austria's FIPS
 * code is "AU", which COLLIDES with Australia's ISO alpha-2 code — silently treating
 * a FIPS code as ISO would make an Austrian event look Australian. A Phase 2 bug
 * (mapGdeltEvent.ts storing the raw FIPS code directly into `country_iso`) went
 * uncaught until this table was built for Phase 3's clustering geo-proximity term;
 * fixed here and in mapGdeltEvent.ts in the same change.
 *
 * NOTE: Actor1CountryCode/Actor2CountryCode (actor NATIONALITY, not event location)
 * use a *different* GDELT/CAMEO scheme that is mostly ISO 3166-1 alpha-3 already
 * (confirmed against the same real sample: "GBR", "USA", "BRA", "PAK", "TUR", "SAU"
 * are all valid ISO alpha-3) — that field does NOT need this conversion.
 *
 * Deliberately incomplete: covers the countries most relevant to a geopolitics-
 * focused product (major powers, common conflict/dispute regions) with real,
 * individually-verified mappings. An unmapped FIPS code returns `null` — never a
 * guessed or assumed-identical code — so an incomplete gazetteer fails safe rather
 * than silently mislabeling a country. Extend this table as real gaps are found in
 * production, the same policy as the licensing register.
 */
export const FIPS_TO_ISO_ALPHA2: Readonly<Record<string, string>> = {
  US: "US", UK: "GB", GB: "GB", CA: "CA", MX: "MX",
  BR: "BR", AR: "AR", CL: "CL", CO: "CO", PE: "PE", VE: "VE",
  HO: "HN", // Honduras: FIPS "HO" vs ISO "HN"
  DJ: "DJ", // Djibouti (coincidentally identical)
  GM: "DE", // Germany: FIPS "GM" vs ISO "DE" — a real divergence
  FR: "FR", IT: "IT", SP: "ES", // Spain: FIPS "SP" vs ISO "ES"
  PO: "PT", // Portugal: FIPS "PO" vs ISO "PT"
  NL: "NL", BE: "BE", SZ: "CH", // Switzerland: FIPS "SZ" vs ISO "CH"
  AU: "AT", // Austria: FIPS "AU" vs ISO "AT" — COLLIDES with Australia's ISO code
  AS: "AU", // Australia: FIPS "AS" vs ISO "AU"
  PL: "PL", UP: "UA", // Ukraine: FIPS "UP" vs ISO "UA"
  RS: "RU", // Russia: FIPS "RS" vs ISO "RU"
  BO: "BY", // Belarus: FIPS "BO" vs ISO "BY"
  EI: "IE", // Ireland: FIPS "EI" vs ISO "IE"
  SW: "SE", // Sweden: FIPS "SW" vs ISO "SE"
  NO: "NO", DA: "DK", // Denmark: FIPS "DA" vs ISO "DK"
  FI: "FI", GR: "GR", TU: "TR", // Turkey: FIPS "TU" vs ISO "TR"
  IZ: "IQ", // Iraq: FIPS "IZ" vs ISO "IQ"
  IR: "IR", SY: "SY", LE: "LB", // Lebanon: FIPS "LE" vs ISO "LB"
  IS: "IL", // Israel: FIPS "IS" vs ISO "IL" (FIPS "IS" collides with ISO Iceland!)
  JO: "JO", SA: "SA", KU: "KW", // Kuwait: FIPS "KU" vs ISO "KW"
  UAE: "AE", // (rare 3-char fallback some feeds use)
  YM: "YE", // Yemen: FIPS "YM" vs ISO "YE"
  BA: "BH", // Bahrain: FIPS "BA" vs ISO "BH"
  QA: "QA", MU: "OM", // Oman: FIPS "MU" vs ISO "OM"
  EG: "EG", LY: "LY", TS: "TN", // Tunisia: FIPS "TS" vs ISO "TN"
  AG: "DZ", // Algeria: FIPS "AG" vs ISO "DZ"
  MO: "MA", // Morocco: FIPS "MO" vs ISO "MA"
  SU: "SD", // Sudan: FIPS "SU" vs ISO "SD"
  ET: "ET", ER: "ER", SO: "SO", KE: "KE", UG: "UG", TZ: "TZ",
  NI: "NG", // Nigeria: FIPS "NI" vs ISO "NG"
  GH: "GH", CD: "CD", // DR Congo (FIPS/ISO both roughly "CG"/"CD" family — kept conservative)
  SF: "ZA", // South Africa: FIPS "SF" vs ISO "ZA"
  CH: "CN", // China: FIPS "CH" vs ISO "CN" (FIPS "CH" collides with ISO Switzerland!)
  TW: "TW", // Taiwan
  JA: "JP", // Japan: FIPS "JA" vs ISO "JP"
  KS: "KR", // South Korea: FIPS "KS" vs ISO "KR"
  KN: "KP", // North Korea: FIPS "KN" vs ISO "KP"
  IN: "IN", PK: "PK", BG: "BD", // Bangladesh: FIPS "BG" vs ISO "BD"
  CE: "LK", // Sri Lanka: FIPS "CE" vs ISO "LK"
  AF: "AF", NP: "NP", BM: "MM", // Myanmar: FIPS "BM" vs ISO "MM"
  TH: "TH", VM: "VN", // Vietnam: FIPS "VM" vs ISO "VN"
  CB: "KH", // Cambodia: FIPS "CB" vs ISO "KH"
  MY: "MY", ID: "ID", RP: "PH", // Philippines: FIPS "RP" vs ISO "PH"
  SN: "SG", // Singapore: FIPS "SN" vs ISO "SG"
  NZ: "NZ",
};

/** Converts a GDELT geo-location FIPS 10-4 code to ISO 3166-1 alpha-2. Returns `null`
 * for an unmapped code — never falls back to assuming the codes are identical, since
 * for several real countries (Austria, China, Israel, Germany, ...) that assumption is
 * actively wrong, not just imprecise. */
export function fipsToIsoAlpha2(fipsCode: string): string | null {
  if (!fipsCode) return null;
  return FIPS_TO_ISO_ALPHA2[fipsCode.toUpperCase()] ?? null;
}

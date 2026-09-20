import { describe, expect, it } from "vitest";
import { parseDocApiResponse, type RawGdeltDocArticle } from "../src/fetch/gdeltDoc.js";
import { mapGdeltDocArticleToArticleRow } from "../src/normalize/mapGdeltArticle.js";

/**
 * ⚠ This fixture is constructed from GDELT's documented, stable DOC 2.0 API response
 * shape — NOT a live capture. See src/fetch/gdeltDoc.ts's doc comment for why: the
 * endpoint's per-IP throttle blocked verification during this development session.
 * Re-verify against a live response before trusting this in production.
 */
const DOCUMENTED_SHAPE_SAMPLE = JSON.stringify({
  articles: [
    {
      url: "https://www.reuters.com/world/asia-pacific/example-story",
      title: "Military activity reported near Taiwan Strait",
      seendate: "20260920T130000Z",
      domain: "reuters.com",
      language: "English",
      sourcecountry: "United Kingdom",
    },
    {
      url: "https://apnews.com/article/example-story",
      title: "",
      seendate: "20260920T131500Z",
      domain: "apnews.com",
      language: "English",
      sourcecountry: "United States",
    },
  ],
});

describe("parseDocApiResponse", () => {
  it("parses the documented { articles: [...] } shape", () => {
    const articles = parseDocApiResponse(DOCUMENTED_SHAPE_SAMPLE);
    expect(articles).toHaveLength(2);
    expect(articles[0]!.domain).toBe("reuters.com");
  });

  it("returns an empty array when the 'articles' key is absent", () => {
    expect(parseDocApiResponse("{}")).toEqual([]);
  });
});

describe("mapGdeltDocArticleToArticleRow", () => {
  const articles = parseDocApiResponse(DOCUMENTED_SHAPE_SAMPLE);
  const fetchedAt = "2026-09-20T13:05:00Z";

  it("maps a well-formed article to a valid ArticleRow, sourced to 'gdelt'", () => {
    const row = mapGdeltDocArticleToArticleRow(articles[0] as RawGdeltDocArticle, fetchedAt);
    expect(row).not.toBeNull();
    expect(row!.source_id).toBe("gdelt");
    expect(row!.excerpt).toBeNull(); // gdelt's excerpt_allowed = false
    expect(row!.title).toBe("Military activity reported near Taiwan Strait");
    expect(row!.published_at).toBe("2026-09-20T13:00:00Z");
  });

  it("recognizes a well-known publisher domain and sets publisher_name", () => {
    const row = mapGdeltDocArticleToArticleRow(articles[0] as RawGdeltDocArticle, fetchedAt)!;
    expect(row.publisher_domain).toBe("reuters.com");
    expect(row.publisher_name).toBe("Reuters");
  });

  it("leaves publisher_name null for an unrecognized domain rather than guessing", () => {
    const raw: RawGdeltDocArticle = {
      url: "https://obscure-outlet.example/story",
      title: "Some headline",
      seendate: "20260920T130000Z",
      domain: "obscure-outlet.example",
      language: "English",
      sourcecountry: "United States",
    };
    const row = mapGdeltDocArticleToArticleRow(raw, fetchedAt)!;
    expect(row.publisher_name).toBeNull();
    expect(row.publisher_domain).toBe("obscure-outlet.example");
  });

  it("returns null for an article with an empty title rather than storing a blank headline", () => {
    const row = mapGdeltDocArticleToArticleRow(articles[1] as RawGdeltDocArticle, fetchedAt);
    expect(row).toBeNull();
  });

  it("does not populate country_iso from sourcecountry (a country name, not an ISO code — see doc comment)", () => {
    const row = mapGdeltDocArticleToArticleRow(articles[0] as RawGdeltDocArticle, fetchedAt)!;
    expect(row.country_iso).toBeNull();
  });
});

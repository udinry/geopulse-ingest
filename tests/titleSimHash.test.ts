import { describe, expect, it } from "vitest";
import { hammingDistance, normalizeTitle, titleSimHash } from "../src/dedupe/titleSimHash.js";

describe("normalizeTitle", () => {
  it("lowercases, strips punctuation, and drops stopwords", () => {
    expect(normalizeTitle("The Quick Brown Fox Jumps!")).toEqual(["quick", "brown", "fox", "jumps"]);
  });

  it("strips a trailing publisher suffix", () => {
    expect(normalizeTitle("Military activity reported near Taiwan | Reuters")).toEqual(
      normalizeTitle("Military activity reported near Taiwan")
    );
  });

  it("strips a trailing em-dash publisher suffix", () => {
    expect(normalizeTitle("Oil prices jump 3% — Bloomberg")).toEqual(normalizeTitle("Oil prices jump 3%"));
  });
});

describe("titleSimHash", () => {
  it("identical titles produce identical fingerprints", () => {
    const a = titleSimHash("Military activity reported near Taiwan Strait");
    const b = titleSimHash("Military activity reported near Taiwan Strait");
    expect(a).toBe(b);
  });

  it("the same story from two publishers lands within the dedup threshold", () => {
    const a = titleSimHash("Military activity reported near Taiwan Strait | Reuters");
    const b = titleSimHash("Military activity reported near the Taiwan Strait — AP");
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(3);
  });

  it("unrelated stories land well outside the dedup threshold", () => {
    const a = titleSimHash("Military activity reported near Taiwan Strait");
    const b = titleSimHash("Central bank holds interest rates steady amid inflation concerns");
    expect(hammingDistance(a, b)).toBeGreaterThan(3);
  });

  it("hammingDistance is zero for a value compared with itself", () => {
    const a = titleSimHash("Some headline about markets moving today");
    expect(hammingDistance(a, a)).toBe(0);
  });

  it("an empty title hashes to zero rather than throwing", () => {
    expect(titleSimHash("")).toBe(0n);
  });

  it("keeps hyphenated words intact instead of treating them as a publisher suffix", () => {
    expect(normalizeTitle("Insurers raise war-risk rates near Hormuz strait")).toEqual(["insurers", "raise", "war", "risk", "rates", "near", "hormuz", "strait"]);
    expect(normalizeTitle("Iran-backed rebels attack port")).toEqual(["iran", "backed", "rebels", "attack", "port"]);
    expect(normalizeTitle("Rebels attack port - Reuters")).toEqual(["rebels", "attack", "port"]);
  });
});

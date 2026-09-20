import { describe, expect, it } from "vitest";
import { fipsToIsoAlpha2 } from "../src/normalize/countryCodes.js";

describe("fipsToIsoAlpha2", () => {
  it("converts known FIPS/ISO divergences correctly (not just coincidental matches)", () => {
    expect(fipsToIsoAlpha2("TU")).toBe("TR"); // Turkey
    expect(fipsToIsoAlpha2("GM")).toBe("DE"); // Germany
    expect(fipsToIsoAlpha2("SP")).toBe("ES"); // Spain
    expect(fipsToIsoAlpha2("CH")).toBe("CN"); // China — NOT Switzerland
    expect(fipsToIsoAlpha2("IS")).toBe("IL"); // Israel — NOT Iceland
    expect(fipsToIsoAlpha2("AU")).toBe("AT"); // Austria — NOT Australia
    expect(fipsToIsoAlpha2("AS")).toBe("AU"); // Australia
    expect(fipsToIsoAlpha2("RS")).toBe("RU"); // Russia
    expect(fipsToIsoAlpha2("HO")).toBe("HN"); // Honduras
    expect(fipsToIsoAlpha2("NI")).toBe("NG"); // Nigeria
    expect(fipsToIsoAlpha2("BG")).toBe("BD"); // Bangladesh
  });

  it("handles codes that happen to be identical between FIPS and ISO", () => {
    expect(fipsToIsoAlpha2("US")).toBe("US");
    expect(fipsToIsoAlpha2("IN")).toBe("IN");
    expect(fipsToIsoAlpha2("BR")).toBe("BR");
  });

  it("is case-insensitive", () => {
    expect(fipsToIsoAlpha2("tu")).toBe("TR");
  });

  it("returns null for an unmapped code rather than assuming FIPS equals ISO", () => {
    expect(fipsToIsoAlpha2("ZZ")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(fipsToIsoAlpha2("")).toBeNull();
  });
});

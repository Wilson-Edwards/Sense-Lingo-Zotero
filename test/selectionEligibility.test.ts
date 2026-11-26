import { describe, expect, it } from "vitest";

import { isEligibleWordSelection } from "../src/modules/reader/selectionEligibility";

describe("isEligibleWordSelection", () => {
  it("rejects punctuation-only selections", () => {
    expect(isEligibleWordSelection(",", "zh-CN")).toBe(false);
    expect(isEligibleWordSelection("—", "zh-CN")).toBe(false);
  });

  it("rejects selections already in the target language", () => {
    expect(isEligibleWordSelection("理想", "zh-CN")).toBe(false);
    expect(isEligibleWordSelection("translation", "en-US")).toBe(false);
  });

  it("keeps source-language and mixed-script selections", () => {
    expect(isEligibleWordSelection("Retailers", "zh-CN")).toBe(true);
    expect(isEligibleWordSelection("PostgreSQL中文", "zh-CN")).toBe(true);
  });

  it("only applies the punctuation rule for an unknown target locale", () => {
    expect(isEligibleWordSelection("source", "und")).toBe(true);
  });
});

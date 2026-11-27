import { describe, expect, it } from "vitest";

import { NUMERIC_PREF_SCHEMA, normalizeNumberPref } from "../src/utils/prefs";

describe("numeric preference schema", () => {
  it("uses defaults for invalid values", () => {
    expect(normalizeNumberPref("maxTokens", "nope")).toBe(
      NUMERIC_PREF_SCHEMA.maxTokens.defaultValue,
    );
  });

  it("clamps values at runtime", () => {
    expect(normalizeNumberPref("prefetchConcurrency", 99)).toBe(8);
    expect(normalizeNumberPref("prefetchDelayMs", -10)).toBe(0);
    expect(normalizeNumberPref("requestTimeoutMs", 1)).toBe(1000);
  });
});

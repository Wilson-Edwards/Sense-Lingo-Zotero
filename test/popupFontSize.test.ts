import { describe, expect, it } from "vitest";

import {
  POPUP_FONT_SIZE_DEFAULT,
  POPUP_FONT_SIZE_MAX,
  POPUP_FONT_SIZE_MIN,
  POPUP_WIDTH_AT_DEFAULT_FONT,
  normalizePopupFontSize,
  popupMaxWidth,
} from "../src/modules/reader/popupFontSize";

describe("normalizePopupFontSize", () => {
  it("keeps values inside the supported range", () => {
    expect(normalizePopupFontSize(14)).toBe(14);
    expect(normalizePopupFontSize(POPUP_FONT_SIZE_MIN)).toBe(
      POPUP_FONT_SIZE_MIN,
    );
    expect(normalizePopupFontSize(POPUP_FONT_SIZE_MAX)).toBe(
      POPUP_FONT_SIZE_MAX,
    );
  });

  it("clamps values outside the supported range", () => {
    expect(normalizePopupFontSize(1)).toBe(POPUP_FONT_SIZE_MIN);
    expect(normalizePopupFontSize(200)).toBe(POPUP_FONT_SIZE_MAX);
  });

  it("uses the default for zero", () => {
    expect(normalizePopupFontSize(0)).toBe(POPUP_FONT_SIZE_DEFAULT);
  });

  it("rounds fractional values", () => {
    expect(normalizePopupFontSize(15.4)).toBe(15);
    expect(normalizePopupFontSize(15.6)).toBe(16);
  });

  it("reads numeric strings from prefs", () => {
    expect(normalizePopupFontSize("18")).toBe(18);
  });

  it("falls back to the default for invalid input", () => {
    expect(normalizePopupFontSize(undefined)).toBe(POPUP_FONT_SIZE_DEFAULT);
    expect(normalizePopupFontSize(null)).toBe(POPUP_FONT_SIZE_DEFAULT);
    expect(normalizePopupFontSize("")).toBe(POPUP_FONT_SIZE_DEFAULT);
    expect(normalizePopupFontSize("large")).toBe(POPUP_FONT_SIZE_DEFAULT);
    expect(normalizePopupFontSize(Number.NaN)).toBe(POPUP_FONT_SIZE_DEFAULT);
  });
});

describe("popupMaxWidth", () => {
  it("uses the historical width at the default font size", () => {
    expect(popupMaxWidth(POPUP_FONT_SIZE_DEFAULT)).toBe(
      POPUP_WIDTH_AT_DEFAULT_FONT,
    );
  });

  it("grows and shrinks with the font size", () => {
    expect(popupMaxWidth(24)).toBeGreaterThan(POPUP_WIDTH_AT_DEFAULT_FONT);
    expect(popupMaxWidth(POPUP_FONT_SIZE_MIN)).toBeLessThan(
      POPUP_WIDTH_AT_DEFAULT_FONT,
    );
  });

  it("normalises the font size first", () => {
    expect(popupMaxWidth(200)).toBe(popupMaxWidth(POPUP_FONT_SIZE_MAX));
    expect(popupMaxWidth(1)).toBe(popupMaxWidth(POPUP_FONT_SIZE_MIN));
  });
});

/**
 * Font size for the translation rendered inside the selection popup.
 *
 * The value is stored in prefs, so it can be hand-edited or left over from an
 * older version. Clamp it in one place instead of trusting the settings pane's
 * `min`/`max` attributes, and use the same helper when writing the pref back so
 * the pane and the popup can never disagree.
 */

/** Smallest legible size; below this the popup text is hard to read. */
export const POPUP_FONT_SIZE_MIN = 8;

/** Largest size that still fits a useful amount of text in the popup. */
export const POPUP_FONT_SIZE_MAX = 32;

/** Matches the popup's historical 12px default. */
export const POPUP_FONT_SIZE_DEFAULT = 12;

/** Popup content width that pairs with `POPUP_FONT_SIZE_DEFAULT`. */
export const POPUP_WIDTH_AT_DEFAULT_FONT = 320;

/** Clamp a stored/typed value to the supported range, rounding to whole px. */
export function normalizePopupFontSize(value: unknown): number {
  // An empty input means "not set", not "zero".
  if (value === "" || value === null || value === undefined) {
    return POPUP_FONT_SIZE_DEFAULT;
  }
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) {
    return POPUP_FONT_SIZE_DEFAULT;
  }
  const rounded = Math.round(size);
  return Math.min(POPUP_FONT_SIZE_MAX, Math.max(POPUP_FONT_SIZE_MIN, rounded));
}

/**
 * Width that keeps roughly the same number of characters per line as the
 * default setting, so a larger font does not wrap every other word.
 */
export function popupMaxWidth(fontSize: number): number {
  const size = normalizePopupFontSize(fontSize);
  return Math.round(
    (size / POPUP_FONT_SIZE_DEFAULT) * POPUP_WIDTH_AT_DEFAULT_FONT,
  );
}

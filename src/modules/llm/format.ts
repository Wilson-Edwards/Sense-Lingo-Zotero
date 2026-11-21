/**
 * Deterministic formatting for word translations.
 *
 * The default word prompt asks for three lines (meaning, US IPA, UK IPA), but
 * models occasionally join them. The popup and the result panel render plain
 * text with preserved newlines, so normalise the labels here instead of
 * trusting the model to be consistent.
 */

const PHONETIC_LABEL_RE = /\s*(美式音标|英式音标)\s*[：:]\s*/g;

/** Put each phonetic label on its own line and trim the result. */
export function normalizeWordTranslation(raw: string): string {
  const text = (raw ?? "").replace(/\r\n?/g, "\n");
  const withLines = text.replace(
    PHONETIC_LABEL_RE,
    (_match, label: string) => `\n${label}：`,
  );
  // A label at the very beginning would otherwise leave a blank first line.
  return withLines.replace(/^\n+/, "").trim();
}

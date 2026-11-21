/**
 * Guard for the optional "translate as soon as text is selected" setting.
 *
 * `renderTextSelectionPopup` can fire more than once for a single selection
 * (annotation creation, layout re-render, EPUB section switches). Without a
 * guard the same text would be sent to the model repeatedly and the panel would
 * flicker between requests.
 */

/** Re-renders of one popup happen within a few hundred ms. */
export const AUTO_TRANSLATE_DEDUP_MS = 2000;

interface AutoTranslateRecord {
  text: string;
  at: number;
}

const lastAutoTranslations = new WeakMap<Document, AutoTranslateRecord>();

/**
 * Record `text` as auto-translated and report whether this is a new selection.
 *
 * `now` is injectable so the timing rule can be unit tested without fake timers.
 */
export function shouldStartAutoTranslate(
  doc: Document,
  text: string,
  now: number = Date.now(),
): boolean {
  const previous = lastAutoTranslations.get(doc);
  if (
    previous &&
    previous.text === text &&
    now - previous.at < AUTO_TRANSLATE_DEDUP_MS
  ) {
    return false;
  }
  lastAutoTranslations.set(doc, { text, at: now });
  return true;
}

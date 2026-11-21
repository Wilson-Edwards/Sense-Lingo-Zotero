/**
 * Share one translation request between re-renders of a selection popup.
 *
 * Zotero can render the selection popup more than once for the same selection
 * (annotation creation, layout re-render, EPUB section switches) and every
 * render produces a fresh DOM node. Returning the same promise instead of just
 * suppressing the second request means the request is still made once, every
 * popup gets the result, and a short-lived cache makes re-selecting the same
 * text instant.
 */

import type { InlineTranslation } from "../controller";

/** Reuse a successful result when the popup re-renders for the same text. */
export const POPUP_RESULT_TTL_MS = 60_000;

interface PopupTranslationEntry {
  text: string;
  promise: Promise<InlineTranslation>;
  at: number;
}

const entries = new WeakMap<Document, PopupTranslationEntry>();

/**
 * Run (or reuse) the translation for `text` in `doc`.
 *
 * `now` is injectable so the cache window can be unit tested without timers.
 */
export function translateInPopup(
  doc: Document,
  text: string,
  request: () => Promise<InlineTranslation>,
  now: number = Date.now(),
): Promise<InlineTranslation> {
  const cached = peekPopupTranslation(doc, text, now);
  if (cached) {
    return cached;
  }

  const promise = request().then((result) => {
    // Failures are not worth reusing: a later popup should retry.
    if (!result.ok && entries.get(doc)?.promise === promise) {
      entries.delete(doc);
    }
    return result;
  });
  entries.set(doc, { text, promise, at: now });
  return promise;
}

/**
 * Return the in-flight or recently finished translation for `text`, if any.
 * Used when the popup re-renders so an already visible result stays visible.
 */
export function peekPopupTranslation(
  doc: Document,
  text: string,
  now: number = Date.now(),
): Promise<InlineTranslation> | undefined {
  const cached = entries.get(doc);
  if (
    !cached ||
    cached.text !== text ||
    now - cached.at >= POPUP_RESULT_TTL_MS
  ) {
    return undefined;
  }
  return cached.promise;
}

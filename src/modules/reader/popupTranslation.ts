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
export const POPUP_RESULT_MAX_ENTRIES = 20;

interface PopupTranslationEntry {
  text: string;
  promise: Promise<InlineTranslation>;
  at: number;
}

const entries = new WeakMap<Document, Map<string, PopupTranslationEntry>>();

function entriesFor(doc: Document): Map<string, PopupTranslationEntry> {
  let map = entries.get(doc);
  if (!map) {
    map = new Map();
    entries.set(doc, map);
  }
  return map;
}

function pruneEntries(
  map: Map<string, PopupTranslationEntry>,
  now: number,
): void {
  for (const [key, entry] of map) {
    if (now - entry.at >= POPUP_RESULT_TTL_MS) {
      map.delete(key);
    }
  }
  while (map.size > POPUP_RESULT_MAX_ENTRIES) {
    const oldest = map.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    map.delete(oldest);
  }
}

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

  return storePopupTranslation(doc, text, request, now);
}

/**
 * Replace an in-flight or recently completed popup result with a new request.
 * The refresh button uses this to bypass the popup's short-lived UI cache.
 */
export function refreshPopupTranslation(
  doc: Document,
  text: string,
  request: () => Promise<InlineTranslation>,
  now: number = Date.now(),
): Promise<InlineTranslation> {
  return storePopupTranslation(doc, text, request, now);
}

function storePopupTranslation(
  doc: Document,
  text: string,
  request: () => Promise<InlineTranslation>,
  now: number,
): Promise<InlineTranslation> {
  const map = entriesFor(doc);
  pruneEntries(map, now);
  const promise = request().then((result) => {
    // Failures are not worth reusing: a later popup should retry.
    if (!result.ok && map.get(text)?.promise === promise) {
      map.delete(text);
    }
    return result;
  });
  // Reinsert to make Map order an LRU order for the entry cap.
  map.delete(text);
  map.set(text, { text, promise, at: now });
  pruneEntries(map, now);
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
  const map = entries.get(doc);
  const cached = map?.get(text);
  if (!cached || now - cached.at >= POPUP_RESULT_TTL_MS) {
    if (cached) {
      map?.delete(text);
    }
    return undefined;
  }
  map?.delete(text);
  map?.set(text, cached);
  return cached.promise;
}

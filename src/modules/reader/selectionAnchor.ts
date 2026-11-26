/**
 * Captures what the user actually selected, straight from the DOM range.
 *
 * Two things are extracted before the selection disappears (clicking a popup
 * button can collapse it):
 * - `contexts`: text of the ancestor blocks, most local first. This is the
 *   ground truth for "which paragraph was the user looking at".
 * - `fingerprint`: ~40 chars on each side of the selection. Even when we have to
 *   fall back to a whole book, this tells us which occurrence is the right one.
 */

import type { SentenceFingerprint } from "./sentence";
import { sourceTextOfElement } from "./embeddedTranslation";

export interface SelectionAnchor {
  contexts: string[];
  fingerprint?: SentenceFingerprint;
}

const MIN_CONTEXT_LENGTH = 8;
const MAX_CONTEXT_LENGTH = 20000;
const MAX_ANCESTORS = 8;
const FINGERPRINT_CHARS = 40;
const CONTEXT_TAGS = new Set([
  "article",
  "blockquote",
  "dd",
  "div",
  "dt",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
  "section",
  "td",
  "th",
]);

function textOf(element: Element): string {
  return sourceTextOfElement(element);
}

function containingElement(range: Range): Element | null {
  const node = range.startContainer;
  let element: Element | null =
    node.nodeType === 1 ? (node as Element) : node.parentElement;
  while (element && !element.contains(range.endContainer)) {
    element = element.parentElement;
  }
  while (
    element &&
    !CONTEXT_TAGS.has(element.tagName.toLowerCase()) &&
    element.parentElement
  ) {
    element = element.parentElement;
  }
  return element;
}

function fingerprintFromRange(range: Range): SentenceFingerprint | undefined {
  const scope = containingElement(range);
  if (!scope) {
    return undefined;
  }
  try {
    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(scope);
    beforeRange.setEnd(range.startContainer, range.startOffset);

    const afterRange = range.cloneRange();
    afterRange.selectNodeContents(scope);
    afterRange.setStart(range.endContainer, range.endOffset);

    const before = beforeRange.toString();
    const after = afterRange.toString();
    if (!before && !after) {
      return undefined;
    }
    return {
      before: before.slice(-FINGERPRINT_CHARS),
      after: after.slice(0, FINGERPRINT_CHARS),
    };
  } catch {
    return undefined;
  }
}

/** Read anchor data from a captured range before the popup collapses it. */
export function readSelectionAnchorFromRange(range: Range): SelectionAnchor {
  const anchor: SelectionAnchor = { contexts: [] };
  try {
    anchor.fingerprint = fingerprintFromRange(range);

    const startNode = range.startContainer;
    let element: Element | null =
      startNode.nodeType === 1
        ? (startNode as Element)
        : startNode.parentElement;

    const seen = new Set<string>();
    for (let depth = 0; element && depth < MAX_ANCESTORS; depth += 1) {
      const tag = element.tagName.toLowerCase();
      if (tag === "body" || tag === "html") {
        break;
      }
      const text = textOf(element);
      if (
        CONTEXT_TAGS.has(tag) &&
        text.length >= MIN_CONTEXT_LENGTH &&
        text.length <= MAX_CONTEXT_LENGTH &&
        !seen.has(text)
      ) {
        seen.add(text);
        anchor.contexts.push(text);
      }
      element = element.parentElement;
    }
    // Most local block first.
    anchor.contexts.sort((a, b) => a.length - b.length);
  } catch {
    // A missing/locked selection is not an error worth reporting.
  }
  return anchor;
}

/** Read the anchor data from one document's current selection. */
export function readSelectionAnchor(doc: Document): SelectionAnchor {
  try {
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return { contexts: [] };
    }
    return readSelectionAnchorFromRange(selection.getRangeAt(0));
  } catch {
    return { contexts: [] };
  }
}

function comparableText(text: string): string {
  return text
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isWordCharacter(char: string | undefined): boolean {
  return !!char && /[\p{L}\p{N}_]/u.test(char);
}

/**
 * Prefer the live DOM selection when Zotero's annotation text has appended an
 * adjacent visual line. The containment must end on word boundaries so a stale
 * partial selection such as `Effect` cannot shorten `Effectiveness`.
 */
export function preferLiveSelectionText(
  annotationText: string,
  liveText: string,
): string {
  const annotation = comparableText(annotationText);
  const live = comparableText(liveText);
  if (!live || !annotation || live === annotation) {
    return live === annotation && live ? liveText.trim() : annotationText;
  }

  let from = 0;
  while (from <= annotation.length - live.length) {
    const index = annotation.indexOf(live, from);
    if (index < 0) {
      break;
    }
    const before = annotation[index - 1];
    const after = annotation[index + live.length];
    if (!isWordCharacter(before) && !isWordCharacter(after)) {
      return liveText.trim();
    }
    from = index + 1;
  }
  return annotationText;
}

/**
 * Find the nested reader document that owns the real selection. EPUB selection
 * lives in a section document while the popup event points at the outer reader
 * document, so reading only `event.doc.getSelection()` loses the location.
 */
export function readBestSelectionAnchor(
  docs: Document[],
  expectedText: string,
): SelectionAnchor {
  const expected = comparableText(expectedText);
  let fallback: SelectionAnchor | null = null;
  const visited = new Set<Document>();
  for (const doc of docs) {
    if (visited.has(doc)) {
      continue;
    }
    visited.add(doc);
    try {
      const selection = doc.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        continue;
      }
      const selected = comparableText(selection.toString());
      if (!selected) {
        continue;
      }
      const anchor = readSelectionAnchorFromRange(selection.getRangeAt(0));
      if (selected === expected) {
        return anchor;
      }
      if (
        !fallback &&
        (selected.includes(expected) || expected.includes(selected))
      ) {
        fallback = anchor;
      }
    } catch {
      // A frame can disappear while the popup is being built; try the next one.
    }
  }
  return fallback ?? { contexts: [] };
}

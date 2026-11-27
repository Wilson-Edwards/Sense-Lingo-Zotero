/**
 * Make reader multi-click selection more useful for translation:
 * - double click: word (the browser default)
 * - triple click: sentence
 * - quadruple click: paragraph
 *
 * Firefox already knows how to select the visual paragraph on the third click.
 * We keep that native range, shrink it to the sentence under the pointer, and
 * restore the saved native range if a fourth click follows. This is more robust
 * than trying to infer PDF/EPUB paragraph boundaries from their very different
 * DOM structures.
 */

import { config } from "../../../package.json";
import { warn } from "../../utils/logger";
import { collectReaderDocuments } from "./readerText";
import { isSentenceBoundary, SENTENCE_TERMINATORS } from "./sentence";

const CLOSING_PUNCTUATION = `"'’”»)]}〉》」』】`;

export interface SentenceSelectionOffsets {
  start: number;
  end: number;
}

/** Return the sentence containing `clickOffset` (end is exclusive). */
export function sentenceSelectionOffsets(
  text: string,
  clickOffset: number,
): SentenceSelectionOffsets | null {
  if (!text) {
    return null;
  }

  let anchor = Math.max(0, Math.min(Math.trunc(clickOffset), text.length - 1));
  if (/\s/.test(text[anchor])) {
    let next = anchor;
    while (next < text.length && /\s/.test(text[next])) {
      next += 1;
    }
    if (next < text.length) {
      anchor = next;
    } else {
      while (anchor > 0 && /\s/.test(text[anchor])) {
        anchor -= 1;
      }
    }
  }

  let start = 0;
  for (let i = anchor - 1; i >= 0; i -= 1) {
    if (isSentenceBoundary(text, i)) {
      start = i + 1;
      break;
    }
  }
  while (
    start > 0 &&
    start < text.length &&
    CLOSING_PUNCTUATION.includes(text[start])
  ) {
    start += 1;
  }
  while (start < text.length && /\s/.test(text[start])) {
    start += 1;
  }

  let end = text.length;
  for (let i = anchor; i < text.length; i += 1) {
    if (isSentenceBoundary(text, i)) {
      end = i + 1;
      // Keep punctuation clusters and closing quotes/brackets with the sentence.
      while (
        end < text.length &&
        (SENTENCE_TERMINATORS.includes(text[end]) ||
          CLOSING_PUNCTUATION.includes(text[end]))
      ) {
        end += 1;
      }
      break;
    }
  }
  while (end > start && /\s/.test(text[end - 1])) {
    end -= 1;
  }

  return start < end ? { start, end } : null;
}

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

interface DomPoint {
  node: Node;
  offset: number;
}

interface ClickState {
  caret: Range | null;
  paragraph: Range | null;
  previousRange: Range | null;
  pendingSelectionChange?: EventListener;
}

const states = new WeakMap<Document, ClickState>();
const attachedDocs = new WeakMap<
  Document,
  { mousedown: EventListener; mouseup: EventListener }
>();
const watchedDocs = new WeakSet<Document>();
const attachedFrames = new WeakSet<HTMLIFrameElement>();
const documentCleanups = new WeakMap<Document, () => void>();
const frameCleanups = new WeakMap<HTMLIFrameElement, () => void>();
/** Only live documents are strong; pagehide/removal deletes their disposer. */
const activeDocumentCleanups = new Set<() => void>();

function caretRangeFromPoint(
  doc: Document,
  x: number,
  y: number,
): Range | null {
  try {
    const position = doc.caretPositionFromPoint?.(x, y);
    if (position?.offsetNode) {
      const range = doc.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    }

    const legacy = (
      doc as Document & {
        caretRangeFromPoint?: (
          clientX: number,
          clientY: number,
        ) => Range | null;
      }
    ).caretRangeFromPoint?.(x, y);
    return legacy?.cloneRange() ?? null;
  } catch {
    return null;
  }
}

function ignoredTarget(target: EventTarget | null): boolean {
  const node = target as Node | null;
  const element =
    node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
  return !!element?.closest(
    ".selection-popup,input,textarea,select,button,[contenteditable='true']",
  );
}

function textSegments(range: Range): TextSegment[] {
  const root =
    range.commonAncestorContainer.nodeType === 3
      ? range.commonAncestorContainer.parentNode
      : range.commonAncestorContainer;
  if (!root) {
    return [];
  }

  const segments: TextSegment[] = [];
  const walker = range.startContainer.ownerDocument?.createTreeWalker(root, 4);
  if (!walker) {
    return segments;
  }

  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    if (range.intersectsNode(node)) {
      let start = 0;
      let end = node.data.length;
      if (node === range.startContainer) {
        start = range.startOffset;
      }
      if (node === range.endContainer) {
        end = range.endOffset;
      }
      if (start < end) {
        segments.push({ node, start, end });
      }
    }
    current = walker.nextNode();
  }
  return segments;
}

function pointAtOffset(
  segments: TextSegment[],
  targetOffset: number,
): DomPoint | null {
  let consumed = 0;
  for (const segment of segments) {
    const length = segment.end - segment.start;
    if (targetOffset <= consumed + length) {
      return {
        node: segment.node,
        offset: segment.start + Math.max(0, targetOffset - consumed),
      };
    }
    consumed += length;
  }
  const last = segments.at(-1);
  return last ? { node: last.node, offset: last.end } : null;
}

function clickOffsetInRange(paragraph: Range, caret: Range | null): number {
  if (!caret) {
    return Math.floor(paragraph.toString().length / 2);
  }
  try {
    if (paragraph.comparePoint(caret.startContainer, caret.startOffset) !== 0) {
      return Math.floor(paragraph.toString().length / 2);
    }
    const prefix = paragraph.cloneRange();
    prefix.setEnd(caret.startContainer, caret.startOffset);
    return prefix.toString().length;
  } catch {
    return Math.floor(paragraph.toString().length / 2);
  }
}

function selectRange(doc: Document, range: Range): boolean {
  try {
    const selection = doc.getSelection();
    if (!selection) {
      return false;
    }
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function sameRange(left: Range | null, right: Range): boolean {
  if (!left) {
    return false;
  }
  try {
    return (
      left.compareBoundaryPoints(0, right) === 0 &&
      left.compareBoundaryPoints(2, right) === 0
    );
  } catch {
    return false;
  }
}

function shrinkNativeParagraphToSentence(
  doc: Document,
  allowUnchanged = false,
): boolean {
  const state = states.get(doc);
  const selection = doc.getSelection();
  if (
    !state ||
    !selection ||
    selection.rangeCount === 0 ||
    selection.isCollapsed
  ) {
    return false;
  }

  const paragraph = selection.getRangeAt(0).cloneRange();
  // A selectionchange can be queued from the preceding double click. Wait for
  // Firefox to replace that word range with its native triple-click range.
  if (!allowUnchanged && sameRange(state.previousRange, paragraph)) {
    return false;
  }
  const segments = textSegments(paragraph);
  const text = segments
    .map((segment) => segment.node.data.slice(segment.start, segment.end))
    .join("");
  if (!text.trim()) {
    return false;
  }

  const offsets = sentenceSelectionOffsets(
    text,
    clickOffsetInRange(paragraph, state.caret),
  );
  if (!offsets) {
    return false;
  }
  const start = pointAtOffset(segments, offsets.start);
  const end = pointAtOffset(segments, offsets.end);
  if (!start || !end) {
    return false;
  }

  const sentence = doc.createRange();
  sentence.setStart(start.node, start.offset);
  sentence.setEnd(end.node, end.offset);
  state.paragraph = paragraph;
  return selectRange(doc, sentence);
}

function removePendingSelectionChange(doc: Document): void {
  const state = states.get(doc);
  if (state?.pendingSelectionChange) {
    doc.removeEventListener(
      "selectionchange",
      state.pendingSelectionChange,
      true,
    );
    delete state.pendingSelectionChange;
  }
}

function onMouseDown(doc: Document, event: MouseEvent): void {
  removePendingSelectionChange(doc);
  if (event.button !== 0 || ignoredTarget(event.target)) {
    states.delete(doc);
    return;
  }

  if (event.detail === 3) {
    const selection = doc.getSelection();
    const state: ClickState = {
      caret: caretRangeFromPoint(doc, event.clientX, event.clientY),
      paragraph: null,
      previousRange:
        selection && selection.rangeCount > 0
          ? selection.getRangeAt(0).cloneRange()
          : null,
    };
    const onSelectionChange: EventListener = () => {
      if (shrinkNativeParagraphToSentence(doc)) {
        removePendingSelectionChange(doc);
      }
    };
    state.pendingSelectionChange = onSelectionChange;
    states.set(doc, state);
    // Native paragraph selection happens as the mousedown default action.
    // selectionchange runs before Zotero consumes the selection on mouseup.
    doc.addEventListener("selectionchange", onSelectionChange, true);
    return;
  }

  if (event.detail === 4) {
    const paragraph = states.get(doc)?.paragraph;
    if (paragraph && selectRange(doc, paragraph.cloneRange())) {
      // Prevent Firefox's fourth-click default from replacing our saved native
      // paragraph with a platform-dependent range.
      event.preventDefault();
    }
    return;
  }

  states.delete(doc);
}

function onMouseUp(doc: Document, event: MouseEvent): void {
  if (event.button !== 0) {
    return;
  }
  if (event.detail === 3) {
    // Fallback for builds that dispatch selectionchange later than mouseup.
    shrinkNativeParagraphToSentence(doc, true);
    removePendingSelectionChange(doc);
  } else if (event.detail === 4) {
    const paragraph = states.get(doc)?.paragraph;
    if (paragraph) {
      selectRange(doc, paragraph.cloneRange());
    }
  }
}

/** Attach the multi-click behaviour to a concrete reader content document. */
export function attachMultiClickSelectionToDoc(doc: Document): void {
  if (attachedDocs.has(doc)) {
    return;
  }
  const mousedown: EventListener = (event) =>
    onMouseDown(doc, event as MouseEvent);
  const mouseup: EventListener = (event) => onMouseUp(doc, event as MouseEvent);
  attachedDocs.set(doc, { mousedown, mouseup });
  doc.addEventListener("mousedown", mousedown, true);
  doc.addEventListener("mouseup", mouseup, true);
}

function attachFrame(frame: HTMLIFrameElement): void {
  if (attachedFrames.has(frame)) {
    return;
  }
  attachedFrames.add(frame);
  try {
    if (frame.contentDocument) {
      watchDocument(frame.contentDocument);
    }
  } catch {
    // Cross-origin frames are not reader content and cannot be modified.
  }
  const onLoad = (): void => {
    try {
      if (frame.contentDocument) {
        watchDocument(frame.contentDocument);
      }
    } catch {
      // Ignore a frame that became cross-origin while loading.
    }
  };
  frame.addEventListener("load", onLoad);
  const cleanup = (): void => {
    frame.removeEventListener("load", onLoad);
    try {
      if (frame.contentDocument) {
        disposeDocument(frame.contentDocument);
      }
    } catch {
      // Cross-origin frames have no accessible document to release.
    }
    frameCleanups.delete(frame);
    attachedFrames.delete(frame);
  };
  frameCleanups.set(frame, cleanup);
}

function detachFramesIn(node: Node): void {
  if (node.nodeType !== 1) {
    return;
  }
  const element = node as Element;
  if (element.matches("iframe, frame")) {
    frameCleanups.get(element as HTMLIFrameElement)?.();
  }
  for (const frame of Array.from(element.querySelectorAll("iframe, frame"))) {
    frameCleanups.get(frame as HTMLIFrameElement)?.();
  }
}

function disposeDocument(doc: Document): void {
  documentCleanups.get(doc)?.();
}

function watchDocument(doc: Document): void {
  if (watchedDocs.has(doc)) {
    return;
  }
  watchedDocs.add(doc);
  attachMultiClickSelectionToDoc(doc);
  for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
    attachFrame(frame as HTMLIFrameElement);
  }

  const root = doc.documentElement;
  const MutationObserverClass = doc.defaultView?.MutationObserver;
  let observer: MutationObserver | null = null;
  if (root && MutationObserverClass) {
    observer = new MutationObserverClass((mutations) => {
      for (const mutation of mutations) {
        for (const removed of Array.from(mutation.removedNodes)) {
          if (removed) {
            detachFramesIn(removed);
          }
        }
        for (const added of Array.from(mutation.addedNodes)) {
          if (!added || added.nodeType !== 1) {
            continue;
          }
          const element = added as Element;
          if (element.matches("iframe, frame")) {
            attachFrame(element as HTMLIFrameElement);
          }
          for (const frame of Array.from(
            element.querySelectorAll("iframe, frame"),
          )) {
            attachFrame(frame as HTMLIFrameElement);
          }
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }
  const onPageHide = (): void => disposeDocument(doc);
  doc.defaultView?.addEventListener("pagehide", onPageHide, { once: true });
  const cleanup = (): void => {
    observer?.disconnect();
    doc.defaultView?.removeEventListener("pagehide", onPageHide);
    removePendingSelectionChange(doc);
    const listeners = attachedDocs.get(doc);
    if (listeners) {
      doc.removeEventListener("mousedown", listeners.mousedown, true);
      doc.removeEventListener("mouseup", listeners.mouseup, true);
      attachedDocs.delete(doc);
    }
    for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
      frameCleanups.get(frame as HTMLIFrameElement)?.();
    }
    states.delete(doc);
    watchedDocs.delete(doc);
    documentCleanups.delete(doc);
    activeDocumentCleanups.delete(cleanup);
  };
  documentCleanups.set(doc, cleanup);
  activeDocumentCleanups.add(cleanup);
}

interface RenderReaderEvent {
  doc?: Document;
  reader?: { _iframeWindow?: { document?: Document } };
}

function attachEventDocuments(event: RenderReaderEvent): void {
  const roots = [event.doc, event.reader?._iframeWindow?.document].filter(
    (doc): doc is Document => !!doc,
  );
  for (const root of roots) {
    for (const doc of collectReaderDocuments(root)) {
      watchDocument(doc);
    }
  }
}

/** Register before selection popups are rendered so the very first triple click works. */
export function registerMultiClickSelection(): () => void {
  const reader = Zotero.Reader as typeof Zotero.Reader & {
    registerEventListener?: (
      type: string,
      handler: (event: RenderReaderEvent) => void,
      pluginID?: string,
    ) => void;
    unregisterEventListener?: (
      type: string,
      handler: (event: RenderReaderEvent) => void,
    ) => void;
  };
  const handler = (event: RenderReaderEvent): void => {
    try {
      attachEventDocuments(event);
    } catch (error) {
      warn("failed to attach multi-click selection", error);
    }
  };

  try {
    // The toolbar is rendered while each reader document is initialized, before
    // a user can select its content. Observers then follow nested PDF/EPUB
    // frames that are inserted later.
    reader.registerEventListener?.("renderToolbar", handler, config.addonID);
    for (const existing of reader._readers ?? []) {
      attachEventDocuments({
        doc: existing._iframeWindow?.document,
        reader: existing,
      });
    }
  } catch (error) {
    warn("failed to register multi-click selection", error);
  }

  return () => {
    try {
      reader.unregisterEventListener?.("renderToolbar", handler);
    } catch (error) {
      warn("failed to unregister multi-click selection", error);
    }
    for (const cleanup of [...activeDocumentCleanups]) {
      cleanup();
    }
    activeDocumentCleanups.clear();
  };
}

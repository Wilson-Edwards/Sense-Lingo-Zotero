/**
 * Render translations inside the reader's native text-selection popup.
 *
 * `Zotero.Reader.registerEventListener("renderTextSelectionPopup", ...)` is the
 * public Zotero 7 API for this; the `append` callback places our elements inside
 * the popup without touching Zotero's own markup.
 *
 * The popup shows the translation only — no floating result panel. The shortcut
 * (`shortcuts.ts`) still uses the richer panel because it has no popup to host
 * the output.
 */

import { config } from "../../../package.json";
import { getString } from "../../utils/locale";
import { warn } from "../../utils/logger";
import { getBooleanPref, getNumberPref } from "../../utils/prefs";
import {
  translateInline,
  type InlineTranslation,
  type ReaderTarget,
} from "../controller";
import { hasUsableProvider } from "../translate";
import {
  normalizePopupFontSize,
  POPUP_FONT_SIZE_DEFAULT,
  popupMaxWidth,
} from "./popupFontSize";
import { peekPopupTranslation, translateInPopup } from "./popupTranslation";
import {
  clearPartial,
  forEachLiveSlot,
  rememberPartial,
  trackSlot,
} from "./popupStream";
import { attachMultiClickSelectionToDoc } from "./multiClickSelection";
import { EMBEDDED_TRANSLATION_SELECTOR } from "./embeddedTranslation";
import { collectReaderDocuments } from "./readerText";
import {
  readBestSelectionAnchor,
  readSelectionAnchorFromRange,
  preferLiveSelectionText,
  type SelectionAnchor,
} from "./selectionAnchor";
import { attachShortcutToDoc } from "./shortcuts";
import { rememberSelection } from "./selectionState";

const BUTTON_STYLE = [
  "margin-left:6px",
  "padding:2px 8px",
  "border:1px solid #c8c8c8",
  "border-radius:4px",
  "background:#fafafa",
  "color:#222",
  "font-size:12px",
  "cursor:pointer",
].join(";");

/**
 * The native popup caps itself at 198px, which is too narrow for a sentence
 * translation. `width:max-content` keeps short words compact while `max-width`
 * wraps longer output instead of overflowing the page.
 *
 * Font size and the matching max-width come from the `popupFontSize` pref and
 * are applied in `createResultSlot()`.
 */
const RESULT_STYLE = [
  "display:none",
  "box-sizing:border-box",
  "width:max-content",
  "max-height:40vh",
  "overflow:auto",
  "white-space:pre-wrap",
  "word-break:break-word",
  // Zotero's native selection popup disables text selection for its controls.
  // Keep this `!important` so its broad popup rule cannot make the translation
  // unselectable again; the vendor forms cover the Firefox-based Zotero UI.
  "user-select:text!important",
  "-moz-user-select:text!important",
  "-webkit-user-select:text!important",
  "line-height:1.5",
  "color:#1a1a1a",
].join(";");

interface SelectionPopupEvent {
  reader?: {
    itemID?: number;
    _iframeWindow?: { document?: Document };
    _internalReader?: {
      _primaryView?: {
        toDisplayedRange?: (position: unknown) => Range | null;
      };
    };
  };
  doc: Document;
  params?: { annotation?: { text?: string; position?: unknown } };
  /** Zotero appends the given nodes into the selection popup. */
  append?: (...nodes: Array<Node | string>) => void;
}

function hasAnchor(anchor: SelectionAnchor): boolean {
  return (
    !!anchor.fingerprint?.before ||
    !!anchor.fingerprint?.after ||
    anchor.contexts.length > 0
  );
}

interface CapturedSelection {
  text: string;
  anchor: SelectionAnchor;
}

/**
 * Return only the source-language part of a range that starts outside an
 * Immersive Translate result. Some EPUBs persist those generated nodes after a
 * `<br>`, and Zotero can include the whole adjacent node when the selected word
 * ends immediately before it.
 */
function sourceTextFromRange(range: Range): string {
  const raw = range.toString().trim();
  const startNode = range.startContainer;
  const startElement =
    startNode.nodeType === 1 ? (startNode as Element) : startNode.parentElement;
  if (startElement?.closest(EMBEDDED_TRANSLATION_SELECTOR)) {
    return raw;
  }
  try {
    const fragment = range.cloneContents();
    for (const translated of fragment.querySelectorAll(
      EMBEDDED_TRANSLATION_SELECTOR,
    )) {
      translated.remove();
    }
    return fragment.textContent?.trim() || raw;
  } catch {
    return raw;
  }
}

function captureSelection(
  event: SelectionPopupEvent,
  text: string,
): CapturedSelection {
  const docs = collectReaderDocuments(event.doc);
  const readerDoc = event.reader?._iframeWindow?.document;
  if (readerDoc && readerDoc !== event.doc) {
    docs.push(...collectReaderDocuments(readerDoc));
  }
  // `renderToolbar` normally attaches this before the first selection. Also do
  // it here as a guarded fallback for Zotero builds that omit that event.
  for (const doc of docs) {
    attachMultiClickSelectionToDoc(doc);
  }

  // Zotero's annotation text can include the next visual line when the range
  // ends at a PDF/EPUB span boundary. The DOM Selection usually still contains
  // exactly what the user highlighted, so prefer that bounded substring.
  const visited = new Set<Document>();
  for (const candidateDoc of docs) {
    if (visited.has(candidateDoc)) {
      continue;
    }
    visited.add(candidateDoc);
    try {
      const selection = candidateDoc.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        continue;
      }
      const range = selection.getRangeAt(0);
      const liveText = sourceTextFromRange(range);
      const preferredText = preferLiveSelectionText(text, liveText);
      if (preferredText !== text) {
        return {
          text: preferredText,
          anchor: readSelectionAnchorFromRange(range),
        };
      }
    } catch {
      // A nested reader frame can disappear while the popup is being built.
    }
  }

  const liveAnchor = readBestSelectionAnchor(docs, text);
  if (hasAnchor(liveAnchor)) {
    return { text, anchor: liveAnchor };
  }

  // The live selection can already be collapsed on some Zotero/EPUB builds.
  // The just-created annotation still has a position that the primary view can
  // resolve back to the exact DOM Range. This is an internal, guarded fallback.
  const position = event.params?.annotation?.position;
  const toDisplayedRange =
    event.reader?._internalReader?._primaryView?.toDisplayedRange;
  if (position && typeof toDisplayedRange === "function") {
    try {
      const range = toDisplayedRange.call(
        event.reader?._internalReader?._primaryView,
        position,
      );
      if (range) {
        return {
          text: preferLiveSelectionText(text, sourceTextFromRange(range)),
          anchor: readSelectionAnchorFromRange(range),
        };
      }
    } catch {
      // Zotero internals vary by version; absence only disables this fallback.
    }
  }
  return { text, anchor: liveAnchor };
}

function createResultSlot(doc: Document, fontSize: number): HTMLDivElement {
  const slot = doc.createElement("div");
  slot.style.cssText = RESULT_STYLE;
  slot.style.fontSize = `${fontSize}px`;
  // The native popup treats interactions with its controls as a reason to
  // dismiss itself. Do not let a drag, a right-click, or a copy click on the
  // translation reach that handler. Crucially, no event is prevented here, so
  // the browser still creates a text selection and shows its normal Copy menu.
  for (const type of [
    "pointerdown",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "contextmenu",
    "selectstart",
  ]) {
    slot.addEventListener(type, (event) => event.stopPropagation());
  }
  // Widen with the font so the characters per line stay roughly stable.
  slot.style.maxWidth = `${popupMaxWidth(fontSize)}px`;

  // Two lines: a hint ("served from cache") above the translation. Keeping the
  // hint inside the slot means every re-rendered slot carries it too.
  const hint = doc.createElement("div");
  hint.className = "sl-cache-hint";
  hint.style.cssText =
    "display:none;color:#8a8a8a;font-size:11px;line-height:1.4;margin-bottom:2px;";
  const body = doc.createElement("div");
  body.className = "sl-body";
  body.style.cssText = "white-space:pre-wrap;";
  slot.append(hint, body);
  return slot;
}

function slotBody(slot: HTMLElement): HTMLElement {
  return (slot.querySelector(".sl-body") as HTMLElement | null) ?? slot;
}

function slotHint(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector(".sl-cache-hint") as HTMLElement | null;
}

function hideCacheHint(slot: HTMLElement): void {
  const hint = slotHint(slot);
  if (hint) {
    hint.style.display = "none";
    hint.textContent = "";
  }
}

function showLoading(slot: HTMLDivElement): void {
  slot.style.display = "block";
  hideCacheHint(slot);
  const body = slotBody(slot);
  body.style.color = "#666";
  body.textContent = getString("panel-loading");
}

function showInlineResult(
  slot: HTMLDivElement,
  result: InlineTranslation,
): void {
  slot.style.display = "block";
  hideCacheHint(slot);
  if (result.ok && result.fromCache) {
    const hint = slotHint(slot);
    if (hint) {
      hint.textContent = getString("popup-cache-hint");
      hint.style.display = "block";
    }
  }
  const body = slotBody(slot);
  body.style.color = result.ok ? "#1a1a1a" : "#b42318";
  body.textContent = result.ok ? result.translation : result.message;
}

/** Render a streamed chunk; the popup may close while the request is open. */
function showInlinePartial(slot: HTMLDivElement, translation: string): void {
  if (!slot.isConnected || !translation) {
    return;
  }
  slot.style.display = "block";
  hideCacheHint(slot);
  const body = slotBody(slot);
  body.style.color = "#1a1a1a";
  body.textContent = translation;
}

function onRenderTextSelectionPopup(event: SelectionPopupEvent): void {
  const doc = event.doc;
  const annotationText = event.params?.annotation?.text ?? "";
  if (!doc || !annotationText) {
    return;
  }
  const { text, anchor } = captureSelection(event, annotationText);
  rememberSelection(doc, text, anchor);
  const itemID = event.reader?.itemID;
  attachShortcutToDoc(doc, itemID);

  const fontSize = normalizePopupFontSize(
    getNumberPref("popupFontSize", POPUP_FONT_SIZE_DEFAULT),
  );
  const slot = createResultSlot(doc, fontSize);

  // The popup is a flex column capped at 198px; lift the cap so a translation
  // can use a readable width. Clamp it to the space left of the viewport edge
  // so a selection near the right margin does not push the text off-screen.
  const popup = doc.querySelector(".selection-popup") as HTMLElement | null;
  if (popup) {
    popup.style.maxWidth = "none";
    try {
      const viewportWidth = doc.documentElement.clientWidth;
      const available = viewportWidth - popup.getBoundingClientRect().left - 32;
      const preferred = popupMaxWidth(fontSize);
      slot.style.maxWidth = `${Math.max(184, Math.min(preferred, available))}px`;
    } catch {
      // Keep the CSS default when layout is not measurable yet.
    }
  }

  const target: ReaderTarget = {
    doc,
    attachmentItemID: itemID,
    reader: event.reader,
    anchor,
  };
  // The same word in another sentence needs a different contextual translation,
  // so the surrounding fingerprint is part of the cache key.
  const cacheKey = [
    text,
    anchor.fingerprint?.before ?? "",
    anchor.fingerprint?.after ?? "",
  ].join("\u0000");

  // Zotero can render the popup again for the same selection, and every render
  // builds new DOM. Register this slot so a running request keeps painting into
  // whichever slot is actually on screen.
  const replayed = trackSlot(doc, cacheKey, slot);
  if (replayed) {
    showInlinePartial(slot, replayed);
  }

  let button: HTMLButtonElement | null = null;
  let running = false;

  const apply = (promise: Promise<InlineTranslation>): void => {
    if (running) {
      return;
    }
    running = true;
    // A re-rendered popup may already show text replayed from the running
    // request; never replace it with the placeholder.
    if (!slotBody(slot).textContent) {
      showLoading(slot);
    }
    void promise
      .then((result) => {
        // Closing the popup while the request is in flight leaves nowhere to
        // render; dropping the result is the intended inline-only behaviour.
        forEachLiveSlot(doc, cacheKey, (live) =>
          showInlineResult(live, result),
        );
        // A shown translation replaces the button; a failure brings it back.
        if (button) {
          button.style.display = result.ok ? "none" : "";
        }
        if (!result.ok) {
          running = false;
        }
      })
      .catch(() => {
        const failed: InlineTranslation = {
          ok: false,
          message: getString("error-generic"),
        };
        forEachLiveSlot(doc, cacheKey, (live) =>
          showInlineResult(live, failed),
        );
        running = false;
        if (button) {
          button.style.display = "";
        }
      });
  };

  const run = (): void => {
    // An in-flight request already owns the partial text; only a genuinely new
    // request resets it.
    if (!peekPopupTranslation(doc, cacheKey)) {
      clearPartial(doc, cacheKey);
    }
    apply(
      translateInPopup(doc, cacheKey, () =>
        translateInline(target, text, (partial) => {
          rememberPartial(doc, cacheKey, partial);
          forEachLiveSlot(doc, cacheKey, (live) =>
            showInlinePartial(live, partial),
          );
        }),
      ),
    );
  };

  const autoTranslate = getBooleanPref("autoTranslate", false);
  if (!autoTranslate && getBooleanPref("showInPopup", true)) {
    button = doc.createElement("button");
    button.type = "button";
    button.textContent = getString("popup-translate");
    button.title = getString("popup-translate-title");
    button.style.cssText = BUTTON_STYLE;
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Only the translation should remain once the request starts.
      button!.style.display = "none";
      run();
    });
  }

  const cached = peekPopupTranslation(doc, cacheKey);
  if (cached) {
    // The popup re-rendered for the same selection: keep showing the result
    // (or attach to the request that is already in flight) instead of asking
    // again or dropping the text.
    apply(cached);
  } else if (autoTranslate && hasUsableProvider()) {
    // With auto translation on, a button would only be a redundant second
    // click. Stay silent while unconfigured instead of spamming errors.
    run();
  }

  const nodes: Node[] = [];
  if (button) {
    nodes.push(button);
  }
  nodes.push(slot);

  if (typeof event.append === "function") {
    event.append(...nodes);
  } else {
    // Fallback for builds without the `append` helper.
    for (const node of nodes) {
      doc.body?.appendChild(node);
    }
  }
}

/**
 * Register the popup listener.
 * @returns a function that unregisters it (no-op when the API is missing).
 */
export function registerSelectionPopup(): () => void {
  const Reader = Zotero.Reader as typeof Zotero.Reader & {
    registerEventListener?: (
      type: string,
      handler: (event: SelectionPopupEvent) => void,
      pluginID?: string,
    ) => void;
    unregisterEventListener?: (
      type: string,
      handler: (event: SelectionPopupEvent) => void,
    ) => void;
  };

  if (typeof Reader?.registerEventListener !== "function") {
    warn("Zotero.Reader.registerEventListener is unavailable");
    return () => undefined;
  }

  const handler = (event: SelectionPopupEvent) => {
    try {
      onRenderTextSelectionPopup(event);
    } catch (e) {
      warn("failed to render selection popup", e);
    }
  };

  Reader.registerEventListener(
    "renderTextSelectionPopup",
    handler,
    config.addonID,
  );

  return () => {
    try {
      Reader.unregisterEventListener?.("renderTextSelectionPopup", handler);
    } catch (e) {
      warn("failed to unregister selection popup", e);
    }
  };
}

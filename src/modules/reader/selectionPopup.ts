/**
 * Inject a "Translate" button into the reader's native text-selection popup.
 *
 * `Zotero.Reader.registerEventListener("renderTextSelectionPopup", ...)` is the
 * public Zotero 7 API for this; the `append` callback places our element inside
 * the popup without touching Zotero's own markup.
 */

import { config } from "../../../package.json";
import { getString } from "../../utils/locale";
import { warn } from "../../utils/logger";
import { getBooleanPref } from "../../utils/prefs";
import { translateAndShow } from "../controller";
import { collectReaderDocuments } from "./readerText";
import {
  readBestSelectionAnchor,
  readSelectionAnchorFromRange,
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

function captureAnchor(
  event: SelectionPopupEvent,
  text: string,
): SelectionAnchor {
  const docs = collectReaderDocuments(event.doc);
  const readerDoc = event.reader?._iframeWindow?.document;
  if (readerDoc && readerDoc !== event.doc) {
    docs.push(...collectReaderDocuments(readerDoc));
  }
  const liveAnchor = readBestSelectionAnchor(docs, text);
  if (hasAnchor(liveAnchor)) {
    return liveAnchor;
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
        return readSelectionAnchorFromRange(range);
      }
    } catch {
      // Zotero internals vary by version; absence only disables this fallback.
    }
  }
  return liveAnchor;
}

function onRenderTextSelectionPopup(event: SelectionPopupEvent): void {
  const doc = event.doc;
  const text = event.params?.annotation?.text ?? "";
  if (!doc || !text) {
    return;
  }
  const anchor = captureAnchor(event, text);
  rememberSelection(doc, text, anchor);
  const itemID = event.reader?.itemID;
  attachShortcutToDoc(doc, itemID);

  if (!getBooleanPref("showInPopup", true)) {
    return;
  }

  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = getString("popup-translate");
  button.title = getString("popup-translate-title");
  button.style.cssText = BUTTON_STYLE;
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void translateAndShow(
      { doc, attachmentItemID: itemID, reader: event.reader, anchor },
      text,
    );
  });

  if (typeof event.append === "function") {
    event.append(button);
  } else {
    // Fallback for builds without the `append` helper.
    doc.body?.appendChild(button);
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

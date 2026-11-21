/**
 * Keyboard shortcut: Ctrl/⌘ + Shift + T.
 *
 * Registered on the reader document the first time a selection popup renders
 * (that is when we first learn about the document) and on each main window.
 */

import { getBooleanPref } from "../../utils/prefs";
import { log } from "../../utils/logger";
import { translateAndShow } from "../controller";
import { getLastSelection } from "./selectionState";

const boundDocs = new WeakSet<Document>();
const boundWindows = new WeakSet<Window>();

export function matchesShortcut(event: KeyboardEvent): boolean {
  const key = (event.key || "").toLowerCase();
  return (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    !event.altKey &&
    key === "t"
  );
}

function selectionOf(doc: Document): string {
  try {
    return doc.getSelection()?.toString() ?? "";
  } catch {
    return "";
  }
}

export function attachShortcutToDoc(
  doc: Document,
  attachmentItemID?: number,
): void {
  if (boundDocs.has(doc)) {
    return;
  }
  boundDocs.add(doc);
  doc.addEventListener(
    "keydown",
    (event: KeyboardEvent) => {
      if (!getBooleanPref("shortcutEnabled", true) || !matchesShortcut(event)) {
        return;
      }
      const record = getLastSelection(doc);
      const text = record?.text || selectionOf(doc);
      if (!text) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      log("shortcut triggered in reader", text.slice(0, 40));
      void translateAndShow(
        { doc, attachmentItemID, anchor: record?.anchor },
        text,
      );
    },
    true,
  );
}

export function attachShortcutToWindow(win: Window): void {
  if (boundWindows.has(win)) {
    return;
  }
  boundWindows.add(win);
  win.addEventListener("keydown", (event: KeyboardEvent) => {
    if (!getBooleanPref("shortcutEnabled", true) || !matchesShortcut(event)) {
      return;
    }
    const text = win.getSelection()?.toString() ?? "";
    if (!text) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // Outside the reader we cannot resolve an attachment, so the translation is
    // a pure dictionary lookup with no context.
    void translateAndShow({ doc: win.document }, text);
  });
}

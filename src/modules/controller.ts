/**
 * Glue between the UI (popup / shortcut) and the translation pipeline.
 * All user-facing error messages are produced here.
 */

import { LlmError } from "./llm/client";
import {
  detectSelectionKind,
  type SelectionKind,
} from "./reader/selectionKind";
import { collectDocumentTexts } from "./reader/readerText";
import type { SelectionAnchor } from "./reader/selectionAnchor";
import { readSettings, translate } from "./translate";
import { getString } from "../utils/locale";
import { error as logError } from "../utils/logger";
import { hidePanel, showPanel, type PanelState } from "./ui/resultPanel";

export interface ReaderTarget {
  doc: Document;
  attachmentItemID?: number;
  itemTitle?: string;
  /** The reader instance, used to reach documents the popup doc does not own. */
  reader?: { _iframeWindow?: { document?: Document } };
  /** Captured at selection time; may be gone by the time we translate. */
  anchor?: SelectionAnchor;
}

/**
 * Candidate texts from the live reader, most precise first.
 *
 * 1. the blocks the user actually selected in (ground truth for the location)
 * 2. the reader document and its nested frames, longest first
 *
 * For EPUB the content lives in nested iframes (epub.js renders one per
 * section), so a single `doc.body.innerText` only yields UI chrome.
 */
export function readerTexts(target: ReaderTarget): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  const push = (texts: string[]) => {
    for (const text of texts) {
      if (!seen.has(text)) {
        seen.add(text);
        results.push(text);
      }
    }
  };

  push(target.anchor?.contexts ?? []);
  push(collectDocumentTexts(target.doc));
  const readerDoc = target.reader?._iframeWindow?.document;
  if (readerDoc && readerDoc !== target.doc) {
    push(collectDocumentTexts(readerDoc));
  }
  return results;
}

function messageForError(err: unknown): string {
  if (err instanceof LlmError) {
    switch (err.code) {
      case "NOT_CONFIGURED":
        return getString("error-no-key");
      case "TIMEOUT":
        return getString("error-timeout");
      case "NETWORK":
        return getString("error-network");
      case "PARSE":
      case "EMPTY":
        return getString("error-parse");
      case "HTTP":
        if (err.status === 401 || err.status === 403) {
          return getString("error-auth");
        }
        return getString("error-http", {
          status: String(err.status ?? ""),
          detail: err.detail ?? "",
        });
      default:
        return getString("error-generic");
    }
  }
  const message = (err as Error)?.message ?? String(err);
  if (message === "EMPTY_SELECTION") {
    return getString("error-no-selection");
  }
  return message || getString("error-generic");
}

/** Copy text to the system clipboard from the privileged context. */
export function copyToClipboard(text: string): boolean {
  try {
    const helper = (Components.classes as any)[
      "@mozilla.org/widget/clipboardhelper;1"
    ].getService(Components.interfaces.nsIClipboardHelper);
    helper.copyString(text);
    return true;
  } catch (e) {
    logError("clipboard copy failed", e);
    return false;
  }
}

/**
 * Translate `text` and render the result in the panel.
 *
 * `kindOverride` is what the panel's "switch to word / sentence" button passes;
 * `userPromptOverride` comes from the inline prompt editor.
 */
export async function translateAndShow(
  target: ReaderTarget,
  text: string,
  kindOverride?: SelectionKind,
  userPromptOverride?: string,
): Promise<void> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    showPanel(
      target.doc,
      {
        status: "error",
        kind: "word",
        errorMessage: getString("error-no-selection"),
      },
      {
        onFlipKind: () => undefined,
        onRetry: () => undefined,
        onCopy: () => undefined,
        onClose: () => hidePanel(target.doc),
      },
    );
    return;
  }

  const settings = readSettings();
  const previewKind =
    kindOverride ??
    detectSelectionKind(trimmed, {
      mode: settings.kindMode,
      maxWords: settings.wordMaxWords,
      maxChars: settings.wordMaxChars,
    });

  let currentKind: SelectionKind = previewKind;
  /** Prompt override for the *next* request only. */
  let pendingPrompt: string | undefined = userPromptOverride;

  const run = async (nextKind?: SelectionKind): Promise<void> => {
    if (nextKind) {
      currentKind = nextKind;
    }
    const promptForThisRun = pendingPrompt;
    // A manually edited prompt belongs to the run it was written for, so it is
    // consumed here instead of leaking into later word/sentence switches.
    pendingPrompt = undefined;

    const loadingState: PanelState = {
      status: "loading",
      kind: currentKind,
    };
    showPanel(target.doc, loadingState, {
      onFlipKind: (kind) => {
        pendingPrompt = undefined;
        void run(kind);
      },
      onRetry: (prompt) => {
        pendingPrompt = prompt;
        void run();
      },
      onCopy: () => undefined,
      onClose: () => hidePanel(target.doc),
    });

    try {
      const result = await translate({
        text: trimmed,
        attachmentItemID: target.attachmentItemID,
        itemTitle: target.itemTitle,
        getLocalTexts: () => readerTexts(target),
        fingerprint: target.anchor?.fingerprint,
        kindOverride: currentKind,
        userPromptOverride: promptForThisRun,
      });
      currentKind = result.kind;
      showPanel(
        target.doc,
        {
          status: "done",
          kind: result.kind,
          translation: result.translation,
          sentence: result.sentence,
          hasContext: result.hasContext,
          truncated: result.truncated,
          profileName: result.profileName,
          usedFallback: result.usedFallback,
          userPrompt: result.userPrompt,
          meta: `${result.model} · ${result.elapsedMs}ms`,
        },
        {
          onFlipKind: (kind) => {
            pendingPrompt = undefined;
            void run(kind);
          },
          onRetry: (prompt) => {
            pendingPrompt = prompt;
            void run();
          },
          onCopy: () => copyToClipboard(result.translation),
          onClose: () => hidePanel(target.doc),
        },
      );
    } catch (err) {
      logError("translate failed", err);
      showPanel(
        target.doc,
        {
          status: "error",
          kind: currentKind,
          errorMessage: messageForError(err),
        },
        {
          onFlipKind: (kind) => {
            pendingPrompt = undefined;
            void run(kind);
          },
          onRetry: (prompt) => {
            pendingPrompt = prompt;
            void run();
          },
          onCopy: () => undefined,
          onClose: () => hidePanel(target.doc),
        },
      );
    }
  };

  await run();
}

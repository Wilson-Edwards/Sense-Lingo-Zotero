/**
 * Glue between the UI (popup / shortcut) and the translation pipeline.
 * All user-facing error messages are produced here.
 */

import { LlmError } from "./llm/client";
import { activeProfileId, profileList } from "./llm/prompt";
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
  if (message === "UNSUPPORTED_WORD_SELECTION") {
    return getString("error-unsupported-selection");
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
 * Result of an inline (selection-popup) translation. The popup path shows only
 * the translation, so all UI state beyond that is reduced to an error message.
 */
export type InlineTranslation =
  | {
      ok: true;
      translation: string;
      /** The answer came from the local cache, not from the provider. */
      fromCache?: boolean;
      cachedAt?: number;
    }
  | { ok: false; message: string };

/**
 * Human-readable age of a cached entry. The panel shows "cache · 3 days ago"
 * instead of a model name, because there was no model call at all.
 */
function formatCacheAge(cachedAt?: number): string {
  const elapsed = Math.max(0, Date.now() - (cachedAt ?? Date.now()));
  const minutes = Math.max(1, Math.round(elapsed / 60_000));
  if (minutes < 60) {
    return getString("cache-age-minutes", { count: minutes });
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return getString("cache-age-hours", { count: hours });
  }
  return getString("cache-age-days", { count: Math.round(hours / 24) });
}

/**
 * Translate `text` for the reader selection popup, where nothing but the plain
 * translation is displayed. User-facing error text is produced here, so the
 * popup code stays free of error mapping. `onDelta` receives the translation
 * assembled so far while the model is still streaming.
 */
export async function translateInline(
  target: ReaderTarget,
  text: string,
  onDelta?: (partialTranslation: string) => void,
  options: { refreshCache?: boolean } = {},
): Promise<InlineTranslation> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return { ok: false, message: getString("error-no-selection") };
  }
  try {
    const result = await translate({
      text: trimmed,
      attachmentItemID: target.attachmentItemID,
      itemTitle: target.itemTitle,
      getLocalTexts: () => readerTexts(target),
      fingerprint: target.anchor?.fingerprint,
      // A popup refresh must reach the provider and replace an eligible local
      // cache entry even when automatic write-back is disabled.
      skipCache: options.refreshCache,
      forceCacheWrite: options.refreshCache,
      onDelta,
    });
    return {
      ok: true,
      translation: result.translation,
      fromCache: result.fromCache,
      cachedAt: result.cachedAt,
    };
  } catch (err) {
    logError("translate failed", err);
    return { ok: false, message: messageForError(err) };
  }
}

/**
 * Translate `text` and render the result in the panel.
 *
 * `kindOverride` is what the panel's "switch to word / sentence" button passes;
 * `userPromptOverride` comes from the inline prompt editor; `profileIdOverride`
 * is the preset the panel's template picker selected. Both overrides only apply
 * to the run they were made for.
 */
export async function translateAndShow(
  target: ReaderTarget,
  text: string,
  kindOverride?: SelectionKind,
  userPromptOverride?: string,
  profileIdOverride?: string,
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
        onSelectProfile: () => undefined,
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
  /**
   * Preset currently shown in the panel. Undefined means "use the per-kind
   * default from prefs"; the first result pins the actual id.
   */
  let currentProfileId: string | undefined = profileIdOverride;
  /** Prompt override for the *next* request only. */
  let pendingPrompt: string | undefined = userPromptOverride;
  /** Preset switch for the *next* request only. */
  let pendingProfile: string | undefined;
  /**
   * Flip / retry / preset switch can start a new request while the previous one
   * is still streaming; only the newest run is allowed to touch the panel.
   */
  let runId = 0;

  const run = async (
    nextKind?: SelectionKind,
    refresh = false,
  ): Promise<void> => {
    const runToken = ++runId;
    if (nextKind) {
      currentKind = nextKind;
      currentProfileId = undefined;
    }
    const settingsForRun = readSettings();
    const promptForThisRun = pendingPrompt;
    const profileForThisRun = pendingProfile ?? currentProfileId;
    // A manual edit or a preset switch belongs to the run it was made for, so
    // they are consumed here instead of leaking into later retries / flips.
    pendingPrompt = undefined;
    pendingProfile = undefined;
    if (profileForThisRun) {
      currentProfileId = profileForThisRun;
    }

    const profileOptions = profileList(settingsForRun.profiles, currentKind);
    const preferredProfileId = activeProfileId(
      settingsForRun.profiles,
      currentKind,
      profileForThisRun ??
        (currentKind === "word"
          ? settingsForRun.wordProfileId
          : settingsForRun.sentenceProfileId),
    );
    // Keep the picker on a preset it actually lists, even when the routing pref
    // points at a profile grouped under the other kind.
    const shownProfileId = profileOptions.some(
      (entry) => entry.id === preferredProfileId,
    )
      ? preferredProfileId
      : (profileOptions[0]?.id ?? preferredProfileId);

    const selectProfile = (profileId: string): void => {
      pendingPrompt = undefined;
      pendingProfile = profileId;
      void run();
    };

    const loadingState: PanelState = {
      status: "loading",
      kind: currentKind,
      profileId: shownProfileId,
      profileOptions,
    };
    const panel = showPanel(target.doc, loadingState, {
      onFlipKind: (kind) => {
        pendingPrompt = undefined;
        pendingProfile = undefined;
        void run(kind);
      },
      onSelectProfile: selectProfile,
      onRetry: (prompt) => {
        pendingPrompt = prompt;
        void run(undefined, true);
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
        profileIdOverride: profileForThisRun,
        userPromptOverride: promptForThisRun,
        // "Retry" means "ask the model again"; the cache would return the same
        // stored answer the user just rejected.
        skipCache: refresh,
        // With streaming on, the panel shows text as it arrives instead of
        // waiting for the whole answer.
        onDelta: (partial) => {
          if (runToken === runId) {
            panel.setState({ translation: partial });
          }
        },
      });
      if (runToken !== runId) {
        // A newer run already owns the panel; drop this result silently.
        return;
      }
      currentKind = result.kind;
      currentProfileId = result.profileId;
      showPanel(
        target.doc,
        {
          status: "done",
          kind: result.kind,
          translation: result.translation,
          sentence: result.sentence,
          hasContext: result.hasContext,
          truncated: result.truncated,
          profileId: result.profileId,
          profileName: result.profileName,
          profileOptions,
          usedFallback: result.usedFallback,
          userPrompt: result.userPrompt,
          meta: result.fromCache
            ? getString("panel-cache-meta", {
                age: formatCacheAge(result.cachedAt),
              })
            : `${result.model} · ${result.elapsedMs}ms`,
        },
        {
          onFlipKind: (kind) => {
            pendingPrompt = undefined;
            pendingProfile = undefined;
            void run(kind);
          },
          onSelectProfile: selectProfile,
          onRetry: (prompt) => {
            pendingPrompt = prompt;
            void run(undefined, true);
          },
          onCopy: () => copyToClipboard(result.translation),
          onClose: () => hidePanel(target.doc),
        },
      );
    } catch (err) {
      logError("translate failed", err);
      if (runToken !== runId) {
        return;
      }
      showPanel(
        target.doc,
        {
          status: "error",
          kind: currentKind,
          errorMessage: messageForError(err),
          profileId: shownProfileId,
          profileOptions,
        },
        {
          onFlipKind: (kind) => {
            pendingPrompt = undefined;
            pendingProfile = undefined;
            void run(kind);
          },
          onSelectProfile: selectProfile,
          onRetry: (prompt) => {
            pendingPrompt = prompt;
            void run(undefined, true);
          },
          onCopy: () => undefined,
          onClose: () => hidePanel(target.doc),
        },
      );
    }
  };

  await run();
}

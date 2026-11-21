/**
 * The single translation pipeline:
 * selection -> kind -> context -> prompt -> LLM.
 *
 * Kept free of DOM code so it can be driven from the popup, the shortcut and
 * (later) from the item pane.
 */

import {
  detectSelectionKind,
  normalizeKindMode,
  type SelectionKind,
} from "./reader/selectionKind";
import {
  resolveSentence,
  type SentenceContext,
  type SentenceFingerprint,
} from "./reader/sentence";
import {
  getAttachmentText,
  getEpubFullText,
  getItemTitle,
} from "./reader/textSource";
import { chatCompletion } from "./llm/client";
import { parseProfiles, type PromptProfiles } from "./llm/prompt";
import { renderPromptFor } from "./llm/render";
import {
  isConfigured,
  resolveProviderConfig,
  type EffectiveProviderConfig,
} from "./llm/providers";
import { getBooleanPref, getNumberPref, getStringPref } from "../utils/prefs";
import { log } from "../utils/logger";

export interface PluginSettings {
  provider: EffectiveProviderConfig;
  targetLang: string;
  sourceLang: string;
  kindMode: "auto" | "alwaysWord" | "alwaysSentence";
  wordMaxWords: number;
  wordMaxChars: number;
  useContext: boolean;
  sentenceContextNeighbors: boolean;
  maxSentenceChars: number;
  profiles: PromptProfiles;
  wordProfileId: string;
  sentenceProfileId: string;
}

/**
 * Temperature is stored as a string: Firefox prefs only support
 * int / bool / string, and a float would be silently truncated.
 */
function readTemperature(): number {
  const value = Number.parseFloat(getStringPref("temperature", "0.3"));
  if (!Number.isFinite(value)) {
    return 0.3;
  }
  return Math.min(Math.max(value, 0), 2);
}

/** Read everything the pipeline needs from prefs, once per request. */
export function readSettings(): PluginSettings {
  return {
    provider: resolveProviderConfig({
      provider: getStringPref("provider", "openai"),
      apiKey: getStringPref("apiKey"),
      baseURL: getStringPref("baseURL"),
      model: getStringPref("model"),
      temperature: readTemperature(),
      maxTokens: getNumberPref("maxTokens", 1024),
      timeoutMs: getNumberPref("requestTimeoutMs", 30000),
    }),
    targetLang: getStringPref("targetLang", "zh-CN") || "zh-CN",
    sourceLang: getStringPref("sourceLang", "auto") || "auto",
    kindMode: normalizeKindMode(getStringPref("selectionKindMode", "auto")),
    wordMaxWords: getNumberPref("wordMaxWords", 3),
    wordMaxChars: getNumberPref("wordMaxChars", 40),
    useContext: getBooleanPref("useContext", true),
    sentenceContextNeighbors: getBooleanPref("sentenceContextNeighbors", false),
    maxSentenceChars: getNumberPref("maxSentenceChars", 400),
    profiles: parseProfiles(getStringPref("promptProfiles", "")),
    wordProfileId: getStringPref("promptProfileWord", "word"),
    sentenceProfileId: getStringPref("promptProfileSentence", "sentence"),
  };
}

/**
 * Lightweight provider check for the auto-translate trigger.
 *
 * Auto translation must stay silent when the plugin is not configured yet:
 * popping an error panel on every selection would be unusable. The regular
 * button / shortcut still reports the missing key.
 */
export function hasUsableProvider(): boolean {
  return isConfigured(
    resolveProviderConfig({
      provider: getStringPref("provider", "openai"),
      apiKey: getStringPref("apiKey"),
      baseURL: getStringPref("baseURL"),
      model: getStringPref("model"),
    }),
  );
}

export interface TranslateInput {
  text: string;
  attachmentItemID?: number;
  itemTitle?: string;
  /**
   * Lazy accessor for candidate texts from the live reader view(s). Only called
   * when the attachment has no usable cached text, because reading `innerText`
   * from several documents is not free.
   */
  getLocalTexts?: () => string[];
  /**
   * Text immediately before/after the selection, captured from the DOM. Used to
   * pick the right occurrence when the selected text appears more than once.
   */
  fingerprint?: SentenceFingerprint;
  /** Force a kind, e.g. when the user flips word/sentence in the panel. */
  kindOverride?: SelectionKind;
  /** Replace the rendered user prompt, for the panel's "edit prompt" flow. */
  userPromptOverride?: string;
}

export interface TranslateResult {
  translation: string;
  kind: SelectionKind;
  profileId: string;
  profileName: string;
  usedFallback: boolean;
  sentence: string;
  prevSentence: string;
  nextSentence: string;
  hasContext: boolean;
  truncated: boolean;
  model: string;
  elapsedMs: number;
  /** Rendered user prompt, shown in the panel for editing. */
  userPrompt: string;
}

/**
 * Resolve the context a kind needs.
 * - word: the containing sentence, required for disambiguation
 * - sentence: nothing by default, neighbours only when enabled
 *
 * Three text sources, cheapest first:
 * 1. the attachment's cached full text (`Item.attachmentText`)
 * 2. texts collected from the live reader documents (nested iframes included)
 * 3. for EPUB, Zotero's own EPUB parser (`chrome://zotero/content/EPUB.mjs`)
 *
 * Sources 2 and 3 exist because Zotero returns `attachmentText` only when an
 * attachment has been fully indexed, and — unlike PDF — it has no on-demand
 * extraction path for EPUB.
 */
async function resolveContext(
  input: TranslateInput,
  kind: SelectionKind,
  settings: PluginSettings,
): Promise<SentenceContext | null> {
  const wantsContext =
    kind === "word" ? settings.useContext : settings.sentenceContextNeighbors;
  if (!wantsContext) {
    return null;
  }
  const options = {
    maxChars: settings.maxSentenceChars,
    fingerprint: input.fingerprint,
  };

  const attachmentText = await getAttachmentText(input.attachmentItemID);
  if (attachmentText && attachmentText.length >= 32) {
    const context = resolveSentence(attachmentText, input.text, options);
    if (context) {
      log("context found in", "attachment");
      return context;
    }
  }

  let readerCandidates = 0;
  for (const text of input.getLocalTexts?.() ?? []) {
    readerCandidates += 1;
    const context = resolveSentence(text, input.text, options);
    if (context) {
      log(
        "context found in",
        "reader",
        `(${text.length} chars, ${context.matchCount} match(es))`,
      );
      return context;
    }
  }

  const epubText = await getEpubFullText(input.attachmentItemID);
  if (epubText && epubText.length >= 32) {
    const context = resolveSentence(epubText, input.text, options);
    if (context) {
      log("context found in", "epub");
      return context;
    }
  }

  log("no context found", {
    kind,
    hasAttachmentText: !!attachmentText,
    readerCandidates,
    hasEpubText: !!epubText,
  });
  return null;
}

export async function translate(
  input: TranslateInput,
): Promise<TranslateResult> {
  const text = (input.text ?? "").trim();
  if (!text) {
    throw new Error("EMPTY_SELECTION");
  }
  const settings = readSettings();
  const kind =
    input.kindOverride ??
    detectSelectionKind(text, {
      mode: settings.kindMode,
      maxWords: settings.wordMaxWords,
      maxChars: settings.wordMaxChars,
    });

  const context = await resolveContext(input, kind, settings);
  const rendered = renderPromptFor({
    kind,
    text,
    context,
    includeNeighbors: settings.sentenceContextNeighbors,
    sourceLang: settings.sourceLang,
    targetLang: settings.targetLang,
    itemTitle: input.itemTitle ?? getItemTitle(input.attachmentItemID),
    profiles: settings.profiles,
    wordProfileId: settings.wordProfileId,
    sentenceProfileId: settings.sentenceProfileId,
  });

  const userPrompt = input.userPromptOverride ?? rendered.user;
  log("translate", {
    kind,
    profileId: rendered.profileId,
    hasContext: !!context,
    sentence: context?.sentence?.slice(0, 100) ?? "",
  });

  const response = await chatCompletion({
    config: settings.provider,
    messages: [
      { role: "system", content: rendered.system },
      { role: "user", content: userPrompt },
    ],
  });

  return {
    translation: response.content,
    kind,
    profileId: rendered.profileId,
    profileName: rendered.profileName,
    usedFallback: rendered.usedFallback,
    sentence: kind === "word" ? (context?.sentence ?? "") : "",
    prevSentence: context?.prevSentence ?? "",
    nextSentence: context?.nextSentence ?? "",
    hasContext: Boolean(context?.sentence),
    truncated: context?.truncated ?? false,
    model: response.model,
    elapsedMs: response.elapsedMs,
    userPrompt,
  };
}

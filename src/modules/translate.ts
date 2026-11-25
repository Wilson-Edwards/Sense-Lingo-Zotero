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
  normalizeText,
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
import { normalizeWordTranslation } from "./llm/format";
import { parseProfiles, type PromptProfiles } from "./llm/prompt";
import { renderPromptFor } from "./llm/render";
import {
  isConfigured,
  resolveProviderConfig,
  type EffectiveProviderConfig,
} from "./llm/providers";
import { putEntries } from "./cache/db";
import { promptHash } from "./cache/keys";
import { entryFromTranslation, lookupWord } from "./cache/lookup";
import { getBooleanPref, getNumberPref, getStringPref } from "../utils/prefs";
import { log, warn } from "../utils/logger";

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
  cacheEnabled: boolean;
  cacheStrictSentence: boolean;
  cacheSingleCandidateFallback: boolean;
  autoCacheOnMiss: boolean;
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
      stream: getBooleanPref("stream", true),
      disableThinking: getBooleanPref("disableThinking", true),
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
    cacheEnabled: getBooleanPref("cacheEnabled", true),
    cacheStrictSentence: getBooleanPref("cacheStrictSentence", true),
    cacheSingleCandidateFallback: getBooleanPref(
      "cacheSingleCandidateFallback",
      false,
    ),
    autoCacheOnMiss: getBooleanPref("autoCacheOnMiss", true),
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
  /**
   * Force a prompt preset for this run, e.g. when the panel's template picker
   * switches to another preset. Falls back to the per-kind default when the id
   * is missing or dangling.
   */
  profileIdOverride?: string;
  /** Replace the rendered user prompt, for the panel's "edit prompt" flow. */
  userPromptOverride?: string;
  /** Bypass the cache read, so "retranslate" always hits the provider. */
  skipCache?: boolean;
  /**
   * Progressive output. Called with the translation assembled so far every time
   * the model streams a chunk; not called when `stream` is off. The text is
   * already normalized exactly like the final `TranslateResult.translation`.
   */
  onDelta?: (partialTranslation: string) => void;
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
  /** True when the answer came from the local cache instead of the provider. */
  fromCache: boolean;
  /** Epoch milliseconds of the cached entry, when `fromCache` is true. */
  cachedAt?: number;
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
  // Annotation text comes from PDF/EPUB layout spans and can contain soft
  // hyphens, zero-width characters and visual line breaks. Use the same
  // normalization as context lookup so kind detection, prompting and matching
  // all operate on one representation.
  const text = normalizeText(input.text ?? "");
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
    profileId: input.profileIdOverride,
  });

  const userPrompt = input.userPromptOverride ?? rendered.user;
  log("translate", {
    text: text.slice(0, 100).replace(/\s+/gu, " "),
    kind,
    profileId: rendered.profileId,
    hasContext: !!context,
    sentence: context?.sentence?.slice(0, 100) ?? "",
  });

  const formatTranslation = (raw: string): string =>
    kind === "word" ? normalizeWordTranslation(raw) : raw;

  /**
   * The cache only knows single words: a word's sense is fixed by its sentence,
   * while a selection that is already a sentence has no wider context and no
   * sentence key of its own. An edited prompt or a manually forced retranslate
   * also bypasses it, so the user always gets what they asked for.
   */
  const profileForCache = settings.profiles[rendered.profileId];
  const cacheSentence = context?.sentence ?? "";
  const cacheSignature =
    kind === "word" && profileForCache
      ? promptHash(
          profileForCache.system,
          profileForCache.user,
          settings.targetLang,
        )
      : "";
  const cacheEligible =
    kind === "word" &&
    settings.cacheEnabled &&
    !input.userPromptOverride &&
    !!input.attachmentItemID &&
    !/\s/.test(text) &&
    !!cacheSentence &&
    !!cacheSignature;
  const cacheReadAllowed = cacheEligible && !input.skipCache;

  if (cacheReadAllowed && input.attachmentItemID) {
    const hit = await lookupWord({
      attachmentID: input.attachmentItemID,
      word: text,
      sentence: cacheSentence,
      promptHash: cacheSignature,
      targetLang: settings.targetLang,
      strict: settings.cacheStrictSentence,
      singleCandidateFallback: settings.cacheSingleCandidateFallback,
    });
    if (hit) {
      log("cache hit", text, hit.score.toFixed(2), hit.source);
      return {
        translation: hit.translation,
        kind,
        profileId: rendered.profileId,
        profileName: rendered.profileName,
        usedFallback: rendered.usedFallback,
        sentence: cacheSentence,
        prevSentence: context?.prevSentence ?? "",
        nextSentence: context?.nextSentence ?? "",
        hasContext: true,
        truncated: context?.truncated ?? false,
        model: hit.model || "cache",
        elapsedMs: 0,
        userPrompt,
        fromCache: true,
        cachedAt: hit.updatedAt,
      };
    }
  }

  // Streaming reuses the same formatting so the partial text shown in the UI
  // does not jump when the final, normalized result arrives.
  let streamedRaw = "";
  const response = await chatCompletion({
    config: settings.provider,
    messages: [
      { role: "system", content: rendered.system },
      { role: "user", content: userPrompt },
    ],
    onDelta: input.onDelta
      ? (delta) => {
          streamedRaw += delta;
          input.onDelta?.(formatTranslation(streamedRaw));
        }
      : undefined,
  });

  const translation = formatTranslation(response.content);

  // Store what this click just paid for, so the next click on the same word in
  // the same sentence is instant. Fire-and-forget: a failed write must never
  // affect the answer already on screen.
  if (cacheEligible && settings.autoCacheOnMiss && input.attachmentItemID) {
    const row = entryFromTranslation({
      attachmentID: input.attachmentItemID,
      word: text,
      sentence: cacheSentence,
      translation,
      promptHash: cacheSignature,
      targetLang: settings.targetLang,
      profileId: rendered.profileId,
      model: response.model,
    });
    void putEntries([row]).catch((e) => warn("cache write-back failed", e));
  }

  return {
    translation,
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
    fromCache: false,
  };
}

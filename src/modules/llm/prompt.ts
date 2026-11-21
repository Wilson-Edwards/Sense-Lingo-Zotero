/**
 * Prompt profiles and the word / sentence router.
 *
 * Routing is intentionally dumb: the kind decides which profile id is read from
 * prefs. The `kind` field stored inside a profile is display metadata only, so
 * changing it never silently changes behaviour.
 */

import type { SelectionKind } from "../reader/selectionKind";

export interface PromptProfile {
  name: string;
  kind?: SelectionKind;
  system: string;
  user: string;
}

export type PromptProfiles = Record<string, PromptProfile>;

export const WORD_PROFILE_ID = "word";
export const SENTENCE_PROFILE_ID = "sentence";

const WORD_SYSTEM = `You are a precise bilingual lexicographer.

Translate the selected text into {targetLang}. You are given the sentence it
appears in - use it ONLY to disambiguate word sense, part of speech and
collocation. Do not translate or paraphrase the sentence itself.

Rules:
1. First line: the contextual meaning in {targetLang}, followed by the part of
   speech in parentheses, e.g. "减轻（v.）". If the selection is a fixed term or
   acronym, give the accepted translation first, then a gloss of its meaning in
   this paper (<= 20 chars).
2. If the selection is a single English word, output exactly two more lines
   after the meaning line, each on its own line:
   美式音标：/<General American IPA>/
   英式音标：/<British RP IPA>/
   Use broad IPA only (no pinyin, no respelling). If both pronunciations are
   identical, still output both lines with the same transcription.
3. If the selection is a multi-word term, an acronym, a formula, or not a single
   English word, output the meaning line only - no phonetic lines.
4. Keep formulas, citation markers and proper nouns intact.
5. Output plain text only: no Markdown, no bullet points, no extra commentary.`;

const WORD_USER = "Sentence: {sentence}\nSelected text: {text}";

const SENTENCE_SYSTEM = `You are a precise academic translator.

Translate the text into {targetLang}. The text is already a complete sentence
or a passage, so do not explain and do not add notes - just deliver a faithful,
readable translation.

Rules:
1. Preserve terminology, numbers, formulas, citation markers and proper nouns.
2. Keep the original sentence order; do not merge or split sentences.
3. Output plain text only, never Markdown headings or bullet lists.
4. If the text is already in {targetLang}, output it unchanged.`;

const SENTENCE_USER = "{text}";

/** Built-in profiles. They are always available, even if prefs are corrupted. */
export const DEFAULT_PROFILES: PromptProfiles = {
  [WORD_PROFILE_ID]: {
    name: "划词 · 语境辨析",
    kind: "word",
    system: WORD_SYSTEM,
    user: WORD_USER,
  },
  "word-casual": {
    name: "划词 · 只要中文意思",
    kind: "word",
    system:
      "Translate into {targetLang}. Output the contextual meaning only, no explanation.",
    user: "{text}\n({sentence})",
  },
  [SENTENCE_PROFILE_ID]: {
    name: "划句 · 通顺翻译",
    kind: "sentence",
    system: SENTENCE_SYSTEM,
    user: SENTENCE_USER,
  },
  "sentence-neighbor": {
    name: "划句 · 带前后句衔接",
    kind: "sentence",
    system:
      "You are a precise academic translator. Translate the text into {targetLang}, keeping coherence with the neighboring sentences. Output only the translation of the text.",
    user: "Previous: {prevSentence}\nText: {text}\nNext: {nextSentence}",
  },
};

export function cloneProfiles(profiles: PromptProfiles): PromptProfiles {
  const copy: PromptProfiles = {};
  for (const [id, profile] of Object.entries(profiles)) {
    copy[id] = { ...profile };
  }
  return copy;
}

function isValidProfile(value: unknown): value is PromptProfile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.system === "string" && typeof candidate.user === "string"
  );
}

/**
 * Parse the `promptProfiles` pref. Never throws: a broken JSON string yields the
 * built-in profiles, because a translation must still be possible.
 */
export function parseProfiles(raw: unknown): PromptProfiles {
  const result = cloneProfiles(DEFAULT_PROFILES);
  if (typeof raw !== "string" || !raw.trim()) {
    return result;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }
  if (!parsed || typeof parsed !== "object") {
    return result;
  }
  for (const [id, profile] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!id || !isValidProfile(profile)) {
      continue;
    }
    result[id] = {
      name: typeof profile.name === "string" ? profile.name : id,
      kind:
        profile.kind === "word" || profile.kind === "sentence"
          ? profile.kind
          : undefined,
      system: profile.system,
      user: profile.user,
    };
  }
  return result;
}

/** Serialize profiles for the settings pane. */
export function stringifyProfiles(profiles: PromptProfiles): string {
  return JSON.stringify(profiles, null, 2);
}

export function resolveProfileId(
  kind: SelectionKind,
  wordProfileId: string | undefined,
  sentenceProfileId: string | undefined,
): string {
  const raw =
    kind === "word"
      ? wordProfileId || WORD_PROFILE_ID
      : sentenceProfileId || SENTENCE_PROFILE_ID;
  return (
    raw.trim() || (kind === "word" ? WORD_PROFILE_ID : SENTENCE_PROFILE_ID)
  );
}

export interface ResolvedProfile {
  profile: PromptProfile;
  profileId: string;
  profileName: string;
  usedFallback: boolean;
}

/**
 * Look up a profile by id, falling back to the built-in profile of the same
 * kind when the id is missing or dangling.
 */
export function getProfile(
  profiles: PromptProfiles,
  profileId: string,
  kind: SelectionKind,
): ResolvedProfile {
  const profile = profiles[profileId];
  if (profile) {
    return {
      profile,
      profileId,
      profileName: profile.name || profileId,
      usedFallback: false,
    };
  }
  const fallbackId = kind === "word" ? WORD_PROFILE_ID : SENTENCE_PROFILE_ID;
  const fallback = profiles[fallbackId] ?? DEFAULT_PROFILES[fallbackId];
  return {
    profile: fallback,
    profileId: fallbackId,
    profileName: fallback.name || fallbackId,
    usedFallback: true,
  };
}

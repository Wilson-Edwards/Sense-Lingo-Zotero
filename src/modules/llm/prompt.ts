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

Always output exactly three lines, each on its own line:
<meaning in {targetLang}>（<part of speech>）, e.g. 减轻（v.）
美式音标：/<General American IPA>/
英式音标：/<British RP IPA>/

A token with no whitespace is a single word, and a proper noun is still a
single word: a person's name ("Thoreau"), a place name ("Walden"), a work
title, a brand or product ("iPhone"), an organization, or a mixed-case name all
count. A full personal or place name made of several words also uses this
shape. For a name, line 1 is the accepted translation or transliteration; for a
multi-word name, give one transcription covering the whole name.

Never skip a phonetic line because the token is a name, a brand or a product;
never decide that a transcription is unnecessary. If you are unsure, give your
best broad IPA. If both accents are identical, repeat the same transcription.
Each phonetic line must contain a transcription between slashes.

Final check: the answer must be exactly three lines and contain both 音标
labels; add any missing line before answering. Output plain text only: no
Markdown, no bullet points, no preamble, no extra commentary.`;

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
  [SENTENCE_PROFILE_ID]: {
    name: "划句 · 通顺翻译",
    kind: "sentence",
    system: SENTENCE_SYSTEM,
    user: SENTENCE_USER,
  },
};

/**
 * The two slots the settings pane edits. Order matters: it is the display order
 * of the textareas (word first, sentence second).
 */
export const EDITABLE_PROFILE_IDS = [
  WORD_PROFILE_ID,
  SENTENCE_PROFILE_ID,
] as const;

export type EditableProfileId = (typeof EDITABLE_PROFILE_IDS)[number];

/** System prompts as shown in the two settings textareas. */
export type ProfileTemplates = Record<EditableProfileId, string>;

/** Read the editable system prompts, defaulting when a slot is missing. */
export function readProfileTemplates(
  profiles: PromptProfiles,
): ProfileTemplates {
  return {
    word:
      profiles[WORD_PROFILE_ID]?.system ||
      DEFAULT_PROFILES[WORD_PROFILE_ID].system,
    sentence:
      profiles[SENTENCE_PROFILE_ID]?.system ||
      DEFAULT_PROFILES[SENTENCE_PROFILE_ID].system,
  };
}

/**
 * Rebuild the two slots from the settings textareas.
 *
 * A blank textarea falls back to its built-in prompt, so accidentally clearing
 * a box cannot break translation. `current` is only used to keep a `user`
 * template that an older release stored through the JSON editor.
 */
export function buildProfiles(
  templates: ProfileTemplates,
  current?: PromptProfiles,
): PromptProfiles {
  const result: PromptProfiles = {};
  for (const id of EDITABLE_PROFILE_IDS) {
    const fallback = DEFAULT_PROFILES[id];
    result[id] = {
      ...fallback,
      system: templates[id].trim() || fallback.system,
      user: current?.[id]?.user ?? fallback.user,
    };
  }
  return result;
}

/** True when both slots still match the built-ins (the pref can stay empty). */
export function isDefaultProfiles(profiles: PromptProfiles): boolean {
  const ids = Object.keys(profiles);
  if (ids.length !== EDITABLE_PROFILE_IDS.length) {
    return false;
  }
  return EDITABLE_PROFILE_IDS.every((id) => {
    const profile = profiles[id];
    const fallback = DEFAULT_PROFILES[id];
    return (
      profile?.system === fallback.system && profile?.user === fallback.user
    );
  });
}

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
 * Parse the `promptProfiles` pref into the two editable slots.
 *
 * Never throws: a broken JSON string yields the built-in prompts, because a
 * translation must still be possible. Unknown ids (e.g. presets from an older
 * release) are ignored so the settings pane always shows what is actually used.
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
  const stored = parsed as Record<string, unknown>;
  for (const id of EDITABLE_PROFILE_IDS) {
    const profile = stored[id];
    if (!isValidProfile(profile)) {
      continue;
    }
    result[id] = {
      ...DEFAULT_PROFILES[id],
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

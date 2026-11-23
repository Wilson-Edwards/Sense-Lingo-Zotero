/**
 * Prompt profiles and the word / sentence router.
 *
 * A profile is one selectable prompt preset. `promptProfiles` stores a library
 * keyed by id, and each id owns its own name, kind, system and user template.
 * The two routing prefs (`promptProfileWord` / `promptProfileSentence`) only
 * remember which id is active per kind, so adding presets never changes how a
 * request is dispatched.
 *
 * `kind` is grouping metadata used by the settings pane and the result panel.
 * Routing reads the id alone, so editing `kind` cannot silently change which
 * prompt a selection uses.
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

/** The built-in id of a kind: always present, never deletable. */
export const DEFAULT_PROFILE_ID: Record<SelectionKind, string> = {
  word: WORD_PROFILE_ID,
  sentence: SENTENCE_PROFILE_ID,
};

/** Display / grouping order of the two kinds. */
export const PROFILE_KINDS = ["word", "sentence"] as const;

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

function isSelectionKind(value: unknown): value is SelectionKind {
  return value === "word" || value === "sentence";
}

/** Built-in ids are always present and cannot be deleted. */
export function isBuiltinProfileId(id: string): boolean {
  return id === WORD_PROFILE_ID || id === SENTENCE_PROFILE_ID;
}

export function defaultSystemFor(kind: SelectionKind): string {
  return DEFAULT_PROFILES[DEFAULT_PROFILE_ID[kind]].system;
}

export function defaultUserFor(kind: SelectionKind): string {
  return DEFAULT_PROFILES[DEFAULT_PROFILE_ID[kind]].user;
}

export function defaultNameFor(kind: SelectionKind): string {
  return DEFAULT_PROFILES[DEFAULT_PROFILE_ID[kind]].name;
}

/**
 * Which kind a profile belongs to.
 *
 * Custom ids rarely say it, so they default to `word`; generated ids are always
 * prefixed with the kind (`word-2`, `sentence-2`), which is enough to keep a
 * preset listed under the right heading.
 */
export function profileKind(
  id: string,
  profile?: PromptProfile,
): SelectionKind {
  if (profile && isSelectionKind(profile.kind)) {
    return profile.kind;
  }
  if (id === SENTENCE_PROFILE_ID) {
    return "sentence";
  }
  if (id === WORD_PROFILE_ID) {
    return "word";
  }
  return id.toLowerCase().startsWith("sentence") ? "sentence" : "word";
}

export interface ProfileSummary {
  id: string;
  name: string;
  kind: SelectionKind;
}

/** Every preset of one kind: the built-in first, then the user's own. */
export function profileList(
  profiles: PromptProfiles,
  kind: SelectionKind,
): ProfileSummary[] {
  const builtinId = DEFAULT_PROFILE_ID[kind];
  const entries: ProfileSummary[] = [];
  for (const [id, profile] of Object.entries(profiles)) {
    if (profileKind(id, profile) !== kind) {
      continue;
    }
    entries.push({ id, name: profile.name?.trim() || id, kind });
  }
  return entries.sort((a, b) => {
    if (a.id === builtinId) {
      return -1;
    }
    if (b.id === builtinId) {
      return 1;
    }
    return 0;
  });
}

/**
 * Resolve which preset a kind should use.
 *
 * A stored id that still exists always wins, even when its `kind` label says
 * otherwise: the label is metadata, and silently swapping the prompt for
 * another one would be worse than showing a mis-grouped preset.
 */
export function activeProfileId(
  profiles: PromptProfiles,
  kind: SelectionKind,
  preferredId?: string,
): string {
  const raw = (preferredId ?? "").trim();
  if (raw && profiles[raw]) {
    return raw;
  }
  const first = profileList(profiles, kind)[0];
  return first?.id ?? DEFAULT_PROFILE_ID[kind];
}

/** `word`, `word-2`, `word-3`, ... — never collides with an existing id. */
export function nextProfileId(
  profiles: PromptProfiles,
  kind: SelectionKind,
): string {
  const base = DEFAULT_PROFILE_ID[kind];
  if (!profiles[base]) {
    return base;
  }
  let index = 2;
  while (profiles[`${base}-${index}`]) {
    index += 1;
  }
  return `${base}-${index}`;
}

export interface AddProfileOptions {
  /** Preset copied as the starting point; the built-in of `kind` by default. */
  basedOn?: string;
  name?: string;
}

/**
 * Add a preset, seeded from another one so a new entry is never empty.
 * The generated id is stable: renaming a preset never changes its routing id.
 */
export function addProfile(
  profiles: PromptProfiles,
  kind: SelectionKind,
  options: AddProfileOptions = {},
): { profiles: PromptProfiles; id: string } {
  const source = options.basedOn ? profiles[options.basedOn] : undefined;
  const template = source ?? DEFAULT_PROFILES[DEFAULT_PROFILE_ID[kind]];
  const id = nextProfileId(profiles, kind);
  const next = cloneProfiles(profiles);
  next[id] = {
    name: (options.name ?? "").trim() || template.name || id,
    kind,
    system: template.system,
    user: template.user,
  };
  return { profiles: next, id };
}

export interface ProfilePatch {
  name?: string;
  system?: string;
  user?: string;
}

/** Apply an edit; an empty name keeps the previous one. */
export function updateProfile(
  profiles: PromptProfiles,
  id: string,
  patch: ProfilePatch,
): PromptProfiles {
  const current = profiles[id];
  if (!current) {
    return profiles;
  }
  const next = cloneProfiles(profiles);
  const name = patch.name === undefined ? current.name : patch.name.trim();
  next[id] = {
    ...current,
    name: name || current.name || id,
    system: patch.system === undefined ? current.system : patch.system,
    user: patch.user === undefined ? current.user : patch.user,
  };
  return next;
}

/** Delete a user preset; built-ins are not deletable and come back untouched. */
export function removeProfile(
  profiles: PromptProfiles,
  id: string,
): PromptProfiles {
  if (isBuiltinProfileId(id) || !profiles[id]) {
    return profiles;
  }
  const next = cloneProfiles(profiles);
  delete next[id];
  return next;
}

/** True when the library is exactly the built-ins (the pref can stay empty). */
export function isDefaultProfiles(profiles: PromptProfiles): boolean {
  const ids = Object.keys(profiles);
  if (ids.length !== PROFILE_KINDS.length) {
    return false;
  }
  return PROFILE_KINDS.every((kind) => {
    const id = DEFAULT_PROFILE_ID[kind];
    const profile = profiles[id];
    const fallback = DEFAULT_PROFILES[id];
    return Boolean(
      profile &&
      profile.name === fallback.name &&
      profile.system === fallback.system &&
      profile.user === fallback.user,
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

interface StoredProfile {
  name?: string;
  kind?: SelectionKind;
  system: string;
  user?: string;
}

function readStoredProfile(value: unknown): StoredProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.system !== "string") {
    return null;
  }
  return {
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    kind: isSelectionKind(candidate.kind) ? candidate.kind : undefined,
    system: candidate.system,
    user: typeof candidate.user === "string" ? candidate.user : undefined,
  };
}

/**
 * Parse the `promptProfiles` pref into the prompt library.
 *
 * Never throws: a broken JSON string yields the built-in prompts, because a
 * translation must still be possible. Unknown ids are kept instead of dropped,
 * which is what lets older releases add presets through `about:config` and
 * newer ones upgrade without losing them.
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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return result;
  }
  const stored = parsed as Record<string, unknown>;
  for (const [rawId, value] of Object.entries(stored)) {
    const id = rawId.trim();
    if (!id) {
      continue;
    }
    const profile = readStoredProfile(value);
    if (!profile) {
      continue;
    }
    const base = DEFAULT_PROFILES[id];
    const kind = base?.kind ?? profile.kind ?? profileKind(id);
    result[id] = {
      name: (profile.name ?? base?.name ?? "").trim() || defaultNameFor(kind),
      kind,
      system: profile.system.trim()
        ? profile.system
        : (base?.system ?? defaultSystemFor(kind)),
      user: profile.user ?? base?.user ?? defaultUserFor(kind),
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
 * Look up a profile by id, falling back to another preset of the same kind (a
 * user's own preset first, then the built-in) when the id is missing or
 * dangling. The panel shows a hint whenever this happens.
 */
export function getProfile(
  profiles: PromptProfiles,
  profileId: string,
  kind: SelectionKind,
): ResolvedProfile {
  const id = profileId.trim();
  const profile = profiles[id];
  if (profile) {
    return {
      profile,
      profileId: id,
      profileName: profile.name || id,
      usedFallback: false,
    };
  }
  const fallbackId = activeProfileId(profiles, kind);
  const fallback =
    profiles[fallbackId] ?? DEFAULT_PROFILES[DEFAULT_PROFILE_ID[kind]];
  return {
    profile: fallback,
    profileId: fallbackId,
    profileName: fallback.name || fallbackId,
    usedFallback: true,
  };
}

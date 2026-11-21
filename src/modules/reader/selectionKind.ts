/**
 * Selection kind detection: is the user looking up a *word* or a *sentence*?
 *
 * The answer decides which prompt profile is used, so it has to be cheap,
 * explainable and overridable. See README "判定选区类型".
 */

import { isAbbreviationEnding, SENTENCE_TERMINATORS } from "./sentence";

export type SelectionKind = "word" | "sentence";

export type SelectionKindMode = "auto" | "alwaysWord" | "alwaysSentence";

export interface SelectionKindOptions {
  /** `alwaysWord` / `alwaysSentence` skip the heuristics entirely. */
  mode?: SelectionKindMode;
  /** A selection with more words than this is treated as a sentence. */
  maxWords?: number;
  /** A selection longer than this (in characters) is a sentence. */
  maxChars?: number;
}

export const DEFAULT_KIND_OPTIONS: Required<
  Omit<SelectionKindOptions, "mode">
> = {
  maxWords: 3,
  maxChars: 40,
};

/** CJK characters are not space delimited, count them separately. */
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/gu;

const TRAILING_PUNCT_RE = /[\s"'’”)\]】》。，、；：]+$/u;

/** Count whitespace separated tokens; CJK is handled by `countCjk`. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

export function countCjk(text: string): number {
  return (text.match(CJK_RE) ?? []).length;
}

/** Does the text contain a sentence terminator anywhere in the middle? */
function hasInnerTerminator(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!SENTENCE_TERMINATORS.includes(ch)) {
      continue;
    }
    const next = text.slice(i + 1).trimStart();
    if (!next) {
      continue; // trailing punctuation, handled by the caller
    }
    if (ch === "." && isAbbreviationEnding(text, i)) {
      continue;
    }
    if (
      ch === "." &&
      /\d/.test(text[i - 1] ?? "") &&
      /\d/.test(text[i + 1] ?? "")
    ) {
      continue; // 3.14
    }
    return true;
  }
  return false;
}

/** Does the selection end with a real sentence terminator? */
function endsWithTerminator(text: string): boolean {
  const stripped = text.replace(TRAILING_PUNCT_RE, "");
  const last = stripped[stripped.length - 1];
  if (!last || !SENTENCE_TERMINATORS.includes(last)) {
    return false;
  }
  if (last === "." && isAbbreviationEnding(stripped, stripped.length - 1)) {
    return false;
  }
  return true;
}

/**
 * Classify a selection.
 *
 * Order matters and mirrors the documented rules:
 * 1. explicit mode wins
 * 2. multi-line selection -> sentence
 * 3. contains a real inner terminator -> sentence
 * 4. ends with a real terminator -> sentence
 * 5. too many words / too many chars / clearly CJK -> sentence
 * 6. otherwise -> word
 */
export function detectSelectionKind(
  raw: string,
  options: SelectionKindOptions = {},
): SelectionKind {
  const { mode = "auto" } = options;
  const maxWords = options.maxWords ?? DEFAULT_KIND_OPTIONS.maxWords;
  const maxChars = options.maxChars ?? DEFAULT_KIND_OPTIONS.maxChars;

  if (mode === "alwaysWord") {
    return "word";
  }
  if (mode === "alwaysSentence") {
    return "sentence";
  }

  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) {
    return "word";
  }
  if (text.includes("\n")) {
    return "sentence";
  }
  if (hasInnerTerminator(text) || endsWithTerminator(text)) {
    return "sentence";
  }
  if (countWords(text) > maxWords) {
    return "sentence";
  }
  if (text.length > maxChars) {
    return "sentence";
  }
  if (countCjk(text) >= 8) {
    return "sentence";
  }
  return "word";
}

/** Normalize a pref value into a valid mode. */
export function normalizeKindMode(raw: unknown): SelectionKindMode {
  return raw === "alwaysWord" || raw === "alwaysSentence" ? raw : "auto";
}

export function flipKind(kind: SelectionKind): SelectionKind {
  return kind === "word" ? "sentence" : "word";
}

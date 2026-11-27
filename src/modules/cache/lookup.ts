/**
 * Click-time cache lookup.
 *
 * The stored entry holds the sentence it was translated in. A live selection
 * normally matches only when its sentence is the *same* sentence: the same
 * word in a different sentence can be a different sense. The one conservative
 * exception is when at least two sampled contexts produced exactly the same
 * translation; that stable answer can be reused for an unseen sentence.
 */

import { normalizeText } from "../reader/sentence";
import {
  getCacheDb,
  queryEntries,
  type CacheEntryInput,
  type CacheEntryRow,
} from "./db";
import { sentenceKey, wordKey } from "./keys";

export interface Candidate extends CacheEntryRow {
  /** Match confidence; contextual matches outrank stable-answer fallback. */
  score: number;
}

export interface PickOptions {
  /** Reject anything below the strict threshold (default behaviour). */
  strict: boolean;
  /** Accept the only stored row even when no rule matched. */
  singleCandidateFallback: boolean;
}

const STRICT_THRESHOLD = 0.9;
/** A non-contextual hit backed by at least two identical contextual answers. */
const IDENTICAL_TRANSLATION_SCORE = 0.8;

function comparableTranslation(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

/**
 * Reuse an unseen sentence only when multiple sampled contexts independently
 * produced the same non-empty answer. One row is not evidence of a stable
 * sense, and differing answers keep the normal context-strict behaviour.
 */
function identicalTranslationFallback(
  rows: readonly CacheEntryRow[],
): Candidate | null {
  if (rows.length < 2) {
    return null;
  }
  const expected = comparableTranslation(rows[0].translation);
  if (
    !expected ||
    rows.some(
      (candidate) => comparableTranslation(candidate.translation) !== expected,
    )
  ) {
    return null;
  }
  return { ...rows[0], score: IDENTICAL_TRANSLATION_SCORE };
}

function commonPrefixLength(a: string, b: string, limit: number): number {
  let length = 0;
  while (length < limit && length < a.length && length < b.length) {
    if (a[length] !== b[length]) {
      break;
    }
    length += 1;
  }
  return length;
}

function commonSuffixLength(a: string, b: string, limit: number): number {
  let length = 0;
  while (length < limit && length < a.length && length < b.length) {
    if (a[a.length - 1 - length] !== b[b.length - 1 - length]) {
      break;
    }
    length += 1;
  }
  return length;
}

/**
 * How well one stored sentence matches the live one.
 *
 * The rules are ordered from "cannot be wrong" to "probably right"; every
 * result below 0.90 is discarded by `pickBestCandidate` unless the strict
 * switch is off.
 */
export function scoreCandidate(
  stored: { sentence: string; sentenceKey: string },
  liveSentence: string,
): number {
  const live = normalizeText(liveSentence);
  const candidate = normalizeText(stored.sentence);
  if (!live || !candidate) {
    return 0;
  }
  if (stored.sentenceKey === sentenceKey(live)) {
    return 1;
  }
  if (candidate === live) {
    return 0.99;
  }
  const compactCandidate = candidate.replace(/\s+/g, "");
  const compactLive = live.replace(/\s+/g, "");
  if (compactCandidate === compactLive) {
    return 0.95;
  }
  if (
    candidate.includes(live) ||
    live.includes(candidate) ||
    compactCandidate.includes(compactLive) ||
    compactLive.includes(compactCandidate)
  ) {
    return 0.9;
  }
  // Reflow can move the cut point of a long sentence; a long shared prefix or
  // suffix still identifies the same passage.
  const shared =
    commonPrefixLength(candidate, live, 30) +
    commonSuffixLength(candidate, live, 30);
  if (shared >= 12) {
    return 0.85;
  }
  return 0;
}

/** Highest-scoring candidate above the threshold, or `null`. */
export function pickBestCandidate(
  rows: readonly CacheEntryRow[],
  liveSentence: string,
  options: PickOptions,
): Candidate | null {
  if (!rows.length) {
    return null;
  }
  let best: Candidate | null = null;
  for (const row of rows) {
    const score = scoreCandidate(row, liveSentence);
    if (!best || score > best.score) {
      best = { ...row, score };
    }
  }
  const threshold = options.strict ? STRICT_THRESHOLD : 0;
  if (best && best.score >= threshold && best.score > 0) {
    return best;
  }
  const stable = identicalTranslationFallback(rows);
  if (stable) {
    return stable;
  }
  if (options.singleCandidateFallback && rows.length === 1) {
    return { ...rows[0], score: best?.score ?? 0 };
  }
  return null;
}

export interface LookupInput {
  attachmentID: number;
  word: string;
  sentence: string;
  strict: boolean;
  singleCandidateFallback: boolean;
}

/** Read candidates from SQLite and pick the best one. */
export async function lookupWord(
  input: LookupInput,
): Promise<Candidate | null> {
  if (!input.sentence.trim()) {
    return null;
  }
  const db = await getCacheDb();
  if (!db) {
    return null;
  }
  const rows = await queryEntries({
    attachmentID: input.attachmentID,
    wordKey: wordKey(input.word),
  });
  return pickBestCandidate(rows, input.sentence, {
    strict: input.strict,
    singleCandidateFallback: input.singleCandidateFallback,
  });
}

/** Build the row a click-time write-back stores. */
export function entryFromTranslation(input: {
  attachmentID: number;
  word: string;
  sentence: string;
  translation: string;
  promptHash: string;
  targetLang: string;
  profileId: string;
  model: string;
}): CacheEntryInput {
  return {
    attachmentID: input.attachmentID,
    wordKey: wordKey(input.word),
    word: input.word,
    sentenceKey: sentenceKey(input.sentence),
    sentence: normalizeText(input.sentence),
    translation: input.translation,
    promptHash: input.promptHash,
    targetLang: input.targetLang,
    profileId: input.profileId,
    model: input.model,
    source: "click",
  };
}

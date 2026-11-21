/**
 * Sentence-level text utilities.
 *
 * Everything here is a pure function so it can be unit tested outside Zotero.
 * The PDF text layer is messy: hyphenated line breaks, abbreviations sprinkled
 * with dots, numbers with decimal points. `resolveSentence` is the single place
 * that knows how to cut a sentence out of that mess.
 */

export const SENTENCE_TERMINATORS = ".!?。！？";

/** Terminators that never need the abbreviation check. */
const HARD_TERMINATORS = "。！？";

/**
 * Tokens that end with a dot but must not close a sentence.
 * Compared in lower-case with all dots removed, so `e.g.` -> `eg`.
 */
const ABBREVIATIONS = new Set([
  "al",
  "approx",
  "ca",
  "cf",
  "ch",
  "chap",
  "dr",
  "e.g",
  "ed",
  "eds",
  "eq",
  "eqs",
  "etc",
  "fig",
  "figs",
  "i.e",
  "inc",
  "ltd",
  "max",
  "min",
  "mr",
  "mrs",
  "ms",
  "no",
  "nos",
  "p",
  "pp",
  "prof",
  "ref",
  "refs",
  "resp",
  "sec",
  "sect",
  "st",
  "tab",
  "vol",
  "vols",
  "vs",
]);

export interface SentenceFingerprint {
  /** Text right before the selection (from the DOM range). */
  before?: string;
  /** Text right after the selection (from the DOM range). */
  after?: string;
}

export interface ResolveSentenceOptions {
  /** Hard cap of the returned sentence length. Default: 400. */
  maxChars?: number;
  /**
   * Disambiguates repeated occurrences of the needle, e.g. the same word in
   * another chapter of a book, or twice in the same paragraph.
   */
  fingerprint?: SentenceFingerprint;
}

export interface SentenceContext {
  /** The sentence that contains the needle. */
  sentence: string;
  /** The sentence before it ("" when the needle is in the first sentence). */
  prevSentence: string;
  /** The sentence after it ("" when the needle is in the last sentence). */
  nextSentence: string;
  /** How many times the needle occurs in the whole text. */
  matchCount: number;
  /** True when `sentence` was cut because it exceeded `maxChars`. */
  truncated: boolean;
}

/**
 * Normalize a chunk of PDF/EPUB text: unify line endings, drop invisible
 * characters (soft hyphens, zero-width spaces — common in EPUB), turn
 * non-breaking spaces into spaces, glue hyphenated line breaks
 * (`trans-\nlation` -> `translation`) and collapse whitespace runs.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}]/u.test(ch);
}

function isLowercaseLetter(ch: string | null): boolean {
  return !!ch && /\p{Ll}/u.test(ch);
}

function nextNonSpaceChar(text: string, from: number): string | null {
  for (let i = from; i < text.length; i++) {
    if (!/\s/.test(text[i])) {
      return text[i];
    }
  }
  return null;
}

/**
 * Read the word right before `dotIndex`, e.g. `et al.` -> `al`, `e.g.` -> `e.g`.
 */
function tokenBefore(text: string, dotIndex: number): string {
  const head = text.slice(Math.max(0, dotIndex - 24), dotIndex);
  const match = head.match(/([\p{L}.]+)$/u);
  return match ? match[1] : "";
}

/** `true` when the dot at `dotIndex` belongs to an abbreviation. */
export function isAbbreviationEnding(text: string, dotIndex: number): boolean {
  const token = tokenBefore(text, dotIndex);
  if (!token) {
    return false;
  }
  const normalized = token.toLowerCase().replace(/\./g, "");
  if (ABBREVIATIONS.has(normalized)) {
    return true;
  }
  // A single capital letter is an initial (`J. Smith`), not a full stop.
  if (token.length === 1 && /[A-Z]/.test(token)) {
    return true;
  }
  return ABBREVIATIONS.has(token.toLowerCase());
}

/**
 * Decide whether the terminator at `index` really ends a sentence.
 * Conservative on purpose: a false negative only makes the context longer,
 * while a false positive cuts a sentence in half.
 */
export function isSentenceBoundary(text: string, index: number): boolean {
  const ch = text[index];
  if (!SENTENCE_TERMINATORS.includes(ch)) {
    return false;
  }
  if (HARD_TERMINATORS.includes(ch)) {
    return true;
  }
  const nextChar = nextNonSpaceChar(text, index + 1);
  if (ch === "!" || ch === "?") {
    return nextChar === null || !isLowercaseLetter(nextChar);
  }
  // "." below
  const prevChar = text[index - 1];
  if (/\d/.test(prevChar ?? "") && /\d/.test(text[index + 1] ?? "")) {
    return false; // decimal point: 3.14
  }
  if (isAbbreviationEnding(text, index)) {
    return false;
  }
  if (nextChar === null) {
    return true;
  }
  // "word. lowercase" is almost always a broken sentence, keep it together.
  return !isLowercaseLetter(nextChar);
}

function findSentenceStart(text: string, from: number): number {
  for (let i = from - 1; i >= 0; i--) {
    if (isSentenceBoundary(text, i)) {
      return i + 1;
    }
  }
  return 0;
}

function findSentenceEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (isSentenceBoundary(text, i)) {
      return i + 1;
    }
  }
  return text.length;
}

/** Index of all occurrences of `needle` in `haystack` (case-insensitive). */
function findMatches(haystack: string, needle: string): number[] {
  const hay = haystack.toLowerCase();
  const pin = needle.toLowerCase();
  const result: number[] = [];
  if (!pin) {
    return result;
  }
  let from = 0;
  while (from <= hay.length - pin.length) {
    const found = hay.indexOf(pin, from);
    if (found < 0) {
      break;
    }
    result.push(found);
    from = found + pin.length;
  }
  return result;
}

function commonSuffixLength(a: string, b: string, limit: number): number {
  let n = 0;
  while (
    n < limit &&
    n < a.length &&
    n < b.length &&
    a[a.length - 1 - n] === b[b.length - 1 - n]
  ) {
    n += 1;
  }
  return n;
}

function commonPrefixLength(a: string, b: string, limit: number): number {
  let n = 0;
  while (n < limit && n < a.length && n < b.length && a[n] === b[n]) {
    n += 1;
  }
  return n;
}

/** How well the text around a match agrees with the live selection. */
function scoreMatch(
  text: string,
  start: number,
  end: number,
  fingerprint: SentenceFingerprint,
): number {
  const before = normalizeText(fingerprint.before ?? "");
  const after = normalizeText(fingerprint.after ?? "");
  if (!before && !after) {
    return 0;
  }
  const left = text.slice(0, start).replace(/\s+$/, "").toLowerCase();
  const right = text.slice(end).replace(/^\s+/, "").toLowerCase();
  const beforeLower = before.toLowerCase();
  const afterLower = after.toLowerCase();
  const exact =
    commonSuffixLength(left, beforeLower, 30) +
    commonPrefixLength(right, afterLower, 30);

  // EPUB extraction can introduce whitespace at inline-node boundaries. The
  // selected text already has a whitespace-insensitive fallback; its live DOM
  // fingerprint needs the same treatment or every loose occurrence scores 0.
  const leftCompact = left.replace(/\s+/g, "");
  const rightCompact = right.replace(/\s+/g, "");
  const beforeCompact = beforeLower.replace(/\s+/g, "");
  const afterCompact = afterLower.replace(/\s+/g, "");
  const compact =
    commonSuffixLength(leftCompact, beforeCompact, 30) +
    commonPrefixLength(rightCompact, afterCompact, 30);
  return Math.max(exact, compact);
}

/**
 * Prefer an occurrence that lines up with the live selection: first by
 * fingerprint, then by word boundaries, then the first hit.
 */
function pickMatchIndex(
  text: string,
  needle: string,
  matches: number[],
  fingerprint?: SentenceFingerprint,
): number {
  if (matches.length <= 1) {
    return matches[0];
  }
  if (fingerprint && (fingerprint.before || fingerprint.after)) {
    let best = matches[0];
    let bestScore = 0;
    for (const index of matches) {
      const score = scoreMatch(text, index, index + needle.length, fingerprint);
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    }
    if (bestScore > 0) {
      return best;
    }
  }
  const len = needle.length;
  for (const index of matches) {
    const before = index === 0 ? undefined : text[index - 1];
    const after = text[index + len];
    if (!isWordChar(before) && !isWordChar(after)) {
      return index;
    }
  }
  return matches[0];
}

interface LooseMatch {
  start: number;
  /** Exclusive end offset in `text`. */
  end: number;
}

/**
 * Whitespace-insensitive lookup.
 *
 * EPUB full text is concatenated from per-section `innerText`, so inline markup
 * and paragraph joins leave extra spaces inside what the reader shows as a
 * single word or sentence. Compare both sides with all whitespace removed, then
 * map the hit back to real offsets in `text`.
 */
function findWhitespaceInsensitiveMatches(
  text: string,
  needle: string,
): LooseMatch[] {
  const needleCompact = needle.replace(/\s+/g, "");
  if (!needleCompact) {
    return [];
  }
  let compact = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      continue;
    }
    compact += text[i];
    map.push(i);
  }
  const hay = compact.toLowerCase();
  const pin = needleCompact.toLowerCase();
  // Bail out when lower-casing changed lengths: the index map would be wrong.
  if (hay.length !== compact.length || pin.length !== needleCompact.length) {
    return [];
  }
  const matches: LooseMatch[] = [];
  let from = 0;
  while (from <= hay.length - pin.length) {
    const index = hay.indexOf(pin, from);
    if (index < 0) {
      break;
    }
    matches.push({
      start: map[index],
      end: map[index + pin.length - 1] + 1,
    });
    from = index + pin.length;
  }
  return matches;
}

function pickLooseMatch(
  text: string,
  matches: LooseMatch[],
  fingerprint?: SentenceFingerprint,
): LooseMatch {
  if (matches.length <= 1) {
    return matches[0];
  }
  if (fingerprint && (fingerprint.before || fingerprint.after)) {
    let best = matches[0];
    let bestScore = 0;
    for (const match of matches) {
      const score = scoreMatch(text, match.start, match.end, fingerprint);
      if (score > bestScore) {
        bestScore = score;
        best = match;
      }
    }
    if (bestScore > 0) {
      return best;
    }
  }
  for (const match of matches) {
    const before = match.start === 0 ? undefined : text[match.start - 1];
    const after = text[match.end];
    if (!isWordChar(before) && !isWordChar(after)) {
      return match;
    }
  }
  return matches[0];
}

function truncateAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/**
 * Locate the sentence (and its neighbours) that contains `needle`.
 *
 * Returns `null` when the needle cannot be found in the text at all, which is
 * the normal case for scanned PDFs without a text layer.
 */
export function resolveSentence(
  fullText: string,
  needle: string,
  options: ResolveSentenceOptions = {},
): SentenceContext | null {
  const maxChars = options.maxChars ?? 400;
  const text = normalizeText(fullText);
  const target = normalizeText(needle);
  if (!text || !target) {
    return null;
  }

  let index: number;
  let matchEnd: number;
  let matchCount: number;

  const matches = findMatches(text, target);
  if (matches.length) {
    // When a fingerprint is available, include whitespace-insensitive EPUB
    // hits as well. A different chapter may contain an exact `proposed` while
    // the selected occurrence was extracted as `pro posed`; stopping after the
    // exact hit would still choose the wrong chapter.
    const looseMatches = options.fingerprint
      ? findWhitespaceInsensitiveMatches(text, target)
      : [];
    if (looseMatches.length > matches.length) {
      const unique = new Map<string, LooseMatch>();
      for (const exact of matches) {
        const match = { start: exact, end: exact + target.length };
        unique.set(`${match.start}:${match.end}`, match);
      }
      for (const match of looseMatches) {
        unique.set(`${match.start}:${match.end}`, match);
      }
      const candidates = [...unique.values()];
      const picked = pickLooseMatch(text, candidates, options.fingerprint);
      index = picked.start;
      matchEnd = picked.end;
      matchCount = candidates.length;
    } else {
      index = pickMatchIndex(text, target, matches, options.fingerprint);
      matchEnd = index + target.length;
      matchCount = matches.length;
    }
  } else {
    // EPUB / reflowed text: retry ignoring all whitespace differences.
    const looseMatches = findWhitespaceInsensitiveMatches(text, target);
    if (!looseMatches.length) {
      return null;
    }
    const loose = pickLooseMatch(text, looseMatches, options.fingerprint);
    index = loose.start;
    matchEnd = loose.end;
    matchCount = looseMatches.length;
  }

  const sentenceStart = findSentenceStart(text, index);
  const sentenceEnd = findSentenceEnd(text, matchEnd);
  const rawSentence = text.slice(sentenceStart, sentenceEnd).trim();

  const prevSentence = text
    .slice(
      findSentenceStart(text, Math.max(0, sentenceStart - 2)),
      sentenceStart,
    )
    .trim();
  const nextSentence = text
    .slice(sentenceEnd, findSentenceEnd(text, sentenceEnd))
    .trim();

  return {
    sentence: truncateAtWord(rawSentence, maxChars),
    prevSentence,
    nextSentence,
    matchCount,
    truncated: rawSentence.length > maxChars,
  };
}

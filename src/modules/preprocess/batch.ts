/**
 * Batch prompt construction and parsing (pure functions).
 *
 * The word prompt is a three-line plain-text contract. Batches keep that
 * contract and only add `[[n]]` markers; JSON is avoided on purpose, because
 * an OpenAI-compatible gateway may ignore `response_format` entirely and then
 * a strict JSON parse would fail on every chunk.
 *
 * Anything malformed must return `null` — the caller retries the half-sized
 * chunk and finally falls back to one request per item. A parser that guesses
 * would risk storing the translation of item 3 under item 2.
 */

import { normalizeWordTranslation } from "../llm/format";

export interface BatchItem {
  word: string;
  sentence: string;
}

export interface ChunkOptions {
  /** Maximum items per request. */
  maxItems: number;
  /** Soft character budget of the whole user envelope. */
  maxChars: number;
}

/** Rough size of one item in the user envelope, label lines included. */
function itemChars(item: BatchItem): number {
  return item.sentence.length + item.word.length + 24;
}

/**
 * Split items by count and by character budget. An item larger than the budget
 * gets a chunk of its own instead of being mixed with others.
 */
export function chunkItems<T extends BatchItem>(
  items: readonly T[],
  options: ChunkOptions,
): T[][] {
  const maxItems = Math.max(1, Math.floor(options.maxItems) || 1);
  const maxChars = Math.max(200, Math.floor(options.maxChars) || 6000);
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;
  for (const item of items) {
    const size = itemChars(item);
    const wouldExceed =
      current.length > 0 &&
      (current.length >= maxItems || currentChars + size > maxChars);
    if (wouldExceed) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += size;
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

/**
 * Append the batch rules to the rendered system prompt.
 *
 * `expectedLines` comes from probing the template, so a custom one-line prompt
 * ("meaning only") batches correctly too.
 */
export function buildBatchSystem(
  system: string,
  expectedLines: number,
): string {
  const lines = Math.max(1, Math.floor(expectedLines) || 1);
  const example = [
    "[[1]]",
    "<line 1 of item 1>",
    ...Array.from(
      { length: lines - 1 },
      (_unused, index) => `<line ${index + 2} of item 1>`,
    ),
    "[[2]]",
    "<line 1 of item 2>",
    "...",
  ].join("\n");
  return `${system}

You will now receive several items at once. Apply the instructions above
independently to EACH item (its sentence disambiguates its selected text).

Output format (strict):
${example}

Rules:
- Emit one block per item, in the given order. The marker line is exactly
  [[n]] and contains nothing else.
- Each block has exactly ${lines} line(s), the same shape as a single-item
  answer. Never add or drop a line because of what the item is.
- No blank lines, no numbering inside a block, no preamble, no commentary.
- Never merge or split items. A proper noun still gets all lines.
- Output plain text only.`;
}

/**
 * Build the user envelope from each item's rendered single-item prompt.
 *
 * Rendering `word.user` per item is what keeps a custom template working: the
 * batch layer only adds markers, never its own field labels.
 */
export function buildBatchUser(renderedUsers: readonly string[]): string {
  return renderedUsers
    .map((text, index) => `[[${index + 1}]]\n${text.trim()}`)
    .join("\n");
}

/** True when the template has no per-item variable in its system prompt. */
export function canBatch(systemTemplate: string): boolean {
  return !/\{\s*(text|word|sentence)\s*\}/i.test(systemTemplate ?? "");
}

/** Number of non-empty lines in a single-item answer. */
export function countAnswerLines(answer: string): number {
  return normalizeWordTranslation(answer ?? "")
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
}

const PHONETIC_RE = /\/[^/\n]+\//;

/**
 * Parse a batched answer.
 *
 * Returns one normalized translation per item, or `null` when the markers,
 * the block count or the per-block line count do not match the contract.
 */
export function parseBatchOutput(
  raw: string,
  count: number,
  expectedLines: number,
): string[] | null {
  const expected = Math.max(1, Math.floor(expectedLines) || 1);
  const text = (raw ?? "").replace(/\r\n?/g, "\n");
  const markerRe = /^[ \t]*\[\[(\d+)\]\][ \t]*$/gm;
  const markers: Array<{ index: number; end: number; number: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = markerRe.exec(text))) {
    markers.push({
      index: match.index,
      end: match.index + match[0].length,
      number: Number(match[1]),
    });
  }
  if (markers.length !== count) {
    return null;
  }

  const translations: string[] = [];
  for (let i = 0; i < markers.length; i++) {
    // Order and uniqueness are one check: `1..n` in sequence.
    if (markers[i].number !== i + 1) {
      return null;
    }
    const blockStart = markers[i].end;
    const blockEnd =
      i + 1 < markers.length ? markers[i + 1].index : text.length;
    const rawLines = text
      .slice(blockStart, blockEnd)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    // A model sometimes joins the three lines into one, which
    // `normalizeWordTranslation` is exactly what repairs; the single-item path
    // already relies on it, so the block is measured after the same
    // normalization. The raw lines still win when they already match, which
    // keeps a one-line template from being split by a phonetic label inside it.
    const normalizedLines = normalizeWordTranslation(rawLines.join("\n"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const lines =
      normalizedLines.length === expected ? normalizedLines : rawLines;
    // A trailing "Hope this helps." after the last block is commentary, not a
    // dropped item; a short block is always a failure.
    const blockLines =
      i === markers.length - 1 ? lines.slice(0, expected) : lines;
    if (blockLines.length !== expected) {
      return null;
    }
    if (expected === 3) {
      if (
        !blockLines[1].includes("美式音标") ||
        !PHONETIC_RE.test(blockLines[1])
      ) {
        return null;
      }
      if (
        !blockLines[2].includes("英式音标") ||
        !PHONETIC_RE.test(blockLines[2])
      ) {
        return null;
      }
    }
    const normalized = normalizeWordTranslation(blockLines.join("\n"));
    if (!normalized) {
      return null;
    }
    translations.push(normalized);
  }
  return translations;
}

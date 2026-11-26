/**
 * Candidate extraction for preprocessing (pure functions).
 *
 * Input is the EPUB split into sections; output is a deduplicated list of
 * `(word, sentence)` pairs ordered by frequency. Only single words are kept:
 * multi-word selections are classified as sentences at click time, and n-grams
 * would multiply the entry count for a small hit-rate gain.
 */

import { sentenceKey, wordKey } from "../cache/keys";
import { splitSentences } from "../reader/sentence";

export interface PreprocessSection {
  href: string;
  text: string;
}

export interface ExtractOptions {
  /** Same cap as the click path, so both cut a long sentence identically. */
  maxSentenceChars: number;
  /** Representative sentences stored per word. */
  maxSentencesPerWord: number;
  /** Drop compounds such as `well-known`. */
  skipHyphenated?: boolean;
}

export interface ExtractedItem {
  word: string;
  wordKey: string;
  sentence: string;
  sentenceKey: string;
  /** Total occurrences of this word in the whole book. */
  occurrence: number;
}

/** `\p{L}` start, then letters, combining marks, apostrophes and hyphens. */
const TOKEN_RE = /\p{L}[\p{L}\p{M}'’-]*/gu;

/** High-frequency function words: their translations add no reading value. */
const STOPWORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
]);

interface SentenceStat {
  sentence: string;
  /** Occurrences of the word inside this sentence. */
  count: number;
  firstSeen: number;
}

interface WordStat {
  word: string;
  total: number;
  firstSeen: number;
  sentences: Map<string, SentenceStat>;
}

/** Characters that mean "this token is part of a URL or an address". */
const URL_NEIGHBOURS = new Set(["/", ":", "@", "#", "\\", "?"]);

function isUsefulToken(
  token: string,
  sentence: string,
  start: number,
  skipHyphenated: boolean,
): boolean {
  if (token.length < 2) {
    return false;
  }
  if (skipHyphenated && /[-‐‑‒–—]/.test(token)) {
    return false;
  }
  const key = token.normalize("NFC").toLowerCase();
  if (STOPWORDS.has(key)) {
    return false;
  }
  const before = start > 0 ? sentence[start - 1] : "";
  const after = sentence[start + token.length] ?? "";
  if (URL_NEIGHBOURS.has(before) || URL_NEIGHBOURS.has(after)) {
    return false;
  }
  return true;
}

/**
 * Walk every section, split it into sentences, and collect word statistics.
 *
 * Occurrences are counted across the whole book so the vocabulary has a stable
 * frequency order; sentences are tracked per word so a few representative
 * senses can be sampled later. A total of one remains eligible.
 */
export function extractCandidates(
  sections: readonly PreprocessSection[],
  options: ExtractOptions,
): ExtractedItem[] {
  const skipHyphenated = options.skipHyphenated ?? true;
  const stats = new Map<string, WordStat>();
  let sentenceOrder = 0;

  for (const section of sections) {
    const text = section.text ?? "";
    for (const sentence of splitSentences(text, options.maxSentenceChars)) {
      sentenceOrder += 1;
      TOKEN_RE.lastIndex = 0;
      // Hash the sentence once: the token loop below can run hundreds of times.
      const keyForSentence = sentenceKey(sentence);
      let match: RegExpExecArray | null;
      while ((match = TOKEN_RE.exec(sentence))) {
        const token = match[0];
        if (!isUsefulToken(token, sentence, match.index, skipHyphenated)) {
          continue;
        }
        const key = wordKey(token);
        if (!key) {
          continue;
        }
        let stat = stats.get(key);
        if (!stat) {
          stat = {
            word: token,
            total: 0,
            firstSeen: sentenceOrder,
            sentences: new Map(),
          };
          stats.set(key, stat);
        }
        stat.total += 1;
        const sentenceStat = stat.sentences.get(keyForSentence);
        if (sentenceStat) {
          sentenceStat.count += 1;
        } else {
          stat.sentences.set(keyForSentence, {
            sentence,
            count: 1,
            firstSeen: sentenceOrder,
          });
        }
      }
    }
  }

  const kept = [...stats.values()].sort(
    (a, b) => b.total - a.total || a.firstSeen - b.firstSeen,
  );

  const items: ExtractedItem[] = [];
  for (const stat of kept) {
    const chosen = [...stat.sentences.entries()]
      .sort(
        (a, b) => b[1].count - a[1].count || a[1].firstSeen - b[1].firstSeen,
      )
      .slice(0, Math.max(1, options.maxSentencesPerWord));
    for (const [key, sentenceStat] of chosen) {
      items.push({
        word: stat.word,
        wordKey: wordKey(stat.word),
        sentence: sentenceStat.sentence,
        sentenceKey: key,
        occurrence: stat.total,
      });
    }
  }
  return items;
}

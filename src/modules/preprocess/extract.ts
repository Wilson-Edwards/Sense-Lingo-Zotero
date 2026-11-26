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

export type PreprocessLanguageFilter = "system" | "none" | "han" | "latin";

export interface ExtractOptions {
  /** Same cap as the click path, so both cut a long sentence identically. */
  maxSentenceChars: number;
  /** Representative sentences stored per word. */
  maxSentencesPerWord: number;
  /** Skip candidates from translated text in bilingual EPUBs. */
  languageFilter?: PreprocessLanguageFilter;
  /** Zotero UI locale, used when `languageFilter` is `system`. */
  systemLocale?: string;
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
const HAN_RE = /\p{Script=Han}/u;
const LATIN_RE = /\p{Script=Latin}/u;
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const GREEK_RE = /\p{Script=Greek}/u;
const ARABIC_RE = /\p{Script=Arabic}/u;
const HIRAGANA_RE = /\p{Script=Hiragana}/u;
const KATAKANA_RE = /\p{Script=Katakana}/u;
const HANGUL_RE = /\p{Script=Hangul}/u;
const KHMER_RE = /\p{Script=Khmer}/u;
const THAI_RE = /\p{Script=Thai}/u;

export function normalizePreprocessLanguageFilter(
  value: unknown,
): PreprocessLanguageFilter {
  return value === "none" || value === "han" || value === "latin"
    ? value
    : "system";
}

function excludedByLanguage(
  token: string,
  filter: PreprocessLanguageFilter,
  systemLocale: string,
): boolean {
  if (filter === "none") {
    return false;
  }
  if (filter === "han") {
    return HAN_RE.test(token);
  }
  if (filter === "latin") {
    return LATIN_RE.test(token);
  }

  const language = systemLocale.toLowerCase().split(/[-_]/u)[0];
  switch (language) {
    case "zh":
      return HAN_RE.test(token);
    case "ja":
      return (
        HAN_RE.test(token) || HIRAGANA_RE.test(token) || KATAKANA_RE.test(token)
      );
    case "ko":
      return HANGUL_RE.test(token) || HAN_RE.test(token);
    case "ru":
    case "uk":
    case "bg":
    case "sr":
      return CYRILLIC_RE.test(token);
    case "el":
      return GREEK_RE.test(token);
    case "ar":
    case "fa":
      return ARABIC_RE.test(token);
    case "km":
      return KHMER_RE.test(token);
    case "th":
      return THAI_RE.test(token);
    case "":
      return false;
    default:
      return LATIN_RE.test(token);
  }
}

/** Skip a sentence only when every token belongs to the filtered language. */
function excludedSentenceByLanguage(
  tokens: readonly string[],
  filter: PreprocessLanguageFilter,
  systemLocale: string,
): boolean {
  if (filter === "none" || !tokens.length) {
    return false;
  }
  let excluded = 0;
  for (const token of tokens) {
    if (excludedByLanguage(token, filter, systemLocale)) {
      excluded += 1;
    }
  }
  return excluded === tokens.length;
}

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
  const languageFilter = normalizePreprocessLanguageFilter(
    options.languageFilter,
  );
  const stats = new Map<string, WordStat>();
  let sentenceOrder = 0;

  for (const section of sections) {
    const text = section.text ?? "";
    for (const sentence of splitSentences(text, options.maxSentenceChars)) {
      sentenceOrder += 1;
      TOKEN_RE.lastIndex = 0;
      const tokens = sentence.match(TOKEN_RE) ?? [];
      if (
        excludedSentenceByLanguage(
          tokens,
          languageFilter,
          options.systemLocale ?? "",
        )
      ) {
        continue;
      }
      // Hash the sentence once: the token loop below can run hundreds of times.
      const keyForSentence = sentenceKey(sentence);
      for (const token of tokens) {
        if (
          token.length < 2 ||
          excludedByLanguage(token, languageFilter, options.systemLocale ?? "")
        ) {
          continue;
        }
        const key = wordKey(token);
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

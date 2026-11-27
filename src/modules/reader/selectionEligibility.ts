/** Selection validation before a word is sent to the cache or provider. */

const LETTER_RE = /\p{L}/u;
/**
 * A word selection only needs to contain a letter.
 *
 * Unicode Script is not a language detector: French, German, Spanish and
 * English all use Latin, for example. Embedded translations are filtered by
 * their DOM marker before this function is reached, so rejecting a whole
 * script here only blocks valid source text and can never reliably identify
 * text that is already in the target language.
 */
export function isEligibleWordSelection(
  text: string,
  _targetLanguage: string,
): boolean {
  return LETTER_RE.test(text ?? "");
}

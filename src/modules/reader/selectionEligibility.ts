/** Selection validation before a word is sent to the cache or provider. */

const LETTER_RE = /\p{L}/u;
const HAN_RE = /\p{Script=Han}/u;
const LATIN_RE = /\p{Script=Latin}/u;
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const GREEK_RE = /\p{Script=Greek}/u;
const ARABIC_RE = /\p{Script=Arabic}/u;
const KHMER_RE = /\p{Script=Khmer}/u;
const THAI_RE = /\p{Script=Thai}/u;

function targetScript(language: string): RegExp | null {
  switch (language.toLowerCase().split(/[-_]/u)[0]) {
    case "zh":
      return HAN_RE;
    case "ja":
      return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
    case "ko":
      return /[\p{Script=Hangul}\p{Script=Han}]/u;
    case "en":
    case "fr":
    case "de":
    case "es":
    case "it":
    case "pt":
    case "nl":
    case "vi":
      return LATIN_RE;
    case "ru":
    case "uk":
    case "bg":
    case "sr":
      return CYRILLIC_RE;
    case "el":
      return GREEK_RE;
    case "ar":
    case "fa":
      return ARABIC_RE;
    case "km":
      return KHMER_RE;
    case "th":
      return THAI_RE;
    default:
      return null;
  }
}

/**
 * A word selection must contain a letter and must not consist entirely of the
 * target language's script. Mixed-script source words remain eligible.
 */
export function isEligibleWordSelection(
  text: string,
  targetLanguage: string,
): boolean {
  const letters = Array.from(text ?? "").filter((char) => LETTER_RE.test(char));
  if (!letters.length) {
    return false;
  }
  const script = targetScript(targetLanguage);
  return !script || letters.some((char) => !script.test(char));
}

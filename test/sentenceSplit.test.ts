import { describe, expect, it } from "vitest";

import {
  resolveSentence,
  splitSentences,
} from "../src/modules/reader/sentence";

/** First reasonably unique word of a sentence, used as the lookup needle. */
function needleOf(sentence: string): string {
  const word = sentence
    .split(/\s+/)
    .find((token) => /^\p{L}{4,}$/u.test(token));
  if (!word) {
    throw new Error(`no usable needle in: ${sentence}`);
  }
  return word;
}

describe("splitSentences", () => {
  it("splits plain sentences", () => {
    expect(
      splitSentences(
        "First sentence here. The proposed method can mitigate noise. Third one.",
      ),
    ).toEqual([
      "First sentence here.",
      "The proposed method can mitigate noise.",
      "Third one.",
    ]);
  });

  it("does not split on abbreviations", () => {
    expect(
      splitSentences("Smith et al. reported this finding. Next sentence here."),
    ).toEqual(["Smith et al. reported this finding.", "Next sentence here."]);
  });

  it("does not split on decimal points", () => {
    expect(
      splitSentences("The value is 3.14 in this test. Another one follows."),
    ).toHaveLength(2);
  });

  it("splits CJK terminators", () => {
    expect(splitSentences("这是第一句。这是第二句！还有第三句？")).toEqual([
      "这是第一句。",
      "这是第二句！",
      "还有第三句？",
    ]);
  });

  it("returns an empty list for blank input", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n  ")).toEqual([]);
  });

  it("truncates at a word boundary like resolveSentence", () => {
    const text = `${"word ".repeat(40)}target ${"tail ".repeat(40)}.`;
    const sentence = splitSentences(text, 60)[0];
    expect(sentence.length).toBeLessThanOrEqual(60);
    expect(resolveSentence(text, "target", { maxChars: 60 })?.sentence).toBe(
      sentence,
    );
  });
});

describe("splitSentences / resolveSentence consistency", () => {
  const text =
    "The first idea was simple. Smith et al. proposed a method in 2020. " +
    "It reduced noise by 3.5 decibels. Later work extended this approach. " +
    "One final remark closes the passage.";

  it("returns exactly the sentence resolveSentence finds", () => {
    const sentences = splitSentences(text);
    expect(sentences).toHaveLength(5);
    for (const sentence of sentences) {
      const context = resolveSentence(text, needleOf(sentence));
      expect(context?.sentence).toBe(sentence);
    }
  });

  it("keeps the same result with an EPUB-style whitespace difference", () => {
    const source = "The pro posed method can mitigate noise. Next one.";
    const sentences = splitSentences(source);
    const context = resolveSentence(source, "proposed");
    expect(sentences).toContain(context?.sentence);
  });

  it("keeps the same result after normalizing line breaks", () => {
    const source = "A trans-\nlation unit works. Another sentence follows.";
    expect(splitSentences(source)[0]).toBe(
      resolveSentence(source, "translation")?.sentence,
    );
  });
});

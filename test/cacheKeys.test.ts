import { describe, expect, it } from "vitest";

import {
  promptHash,
  sentenceKey,
  sha1Hex,
  wordKey,
} from "../src/modules/cache/keys";

describe("sha1Hex", () => {
  it("matches the well-known vectors", () => {
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("hashes non-ASCII text without throwing", () => {
    expect(sha1Hex("中文")).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("wordKey", () => {
  it("normalizes case, NFC and surrounding punctuation", () => {
    expect(wordKey("Thoreau")).toBe("thoreau");
    expect(wordKey('"proposed",')).toBe("proposed");
    expect(wordKey("  (Walden)  ")).toBe("walden");
  });

  it("keeps inner apostrophes and hyphens", () => {
    expect(wordKey("don't")).toBe("don't");
    expect(wordKey("well-known")).toBe("well-known");
  });

  it("keeps accents", () => {
    expect(wordKey("Café")).toBe("café");
  });
});

describe("sentenceKey", () => {
  it("ignores whitespace and line-break differences", () => {
    expect(sentenceKey("The  proposed\nmethod works.")).toBe(
      sentenceKey("The proposed method works."),
    );
  });

  it("changes when the words change", () => {
    expect(sentenceKey("The method works.")).not.toBe(
      sentenceKey("The method fails."),
    );
  });
});

describe("promptHash", () => {
  const system = "system prompt";
  const user = "Sentence: {sentence}";

  it("is stable for the same templates", () => {
    expect(promptHash(system, user, "zh-CN")).toBe(
      promptHash(system, user, "zh-CN"),
    );
  });

  it("changes when the template changes", () => {
    expect(promptHash(system, user, "zh-CN")).not.toBe(
      promptHash(`${system}!`, user, "zh-CN"),
    );
    expect(promptHash(system, user, "zh-CN")).not.toBe(
      promptHash(system, `${user} `, "zh-CN"),
    );
  });

  it("changes with the target language", () => {
    expect(promptHash(system, user, "zh-CN")).not.toBe(
      promptHash(system, user, "ja"),
    );
  });
});

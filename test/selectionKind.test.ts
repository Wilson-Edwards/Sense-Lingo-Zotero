import { describe, expect, it } from "vitest";

import {
  countWords,
  detectSelectionKind,
  flipKind,
  normalizeKindMode,
} from "../src/modules/reader/selectionKind";

describe("detectSelectionKind", () => {
  it("classifies a single word", () => {
    expect(detectSelectionKind("mitigate")).toBe("word");
  });

  it("classifies a short phrase as a word", () => {
    expect(detectSelectionKind("machine learning")).toBe("word");
  });

  it("classifies four words as a sentence", () => {
    expect(detectSelectionKind("state of the art")).toBe("sentence");
  });

  it("classifies a terminated selection as a sentence", () => {
    expect(detectSelectionKind("Not really.")).toBe("sentence");
  });

  it("keeps a title's final punctuated word as a word", () => {
    expect(detectSelectionKind("translation.")).toBe("word");
    expect(detectSelectionKind("translation!”")).toBe("word");
  });

  it("does not treat `et al.` as a sentence", () => {
    expect(detectSelectionKind("et al.")).toBe("word");
  });

  it("does not treat `Fig. 3` as a sentence", () => {
    expect(detectSelectionKind("Fig. 3")).toBe("word");
  });

  it("classifies a multi-line selection as a sentence", () => {
    expect(detectSelectionKind("line one\nline two")).toBe("sentence");
  });

  it("ignores a short PDF line-wrap artefact in a selected word", () => {
    expect(detectSelectionKind("数息\n冥想")).toBe("word");
    expect(detectSelectionKind("Medi\ntation")).toBe("word");
  });

  it("classifies a long selection as a sentence", () => {
    expect(detectSelectionKind("a".repeat(41))).toBe("sentence");
  });

  it("classifies long CJK text as a sentence", () => {
    expect(detectSelectionKind("这是一个很长很长的中文句子")).toBe("sentence");
  });

  it("keeps a decimal number as a word", () => {
    expect(detectSelectionKind("3.14")).toBe("word");
  });

  it("respects alwaysWord", () => {
    expect(
      detectSelectionKind("This is a full sentence.", { mode: "alwaysWord" }),
    ).toBe("word");
  });

  it("respects alwaysSentence", () => {
    expect(detectSelectionKind("mitigate", { mode: "alwaysSentence" })).toBe(
      "sentence",
    );
  });

  it("honours custom thresholds", () => {
    expect(detectSelectionKind("a b c d", { maxWords: 5 })).toBe("word");
    expect(detectSelectionKind("a b", { maxWords: 1 })).toBe("sentence");
    expect(detectSelectionKind("abcdef", { maxChars: 3 })).toBe("sentence");
  });

  it("treats empty input as a word (no-op)", () => {
    expect(detectSelectionKind("   ")).toBe("word");
  });
});

describe("helpers", () => {
  it("counts words", () => {
    expect(countWords("  a  b\tc ")).toBe(3);
    expect(countWords("   ")).toBe(0);
  });

  it("normalizes kind modes", () => {
    expect(normalizeKindMode("alwaysWord")).toBe("alwaysWord");
    expect(normalizeKindMode("alwaysSentence")).toBe("alwaysSentence");
    expect(normalizeKindMode("nonsense")).toBe("auto");
    expect(normalizeKindMode(undefined)).toBe("auto");
  });

  it("flips kinds", () => {
    expect(flipKind("word")).toBe("sentence");
    expect(flipKind("sentence")).toBe("word");
  });
});

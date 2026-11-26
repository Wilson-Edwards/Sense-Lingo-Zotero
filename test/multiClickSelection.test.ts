import { describe, expect, it } from "vitest";

import { sentenceSelectionOffsets } from "../src/modules/reader/multiClickSelection";

function selected(text: string, needle: string): string {
  const offset = text.indexOf(needle);
  const range = sentenceSelectionOffsets(text, offset);
  if (!range) {
    throw new Error("expected a sentence range");
  }
  return text.slice(range.start, range.end);
}

describe("sentenceSelectionOffsets", () => {
  it("selects the English sentence under the pointer", () => {
    const text = "First sentence. The target is here! Last one.";
    expect(selected(text, "target")).toBe("The target is here!");
  });

  it("selects a Chinese sentence", () => {
    const text = "第一句。这里是目标句！最后一句。";
    expect(selected(text, "目标")).toBe("这里是目标句！");
  });

  it("does not split at abbreviations or decimals", () => {
    const text = "Smith et al. measured 3.14 units. Next sentence.";
    expect(selected(text, "measured")).toBe(
      "Smith et al. measured 3.14 units.",
    );
  });

  it("keeps closing quotes with the selected sentence", () => {
    const text = "He said, “This works!” Then he left.";
    expect(selected(text, "works")).toBe("He said, “This works!”");
    expect(selected(text, "left")).toBe("Then he left.");
    expect(selected('"Quoted sentence." Next one.', "Quoted")).toBe(
      '"Quoted sentence."',
    );
  });

  it("uses the following sentence when the click offset is on its leading space", () => {
    const text = "First sentence. Second sentence.";
    const range = sentenceSelectionOffsets(text, text.indexOf(" Second"));
    expect(range && text.slice(range.start, range.end)).toBe(
      "Second sentence.",
    );
  });
});

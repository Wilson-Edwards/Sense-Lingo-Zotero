import { describe, expect, it } from "vitest";

import { preferLiveSelectionText } from "../src/modules/reader/selectionAnchor";

describe("preferLiveSelectionText", () => {
  it("drops a visual line appended by Zotero", () => {
    const cases = [
      ["Effectiveness 症状缓解效果", "Effectiveness"],
      ["Reading 延伸阅读", "Reading"],
      ["Relaxation 4. 渐进式放松", "Relaxation"],
    ];
    for (const [annotation, live] of cases) {
      expect(preferLiveSelectionText(annotation, live)).toBe(live);
    }
  });

  it("accepts whitespace differences around the live selection", () => {
    expect(
      preferLiveSelectionText("Effectiveness\n症状缓解效果", " Effectiveness "),
    ).toBe("Effectiveness");
  });

  it("does not replace an annotation with a partial word", () => {
    expect(preferLiveSelectionText("Effectiveness", "Effect")).toBe(
      "Effectiveness",
    );
  });

  it("keeps unrelated or empty live selections out", () => {
    expect(preferLiveSelectionText("Effectiveness", "Meditation")).toBe(
      "Effectiveness",
    );
    expect(preferLiveSelectionText("Effectiveness", "")).toBe("Effectiveness");
  });
});

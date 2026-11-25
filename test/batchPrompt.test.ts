import { describe, expect, it } from "vitest";

import {
  buildBatchSystem,
  buildBatchUser,
  canBatch,
  chunkItems,
  countAnswerLines,
  parseBatchOutput,
} from "../src/modules/preprocess/batch";

function threeLines(meaning: string): string {
  return [`${meaning}（v.）`, "美式音标：/ˈtest/", "英式音标：/ˈtest/"].join(
    "\n",
  );
}

describe("chunkItems", () => {
  it("splits by item count", () => {
    const items = Array.from({ length: 5 }, (_unused, index) => ({
      word: `w${index}`,
      sentence: "short sentence",
    }));
    expect(chunkItems(items, { maxItems: 2, maxChars: 10_000 })).toHaveLength(
      3,
    );
  });

  it("splits by character budget", () => {
    const items = Array.from({ length: 4 }, (_unused, index) => ({
      word: `w${index}`,
      sentence: "x".repeat(300),
    }));
    const chunks = chunkItems(items, { maxItems: 100, maxChars: 700 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("gives an oversized item a chunk of its own", () => {
    const items = [
      { word: "a", sentence: "small" },
      { word: "b", sentence: "x".repeat(5000) },
      { word: "c", sentence: "small" },
    ];
    const chunks = chunkItems(items, { maxItems: 10, maxChars: 1000 });
    expect(chunks).toHaveLength(3);
    expect(chunks[1][0].word).toBe("b");
  });
});

describe("canBatch", () => {
  it("accepts templates without per-item variables", () => {
    expect(canBatch("You are a lexicographer. Target {targetLang}.")).toBe(
      true,
    );
  });

  it("rejects templates that interpolate the item", () => {
    expect(canBatch("Translate {text} in {sentence}")).toBe(false);
    expect(canBatch("Translate { word }")).toBe(false);
  });
});

describe("buildBatchSystem", () => {
  it("appends markers and the expected line count", () => {
    const system = buildBatchSystem("BASE", 3);
    expect(system.startsWith("BASE")).toBe(true);
    expect(system).toContain("[[1]]");
    expect(system).toContain("3 line(s)");
  });

  it("adapts to a one-line template", () => {
    const system = buildBatchSystem("BASE", 1);
    expect(system).toContain("1 line(s)");
    expect(system).not.toContain("<line 2 of item 1>");
  });
});

describe("buildBatchUser", () => {
  it("wraps each rendered user prompt in a marker block", () => {
    expect(buildBatchUser(["Sentence: A\nSelected text: x", "text"])).toBe(
      "[[1]]\nSentence: A\nSelected text: x\n[[2]]\ntext",
    );
  });
});

describe("countAnswerLines", () => {
  it("counts the normalized lines", () => {
    expect(countAnswerLines(threeLines("减轻"))).toBe(3);
    expect(countAnswerLines("只有一行")).toBe(1);
  });
});

describe("parseBatchOutput", () => {
  it("parses a well-formed answer", () => {
    const raw = `[[1]]\n${threeLines("减轻")}\n[[2]]\n${threeLines("提出")}\n`;
    const parsed = parseBatchOutput(raw, 2, 3);
    expect(parsed).toHaveLength(2);
    expect(parsed?.[0]).toContain("减轻");
    expect(parsed?.[1]).toContain("提出");
  });

  it("tolerates preamble and trailing commentary", () => {
    const raw = `Sure, here you go:\n[[1]]\n${threeLines(
      "减轻",
    )}\n[[2]]\n${threeLines("提出")}\nHope this helps.`;
    expect(parseBatchOutput(raw, 2, 3)).toHaveLength(2);
  });

  it("rejects a missing item", () => {
    const raw = `[[1]]\n${threeLines("减轻")}\n[[3]]\n${threeLines("提出")}`;
    expect(parseBatchOutput(raw, 2, 3)).toBeNull();
  });

  it("rejects duplicate or out-of-order markers", () => {
    const raw = `[[2]]\n${threeLines("a")}\n[[1]]\n${threeLines("b")}`;
    expect(parseBatchOutput(raw, 2, 3)).toBeNull();
    const duplicate = `[[1]]\n${threeLines("a")}\n[[1]]\n${threeLines("b")}`;
    expect(parseBatchOutput(duplicate, 2, 3)).toBeNull();
  });

  it("rejects a block with the wrong number of lines", () => {
    const raw = `[[1]]\n减轻（v.）\n[[2]]\n${threeLines("提出")}`;
    expect(parseBatchOutput(raw, 2, 3)).toBeNull();
  });

  it("rejects phonetic lines without a transcription", () => {
    const raw = [
      "[[1]]",
      "减轻（v.）",
      "美式音标：none",
      "英式音标：none",
      "[[2]]",
      ...threeLines("提出").split("\n"),
    ].join("\n");
    expect(parseBatchOutput(raw, 2, 3)).toBeNull();
  });

  it("supports a custom one-line template", () => {
    const raw = "[[1]]\n中文一\n[[2]]\n中文二";
    expect(parseBatchOutput(raw, 2, 1)).toEqual(["中文一", "中文二"]);
  });

  it("returns null when the count does not match", () => {
    const raw = `[[1]]\n${threeLines("a")}`;
    expect(parseBatchOutput(raw, 2, 3)).toBeNull();
  });
});

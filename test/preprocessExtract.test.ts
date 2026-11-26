import { describe, expect, it } from "vitest";

import { extractCandidates } from "../src/modules/preprocess/extract";

const OPTIONS = {
  maxSentenceChars: 400,
  maxSentencesPerWord: 1,
};

function words(sections: Parameters<typeof extractCandidates>[0]) {
  return extractCandidates(sections, OPTIONS).map((item) => item.wordKey);
}

describe("extractCandidates", () => {
  const chapter = {
    href: "OEBPS/ch1.xhtml",
    text:
      "Alpha beta gamma matters here. Alpha beta returns again. " +
      "Delta alone once. Second paragraph alpha beta.",
  };

  it("keeps words that occur only once", () => {
    const keys = new Set(words([chapter]));
    expect(keys.has("alpha")).toBe(true);
    expect(keys.has("beta")).toBe(true);
    expect(keys.has("gamma")).toBe(true);
    expect(keys.has("delta")).toBe(true);
  });

  it("keeps every distinct eligible word without a vocabulary cap", () => {
    const keys = new Set(
      words([
        {
          href: "OEBPS/ch1.xhtml",
          text: "Alpha beta gamma delta epsilon zeta eta theta iota kappa.",
        },
      ]),
    );
    expect(keys).toEqual(
      new Set([
        "alpha",
        "beta",
        "gamma",
        "delta",
        "epsilon",
        "zeta",
        "eta",
        "theta",
        "iota",
        "kappa",
      ]),
    );
  });

  it("skips stopwords", () => {
    const keys = new Set(words([chapter]));
    expect(keys.has("the")).toBe(false);
    expect(keys.has("here")).toBe(false);
    expect(keys.has("again")).toBe(false);
  });

  it("keeps short titles and words from short front-matter sections", () => {
    const keys = new Set(
      words([{ href: "OEBPS/nav.xhtml", text: "Tinyword" }, chapter]),
    );
    expect(keys.has("tinyword")).toBe(true);
  });

  it("drops hyphenated compounds and URL fragments", () => {
    const keys = new Set(
      extractCandidates(
        [
          {
            href: "OEBPS/ch2.xhtml",
            text:
              "A well-known idea. Another well-known idea. " +
              "See https://example.com/pathword now. Well-known again.",
          },
        ],
        OPTIONS,
      ).map((item) => item.wordKey),
    );
    expect(keys.has("well-known")).toBe(false);
    expect(keys.has("pathword")).toBe(false);
    expect(keys.has("example")).toBe(false);
  });

  it("samples at most maxSentencesPerWord sentences", () => {
    const sections = [{ href: "OEBPS/ch1.xhtml", text: chapter.text }];
    const one = extractCandidates(sections, {
      ...OPTIONS,
      maxSentencesPerWord: 1,
    });
    const three = extractCandidates(sections, {
      ...OPTIONS,
      maxSentencesPerWord: 3,
    });
    expect(one.filter((item) => item.wordKey === "alpha")).toHaveLength(1);
    expect(
      three.filter((item) => item.wordKey === "alpha").length,
    ).toBeGreaterThan(1);
  });

  it("deduplicates the same word inside one sentence", () => {
    const items = extractCandidates(
      [
        {
          href: "OEBPS/ch1.xhtml",
          text: "Echo echo echo appears repeatedly in this sentence. Echo appears again.",
        },
      ],
      { ...OPTIONS, maxSentencesPerWord: 5 },
    );
    const echo = items.filter((item) => item.wordKey === "echo");
    expect(echo).toHaveLength(2);
    expect(echo[0].occurrence).toBe(4);
  });

  it("reports the total occurrence count", () => {
    const items = extractCandidates(
      [{ href: "OEBPS/ch1.xhtml", text: chapter.text }],
      { ...OPTIONS, maxSentencesPerWord: 5 },
    );
    expect(items.find((item) => item.wordKey === "alpha")?.occurrence).toBe(3);
  });
});

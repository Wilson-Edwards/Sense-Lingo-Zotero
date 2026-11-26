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

  it("keeps every distinct token without a vocabulary cap", () => {
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

  it("keeps stopwords but drops single-letter words", () => {
    const keys = new Set(
      words([
        {
          href: "OEBPS/ch1.xhtml",
          text: "I am a word in the book. 我，爱中文。",
        },
      ]),
    );
    expect(keys.has("i")).toBe(false);
    expect(keys.has("a")).toBe(false);
    expect(keys.has("我")).toBe(false);
    expect(keys.has("爱中文")).toBe(true);
    expect(keys.has("am")).toBe(true);
    expect(keys.has("in")).toBe(true);
    expect(keys.has("the")).toBe(true);
  });

  it("can exclude candidates containing Han characters", () => {
    const items = extractCandidates(
      [
        {
          href: "OEBPS/bilingual.xhtml",
          text: "Database indexing improves queries. 数据库索引可以提高查询速度。 Mixed中文 token.",
        },
      ],
      { ...OPTIONS, languageFilter: "han" },
    );
    const keys = new Set(items.map((item) => item.wordKey));
    expect(keys.has("database")).toBe(true);
    expect(keys.has("indexing")).toBe(true);
    expect(keys.has("数据库索引可以提高查询速度")).toBe(false);
    expect(keys.has("mixed中文")).toBe(false);
  });

  it("defaults the system filter to the Zotero UI language", () => {
    const sections = [
      {
        href: "OEBPS/bilingual.xhtml",
        text: "English words remain here. 中文内容保留在这里。",
      },
    ];
    const chineseUi = new Set(
      extractCandidates(sections, {
        ...OPTIONS,
        languageFilter: "system",
        systemLocale: "zh-CN",
      }).map((item) => item.wordKey),
    );
    expect(chineseUi.has("english")).toBe(true);
    expect(chineseUi.has("中文内容保留在这里")).toBe(false);

    const englishUi = new Set(
      extractCandidates(sections, {
        ...OPTIONS,
        languageFilter: "system",
        systemLocale: "en-US",
      }).map((item) => item.wordKey),
    );
    expect(englishUi.has("english")).toBe(false);
    expect(englishUi.has("中文内容保留在这里")).toBe(true);
  });

  it("keeps short titles and words from short front-matter sections", () => {
    const keys = new Set(
      words([{ href: "OEBPS/nav.xhtml", text: "Tinyword" }, chapter]),
    );
    expect(keys.has("tinyword")).toBe(true);
  });

  it("keeps hyphenated compounds and URL fragments", () => {
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
    expect(keys.has("well-known")).toBe(true);
    expect(keys.has("https")).toBe(true);
    expect(keys.has("example")).toBe(true);
    expect(keys.has("com")).toBe(true);
    expect(keys.has("pathword")).toBe(true);
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

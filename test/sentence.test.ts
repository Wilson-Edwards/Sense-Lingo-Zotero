import { describe, expect, it } from "vitest";

import {
  isAbbreviationEnding,
  normalizeText,
  resolveSentence,
} from "../src/modules/reader/sentence";

describe("normalizeText", () => {
  it("glues hyphenated line breaks", () => {
    expect(normalizeText("A trans-\nlation unit.")).toBe("A translation unit.");
  });

  it("collapses whitespace runs and CRLF", () => {
    expect(normalizeText("a\r\n\r\n  b\t c")).toBe("a b c");
  });
});

describe("isAbbreviationEnding", () => {
  it("detects latin abbreviations", () => {
    const text = "Smith et al. reported it.";
    expect(isAbbreviationEnding(text, text.indexOf(". "))).toBe(true);
  });

  it("does not treat a normal word as an abbreviation", () => {
    const text = "This is noise. Next";
    expect(isAbbreviationEnding(text, text.indexOf("."))).toBe(false);
  });

  it("treats a single capital initial as an abbreviation", () => {
    const text = "J. Smith wrote it.";
    expect(isAbbreviationEnding(text, text.indexOf("."))).toBe(true);
  });
});

describe("resolveSentence", () => {
  const text =
    "First sentence here. The proposed method can mitigate noise. Third one.";

  it("returns the sentence containing the needle", () => {
    const ctx = resolveSentence(text, "mitigate");
    expect(ctx?.sentence).toBe("The proposed method can mitigate noise.");
  });

  it("returns the neighbouring sentences", () => {
    const ctx = resolveSentence(text, "mitigate");
    expect(ctx?.prevSentence).toBe("First sentence here.");
    expect(ctx?.nextSentence).toBe("Third one.");
  });

  it("returns null when the needle is absent", () => {
    expect(resolveSentence(text, "nonexistent")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(resolveSentence("", "a")).toBeNull();
    expect(resolveSentence(text, "   ")).toBeNull();
  });

  it("does not split on abbreviations", () => {
    const ctx = resolveSentence(
      "Smith et al. reported this finding. Next sentence here.",
      "reported",
    );
    expect(ctx?.sentence).toBe("Smith et al. reported this finding.");
  });

  it("does not split on decimal points", () => {
    const ctx = resolveSentence(
      "The value is 3.14 in this test. Another one follows.",
      "value",
    );
    expect(ctx?.sentence).toBe("The value is 3.14 in this test.");
  });

  it("prefers a match on word boundaries", () => {
    const ctx = resolveSentence("Nobody knows. The no is here.", "no");
    expect(ctx?.sentence).toBe("The no is here.");
    expect(ctx?.matchCount).toBeGreaterThan(1);
  });

  it("works case-insensitively", () => {
    const ctx = resolveSentence("We Use Pytorch here. Done.", "pytorch");
    expect(ctx?.sentence).toBe("We Use Pytorch here.");
  });

  it("counts all occurrences", () => {
    const ctx = resolveSentence("no meaning. no context.", "no");
    expect(ctx?.matchCount).toBe(2);
  });

  it("truncates long sentences at a word boundary", () => {
    const long = `${"word ".repeat(40)}target ${"tail ".repeat(40)}.`;
    const ctx = resolveSentence(long, "target", { maxChars: 60 });
    expect(ctx?.truncated).toBe(true);
    expect(ctx?.sentence.length).toBeLessThanOrEqual(60);
    expect(ctx?.sentence.endsWith(" ")).toBe(false);
  });

  it("keeps a hyphenated word searchable", () => {
    const ctx = resolveSentence(
      "This trans-\nlation is fine. Next one.",
      "translation",
    );
    expect(ctx?.sentence).toBe("This translation is fine.");
  });

  it("ignores soft hyphens and zero-width characters", () => {
    const ctx = resolveSentence(
      "The proposed method can miti\u00ADgate noise. Next one.",
      "mitigate",
    );
    expect(ctx?.sentence).toBe("The proposed method can mitigate noise.");
  });

  it("treats non-breaking spaces as spaces", () => {
    const ctx = resolveSentence(
      "Results\u00A0suggest noise. Next one.",
      "suggest",
    );
    expect(ctx?.sentence).toBe("Results suggest noise.");
  });

  it("matches across extra whitespace inside a word (EPUB reflow)", () => {
    const ctx = resolveSentence(
      "The pro posed method can mitigate noise. Next one.",
      "proposed",
    );
    expect(ctx?.sentence).toBe("The pro posed method can mitigate noise.");
  });

  it("matches when the needle carries whitespace the text does not", () => {
    const ctx = resolveSentence(
      "The proposed method works. Next.",
      "pro posed",
    );
    expect(ctx?.sentence).toBe("The proposed method works.");
  });

  it("disambiguates repeated whitespace-insensitive EPUB matches", () => {
    const ctx = resolveSentence(
      "First pro posed result. Second pro posed target.",
      "proposed",
      {
        fingerprint: { before: "Second ", after: " target." },
      },
    );
    expect(ctx?.sentence).toBe("Second pro posed target.");
    expect(ctx?.matchCount).toBe(2);
  });

  it("compares loose EPUB fingerprints without whitespace", () => {
    const ctx = resolveSentence(
      "A proposed old result. The sec ond pro posed method works.",
      "proposed",
      {
        fingerprint: {
          before: "The second ",
          after: " method works.",
        },
      },
    );
    expect(ctx?.sentence).toBe("The sec ond pro posed method works.");
  });

  it("returns empty neighbours at the edges of the text", () => {
    const first = resolveSentence("Only one sentence here.", "one");
    expect(first?.prevSentence).toBe("");
    expect(first?.nextSentence).toBe("");
  });
});

describe("fingerprint disambiguation", () => {
  const text = "The cat sat. A dog ran. The cat ate.";

  it("falls back to the first occurrence without a fingerprint", () => {
    expect(resolveSentence(text, "cat")?.sentence).toBe("The cat sat.");
  });

  it("picks the occurrence that matches the surrounding text", () => {
    const ctx = resolveSentence(text, "cat", {
      fingerprint: { before: "The dog ran. The ", after: " ate." },
    });
    expect(ctx?.sentence).toBe("The cat ate.");
  });

  it("finds the right chapter of a whole book", () => {
    const book =
      "Chapter one. The method can mitigate noise here. " +
      "Chapter two. A second use of mitigate appears.";
    const ctx = resolveSentence(book, "mitigate", {
      fingerprint: {
        before: "Chapter two. A second use of ",
        after: " appears.",
      },
    });
    // `Chapter two.` is its own sentence, so the context starts after it.
    expect(ctx?.sentence).toBe("A second use of mitigate appears.");
  });

  it("ignores an unhelpful fingerprint instead of guessing wildly", () => {
    const ctx = resolveSentence(text, "cat", {
      fingerprint: { before: "totally unrelated ", after: " nothing" },
    });
    expect(ctx?.sentence).toBe("The cat sat.");
  });
});

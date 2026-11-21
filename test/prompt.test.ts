import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROFILES,
  WORD_PROFILE_ID,
  SENTENCE_PROFILE_ID,
  getProfile,
  parseProfiles,
  resolveProfileId,
  stringifyProfiles,
} from "../src/modules/llm/prompt";
import { renderPrompt, renderPromptFor } from "../src/modules/llm/render";
import { resolveSentence } from "../src/modules/reader/sentence";

const context = resolveSentence(
  "Intro here. The method can mitigate noise. Outro here.",
  "mitigate",
);

describe("parseProfiles", () => {
  it("falls back to built-ins for empty input", () => {
    const profiles = parseProfiles("");
    expect(Object.keys(profiles)).toEqual(Object.keys(DEFAULT_PROFILES));
    expect(profiles[WORD_PROFILE_ID].kind).toBe("word");
    expect(profiles[SENTENCE_PROFILE_ID].kind).toBe("sentence");
  });

  it("survives broken JSON", () => {
    expect(() => parseProfiles("{ not json")).not.toThrow();
    expect(parseProfiles("{ not json")[WORD_PROFILE_ID]).toBeDefined();
  });

  it("merges user profiles on top of built-ins", () => {
    const profiles = parseProfiles(
      JSON.stringify({
        mine: { name: "Mine", system: "S", user: "U {text}" },
      }),
    );
    expect(profiles.mine.name).toBe("Mine");
    expect(profiles[WORD_PROFILE_ID]).toBeDefined();
  });

  it("drops malformed entries", () => {
    const profiles = parseProfiles(
      JSON.stringify({ bad: { name: "no templates" } }),
    );
    expect(profiles.bad).toBeUndefined();
  });

  it("round-trips through stringify", () => {
    const raw = stringifyProfiles(parseProfiles(""));
    expect(Object.keys(parseProfiles(raw))).toEqual(
      Object.keys(DEFAULT_PROFILES),
    );
  });
});

describe("routing", () => {
  it("routes word selections to the word profile key", () => {
    expect(resolveProfileId("word", "my-word", "my-sentence")).toBe("my-word");
  });

  it("routes sentence selections to the sentence profile key", () => {
    expect(resolveProfileId("sentence", "my-word", "my-sentence")).toBe(
      "my-sentence",
    );
  });

  it("falls back to the built-in id when a key is blank", () => {
    expect(resolveProfileId("word", "  ", "")).toBe(WORD_PROFILE_ID);
    expect(resolveProfileId("sentence", "", undefined)).toBe(
      SENTENCE_PROFILE_ID,
    );
  });

  it("reports a fallback for dangling ids", () => {
    const resolved = getProfile(parseProfiles(""), "nope", "word");
    expect(resolved.profileId).toBe(WORD_PROFILE_ID);
    expect(resolved.usedFallback).toBe(true);
  });

  it("does not fall back for valid ids", () => {
    const resolved = getProfile(parseProfiles(""), "word-casual", "word");
    expect(resolved.profileId).toBe("word-casual");
    expect(resolved.usedFallback).toBe(false);
  });
});

describe("renderPrompt", () => {
  it("replaces known variables", () => {
    expect(renderPrompt("A {text} B", { text: "X" })).toBe("A X B");
  });

  it("leaves unknown variables untouched", () => {
    expect(renderPrompt("{text} {unknown}", { text: "X" })).toBe("X {unknown}");
  });

  it("tolerates spaces inside braces", () => {
    expect(renderPrompt("{ text }", { text: "X" })).toBe("X");
  });

  it("does not touch LaTeX braces", () => {
    expect(renderPrompt("\\frac{a}{b} {text}", { text: "X" })).toBe(
      "\\frac{a}{b} X",
    );
  });

  it("returns an empty string for an empty template", () => {
    expect(renderPrompt("", { text: "X" })).toBe("");
  });
});

describe("renderPromptFor", () => {
  const base = {
    profiles: parseProfiles(""),
    text: "mitigate",
    context,
    targetLang: "zh-CN",
    sourceLang: "auto",
  };

  it("injects the containing sentence for words", () => {
    const rendered = renderPromptFor({ ...base, kind: "word" });
    expect(rendered.profileId).toBe(WORD_PROFILE_ID);
    expect(rendered.vars.sentence).toBe("The method can mitigate noise.");
    expect(rendered.user).toContain("The method can mitigate noise.");
    expect(rendered.system).toContain("zh-CN");
  });

  it("keeps {sentence} empty for sentences so the model does not echo", () => {
    const rendered = renderPromptFor({
      ...base,
      kind: "sentence",
      text: "The method can mitigate noise.",
    });
    expect(rendered.profileId).toBe(SENTENCE_PROFILE_ID);
    expect(rendered.vars.sentence).toBe("");
    expect(rendered.user).toBe("The method can mitigate noise.");
  });

  it("hides neighbours unless they are enabled", () => {
    const off = renderPromptFor({ ...base, kind: "sentence" });
    expect(off.vars.prevSentence).toBe("");

    const on = renderPromptFor({
      ...base,
      kind: "sentence",
      includeNeighbors: true,
    });
    expect(on.vars.prevSentence).toBe("Intro here.");
    expect(on.vars.nextSentence).toBe("Outro here.");
  });

  it("exposes the selection type", () => {
    const rendered = renderPromptFor({ ...base, kind: "word" });
    expect(rendered.vars.selectionType).toBe("word");
  });

  it("honours an explicitly configured profile", () => {
    const rendered = renderPromptFor({
      ...base,
      kind: "word",
      wordProfileId: "word-casual",
    });
    expect(rendered.profileId).toBe("word-casual");
    expect(rendered.profileName).toBe("划词 · 只要中文意思");
  });
});

describe("default word profile", () => {
  const base = {
    profiles: parseProfiles(""),
    text: "mitigate",
    context,
    targetLang: "zh-CN",
    sourceLang: "auto",
  };

  it("requests meaning, US IPA and UK IPA on separate lines", () => {
    const system = DEFAULT_PROFILES[WORD_PROFILE_ID].system;
    expect(system).toContain("美式音标：");
    expect(system).toContain("英式音标：");
    expect(system).toContain("each on its own line");
    expect(system).not.toMatch(/no pronunciation/i);
  });

  it("renders the request into the word system prompt", () => {
    const rendered = renderPromptFor({ ...base, kind: "word" });
    expect(rendered.system).toContain("美式音标：");
    expect(rendered.system).toContain("英式音标：");
    expect(rendered.system).toContain("zh-CN");
    expect(rendered.system).not.toContain("{targetLang}");
  });

  it("keeps phonetics out of the sentence profile", () => {
    expect(DEFAULT_PROFILES[SENTENCE_PROFILE_ID].system).not.toContain("音标");
  });
});

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROFILES,
  EDITABLE_PROFILE_IDS,
  SENTENCE_PROFILE_ID,
  WORD_PROFILE_ID,
  buildProfiles,
  getProfile,
  isDefaultProfiles,
  parseProfiles,
  readProfileTemplates,
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
  it("falls back to the two built-in slots for empty input", () => {
    const profiles = parseProfiles("");
    expect(Object.keys(profiles)).toEqual([...EDITABLE_PROFILE_IDS]);
    expect(profiles[WORD_PROFILE_ID].kind).toBe("word");
    expect(profiles[SENTENCE_PROFILE_ID].kind).toBe("sentence");
  });

  it("survives broken JSON", () => {
    expect(() => parseProfiles("{ not json")).not.toThrow();
    expect(parseProfiles("{ not json")[WORD_PROFILE_ID]).toBeDefined();
  });

  it("keeps only the two editable slots", () => {
    const profiles = parseProfiles(
      JSON.stringify({
        word: {
          name: "ignored",
          system: "CUSTOM {targetLang}",
          user: "{text}",
        },
        mine: { name: "Mine", system: "S", user: "U {text}" },
      }),
    );
    expect(profiles[WORD_PROFILE_ID].system).toBe("CUSTOM {targetLang}");
    expect(profiles[WORD_PROFILE_ID].name).toBe("划词 · 语境辨析");
    expect(profiles.mine).toBeUndefined();
  });

  it("drops a slot whose templates are malformed", () => {
    const profiles = parseProfiles(
      JSON.stringify({ word: { name: "no templates" } }),
    );
    expect(profiles[WORD_PROFILE_ID].system).toBe(
      DEFAULT_PROFILES[WORD_PROFILE_ID].system,
    );
  });

  it("round-trips through stringify", () => {
    const raw = stringifyProfiles(parseProfiles(""));
    expect(Object.keys(parseProfiles(raw))).toEqual([
      WORD_PROFILE_ID,
      SENTENCE_PROFILE_ID,
    ]);
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

  it("does not fall back for the built-in slots", () => {
    const word = getProfile(parseProfiles(""), WORD_PROFILE_ID, "word");
    expect(word.profileId).toBe(WORD_PROFILE_ID);
    expect(word.usedFallback).toBe(false);

    const sentence = getProfile(
      parseProfiles(""),
      SENTENCE_PROFILE_ID,
      "sentence",
    );
    expect(sentence.profileId).toBe(SENTENCE_PROFILE_ID);
    expect(sentence.usedFallback).toBe(false);
  });
});

describe("editable profile templates", () => {
  it("exposes exactly the two built-in slots", () => {
    expect(Object.keys(DEFAULT_PROFILES)).toEqual([
      WORD_PROFILE_ID,
      SENTENCE_PROFILE_ID,
    ]);
  });

  it("reads the built-in prompts when nothing is stored", () => {
    const templates = readProfileTemplates(parseProfiles(""));
    expect(templates.word).toBe(DEFAULT_PROFILES[WORD_PROFILE_ID].system);
    expect(templates.sentence).toBe(
      DEFAULT_PROFILES[SENTENCE_PROFILE_ID].system,
    );
  });

  it("reads a stored override", () => {
    const profiles = parseProfiles(
      JSON.stringify({ word: { system: "custom word", user: "{text}" } }),
    );
    expect(readProfileTemplates(profiles).word).toBe("custom word");
  });

  it("builds the two slots from the textareas and keeps newlines", () => {
    const profiles = buildProfiles({
      word: "Line one\nLine two {targetLang}",
      sentence: "Sentence prompt",
    });
    expect(Object.keys(profiles)).toEqual([
      WORD_PROFILE_ID,
      SENTENCE_PROFILE_ID,
    ]);
    expect(profiles[WORD_PROFILE_ID].system).toBe(
      "Line one\nLine two {targetLang}",
    );
    expect(profiles[SENTENCE_PROFILE_ID].system).toBe("Sentence prompt");
    expect(profiles[WORD_PROFILE_ID].user).toBe(
      DEFAULT_PROFILES[WORD_PROFILE_ID].user,
    );
  });

  it("restores the built-in prompt when a textarea is blank", () => {
    const profiles = buildProfiles({ word: "   ", sentence: "custom" });
    expect(profiles[WORD_PROFILE_ID].system).toBe(
      DEFAULT_PROFILES[WORD_PROFILE_ID].system,
    );
    expect(profiles[SENTENCE_PROFILE_ID].system).toBe("custom");
  });

  it("keeps a legacy user template when the system prompt changes", () => {
    const current = parseProfiles(
      JSON.stringify({ word: { system: "old", user: "Custom {text}" } }),
    );
    const profiles = buildProfiles({ word: "new", sentence: "s" }, current);
    expect(profiles[WORD_PROFILE_ID].user).toBe("Custom {text}");
  });

  it("detects when both slots are unchanged", () => {
    expect(isDefaultProfiles(parseProfiles(""))).toBe(true);
    expect(
      isDefaultProfiles(buildProfiles({ word: "custom", sentence: "s" })),
    ).toBe(false);
    expect(
      isDefaultProfiles(buildProfiles(readProfileTemplates(parseProfiles("")))),
    ).toBe(true);
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
      profiles: {
        ...base.profiles,
        mine: {
          name: "Mine",
          kind: "word",
          system: "Translate into {targetLang}.",
          user: "{text}",
        },
      },
      kind: "word",
      wordProfileId: "mine",
    });
    expect(rendered.profileId).toBe("mine");
    expect(rendered.profileName).toBe("Mine");
    expect(rendered.system).toBe("Translate into zh-CN.");
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

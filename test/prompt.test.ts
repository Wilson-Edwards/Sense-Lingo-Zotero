import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROFILES,
  DEFAULT_PROFILE_ID,
  SENTENCE_PROFILE_ID,
  WORD_PROFILE_ID,
  activeProfileId,
  addProfile,
  defaultSystemFor,
  getProfile,
  isBuiltinProfileId,
  isDefaultProfiles,
  nextProfileId,
  parseProfiles,
  profileKind,
  profileList,
  removeProfile,
  resolveProfileId,
  stringifyProfiles,
  updateProfile,
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
    expect(Object.keys(profiles)).toEqual([
      WORD_PROFILE_ID,
      SENTENCE_PROFILE_ID,
    ]);
    expect(profiles[WORD_PROFILE_ID].kind).toBe("word");
    expect(profiles[SENTENCE_PROFILE_ID].kind).toBe("sentence");
  });

  it("survives broken JSON", () => {
    expect(() => parseProfiles("{ not json")).not.toThrow();
    expect(parseProfiles("{ not json")[WORD_PROFILE_ID]).toBeDefined();
  });

  it("keeps custom presets alongside the built-ins", () => {
    const profiles = parseProfiles(
      JSON.stringify({
        word: {
          name: "ignored",
          system: "CUSTOM {targetLang}",
          user: "{text}",
        },
        mine: { name: "Mine", kind: "word", system: "S", user: "U {text}" },
      }),
    );
    expect(profiles[WORD_PROFILE_ID].system).toBe("CUSTOM {targetLang}");
    expect(profiles.mine.name).toBe("Mine");
    expect(profiles.mine.system).toBe("S");
  });

  it("infers the kind of a custom preset from its id", () => {
    const profiles = parseProfiles(
      JSON.stringify({
        "sentence-literal": { name: "Literal", system: "S", user: "U" },
        "word-term": { name: "Term", system: "S", user: "U" },
      }),
    );
    expect(profiles["sentence-literal"].kind).toBe("sentence");
    expect(profiles["word-term"].kind).toBe("word");
  });

  it("defaults a custom preset's envelope instead of dropping it", () => {
    const profiles = parseProfiles(
      JSON.stringify({ mine: { system: "Only a system prompt" } }),
    );
    expect(profiles.mine.user).toBe(DEFAULT_PROFILES[WORD_PROFILE_ID].user);
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

describe("prompt library", () => {
  it("lists one kind with the built-in first", () => {
    const profiles = parseProfiles(
      JSON.stringify({
        "word-b": { name: "B", kind: "word", system: "S", user: "U" },
        "word-a": { name: "A", kind: "word", system: "S", user: "U" },
        "sentence-x": { name: "X", kind: "sentence", system: "S", user: "U" },
      }),
    );
    expect(profileList(profiles, "word").map((entry) => entry.id)).toEqual([
      WORD_PROFILE_ID,
      "word-b",
      "word-a",
    ]);
    expect(profileList(profiles, "sentence").map((entry) => entry.id)).toEqual([
      SENTENCE_PROFILE_ID,
      "sentence-x",
    ]);
  });

  it("generates a free id per kind", () => {
    expect(nextProfileId(parseProfiles(""), "word")).toBe("word-2");
    const twice = addProfile(
      addProfile(parseProfiles(""), "word").profiles,
      "word",
    );
    expect(twice.id).toBe("word-3");
    expect(nextProfileId(parseProfiles(""), "sentence")).toBe("sentence-2");
  });

  it("seeds a new preset from the built-in of its kind", () => {
    const { profiles, id } = addProfile(parseProfiles(""), "sentence", {
      name: "直译",
    });
    expect(id).toBe("sentence-2");
    expect(profiles[id].name).toBe("直译");
    expect(profiles[id].kind).toBe("sentence");
    expect(profiles[id].system).toBe(
      DEFAULT_PROFILES[SENTENCE_PROFILE_ID].system,
    );
  });

  it("copies an existing preset when asked", () => {
    const custom = updateProfile(parseProfiles(""), WORD_PROFILE_ID, {
      system: "Mine {targetLang}",
    });
    const { profiles, id } = addProfile(custom, "word", {
      basedOn: WORD_PROFILE_ID,
      name: "副本",
    });
    expect(profiles[id].system).toBe("Mine {targetLang}");
  });

  it("updates a preset and keeps the name when it is cleared", () => {
    const edited = updateProfile(parseProfiles(""), WORD_PROFILE_ID, {
      name: "  ",
      system: "New system",
    });
    expect(edited[WORD_PROFILE_ID].name).toBe(
      DEFAULT_PROFILES[WORD_PROFILE_ID].name,
    );
    expect(edited[WORD_PROFILE_ID].system).toBe("New system");
  });

  it("never deletes a built-in preset", () => {
    const profiles = parseProfiles("");
    expect(isBuiltinProfileId(WORD_PROFILE_ID)).toBe(true);
    expect(removeProfile(profiles, WORD_PROFILE_ID)).toBe(profiles);
  });

  it("deletes a custom preset without touching the built-ins", () => {
    const { profiles, id } = addProfile(parseProfiles(""), "word");
    const trimmed = removeProfile(profiles, id);
    expect(trimmed[id]).toBeUndefined();
    expect(trimmed[WORD_PROFILE_ID]).toBeDefined();
  });

  it("knows when the library is just the built-ins", () => {
    expect(isDefaultProfiles(parseProfiles(""))).toBe(true);
    const custom = updateProfile(parseProfiles(""), WORD_PROFILE_ID, {
      system: "custom",
    });
    expect(isDefaultProfiles(custom)).toBe(false);
    expect(
      isDefaultProfiles(addProfile(parseProfiles(""), "word").profiles),
    ).toBe(false);
  });

  it("resolves the active id, falling back to the first of the kind", () => {
    const { profiles, id } = addProfile(parseProfiles(""), "word", {
      name: "Mine",
    });
    expect(activeProfileId(profiles, "word", id)).toBe(id);
    expect(activeProfileId(profiles, "word", "deleted")).toBe(WORD_PROFILE_ID);

    const withoutBuiltin = { ...profiles };
    delete withoutBuiltin[WORD_PROFILE_ID];
    expect(activeProfileId(withoutBuiltin, "word", "deleted")).toBe(id);
  });

  it("derives the kind from the id when needed", () => {
    expect(profileKind("sentence-2")).toBe("sentence");
    expect(profileKind("academic")).toBe("word");
    expect(
      profileKind("word", { ...DEFAULT_PROFILES.word, kind: "sentence" }),
    ).toBe("sentence");
  });

  it("exposes the built-in system prompt of a kind", () => {
    expect(defaultSystemFor("word")).toBe(
      DEFAULT_PROFILES[WORD_PROFILE_ID].system,
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

  it("falls back to another preset of the same kind", () => {
    const { profiles, id } = addProfile(parseProfiles(""), "word", {
      name: "Mine",
    });
    const withoutBuiltin = { ...profiles };
    delete withoutBuiltin[WORD_PROFILE_ID];
    const resolved = getProfile(withoutBuiltin, "nope", "word");
    expect(resolved.profileId).toBe(id);
    expect(resolved.profileName).toBe("Mine");
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

  it("keeps the built-in id of each kind addressable", () => {
    expect(DEFAULT_PROFILE_ID.word).toBe(WORD_PROFILE_ID);
    expect(DEFAULT_PROFILE_ID.sentence).toBe(SENTENCE_PROFILE_ID);
  });
});

describe("editable templates", () => {
  it("exposes exactly the two built-in slots by default", () => {
    expect(Object.keys(DEFAULT_PROFILES)).toEqual([
      WORD_PROFILE_ID,
      SENTENCE_PROFILE_ID,
    ]);
  });

  it("keeps newlines and variables in a stored override", () => {
    const profiles = parseProfiles(
      JSON.stringify({
        word: { system: "Line one\nLine two {targetLang}", user: "{text}" },
      }),
    );
    expect(profiles[WORD_PROFILE_ID].system).toBe(
      "Line one\nLine two {targetLang}",
    );
  });

  it("restores the built-in prompt when the stored system is blank", () => {
    const profiles = parseProfiles(
      JSON.stringify({ word: { system: "   ", user: "{text}" } }),
    );
    expect(profiles[WORD_PROFILE_ID].system).toBe(
      DEFAULT_PROFILES[WORD_PROFILE_ID].system,
    );
  });

  it("keeps a custom user envelope when the system prompt changes", () => {
    const current = parseProfiles(
      JSON.stringify({ word: { system: "old", user: "Custom {text}" } }),
    );
    const profiles = updateProfile(current, WORD_PROFILE_ID, {
      system: "new",
    });
    expect(profiles[WORD_PROFILE_ID].user).toBe("Custom {text}");
    expect(profiles[WORD_PROFILE_ID].system).toBe("new");
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

  it("lets a per-run preset override the per-kind default", () => {
    const profiles = {
      ...base.profiles,
      mine: {
        name: "Mine",
        kind: "sentence" as const,
        system: "Literal: {text}",
        user: "{text}",
      },
    };
    const rendered = renderPromptFor({
      ...base,
      profiles,
      kind: "sentence",
      sentenceProfileId: SENTENCE_PROFILE_ID,
      profileId: "mine",
    });
    expect(rendered.profileId).toBe("mine");
    expect(rendered.system).toBe("Literal: mitigate");
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

  it("keeps phonetics for single-word proper nouns and brand names", () => {
    const system = DEFAULT_PROFILES[WORD_PROFILE_ID].system;
    expect(system).toContain("proper noun");
    expect(system).toContain("Thoreau");
    expect(system).toContain("Walden");
    expect(system).toContain("iPhone");
    expect(system).toContain("person's name");
    expect(system).toContain("Never skip");
    expect(system).not.toContain("Shape");
  });

  it("renders a proper-noun lookup with its sentence context", () => {
    const properContext = resolveSentence(
      "In Walden, Thoreau famously writes",
      "Thoreau",
    );
    const rendered = renderPromptFor({
      ...base,
      text: "Thoreau",
      context: properContext,
      kind: "word",
    });
    expect(rendered.system).toContain("proper noun");
    expect(rendered.user).toContain("In Walden, Thoreau famously writes");
    expect(rendered.user).toContain("Selected text: Thoreau");
  });

  it("renders a brand-name lookup as a shape A request", () => {
    const rendered = renderPromptFor({
      ...base,
      text: "iPhone",
      kind: "word",
    });
    expect(rendered.system).toContain('brand or product ("iPhone")');
    expect(rendered.system).toContain("exactly three lines");
    expect(rendered.user).toContain("Selected text: iPhone");
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

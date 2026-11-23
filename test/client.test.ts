import { describe, expect, it } from "vitest";

import {
  LlmError,
  buildChatEndpoint,
  normalizeBaseURL,
  parseChatCompletion,
  parseStreamChunk,
} from "../src/modules/llm/client";

describe("normalizeBaseURL", () => {
  it("keeps a full path", () => {
    expect(normalizeBaseURL("https://api.deepseek.com/v1")).toBe(
      "https://api.deepseek.com/v1",
    );
  });

  it("appends /v1 to a bare host", () => {
    expect(normalizeBaseURL("https://api.openai.com")).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("strips trailing slashes", () => {
    expect(normalizeBaseURL("https://x.dev/v1///")).toBe("https://x.dev/v1");
  });
});

describe("buildChatEndpoint", () => {
  it("builds the chat completions URL", () => {
    expect(buildChatEndpoint("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("does not duplicate an existing suffix", () => {
    expect(buildChatEndpoint("https://gateway.local/v1/chat/completions")).toBe(
      "https://gateway.local/v1/chat/completions",
    );
  });
});

describe("parseChatCompletion", () => {
  it("reads a string message", () => {
    expect(
      parseChatCompletion({
        model: "gpt-test",
        choices: [{ message: { content: " 译文 " } }],
      }),
    ).toEqual({ content: "译文", model: "gpt-test" });
  });

  it("joins array content parts", () => {
    expect(
      parseChatCompletion({
        choices: [{ message: { content: [{ text: "a" }, "b"] } }],
      }).content,
    ).toBe("ab");
  });

  it("throws EMPTY on an empty message", () => {
    expect(() => parseChatCompletion({ choices: [] })).toThrowError(LlmError);
    try {
      parseChatCompletion({ choices: [] });
    } catch (e) {
      expect((e as LlmError).code).toBe("EMPTY");
    }
  });

  it("throws on a non-object payload", () => {
    expect(() => parseChatCompletion("nope")).toThrowError(LlmError);
  });

  describe("parseStreamChunk", () => {
    it("reads the delta text and model", () => {
      expect(
        parseStreamChunk({
          model: "gpt-test",
          choices: [{ delta: { content: "减" } }],
        }),
      ).toEqual({ delta: "减", model: "gpt-test" });
    });

    it("joins array delta parts", () => {
      expect(
        parseStreamChunk({
          choices: [{ delta: { content: [{ text: "a" }, "b"] } }],
        }).delta,
      ).toBe("ab");
    });

    it("returns an empty delta when there is no content", () => {
      expect(parseStreamChunk({ choices: [{ delta: {} }] })).toEqual({
        delta: "",
        model: undefined,
      });
      expect(parseStreamChunk(null)).toEqual({ delta: "" });
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  EMPTY_PROVIDER_CREDENTIALS,
  parkProviderCredentials,
  parseProviderCredentials,
  parseProviderId,
  resolveProviderConfig,
  resolveProviderOverride,
  serializeProviderCredentials,
  switchProviderCredentials,
} from "../src/modules/llm/providers";

const openaiValues = {
  apiKey: "sk-openai",
  baseURL: "",
  model: "gpt-4o-mini",
};

const deepseekValues = {
  apiKey: "sk-deepseek",
  baseURL: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
};

describe("provider credentials", () => {
  it("round-trips stored values through the JSON pref", () => {
    const credentials = {
      openai: openaiValues,
      deepseek: deepseekValues,
    };
    const raw = serializeProviderCredentials(credentials);
    expect(JSON.parse(raw)).toEqual(credentials);
    expect(parseProviderCredentials(raw)).toEqual(credentials);
  });

  it("ignores empty, malformed and unknown data", () => {
    expect(parseProviderCredentials("")).toEqual({});
    expect(parseProviderCredentials("   ")).toEqual({});
    expect(parseProviderCredentials("not json")).toEqual({});
    expect(parseProviderCredentials("[]")).toEqual({});
    expect(parseProviderCredentials('{"nope":{"apiKey":"k"}}')).toEqual({});
    expect(parseProviderCredentials('{"openai":"oops"}')).toEqual({});
  });

  it("keeps partial records and falls back to empty strings", () => {
    expect(parseProviderCredentials('{"openai":{"apiKey":"k"}}')).toEqual({
      openai: { apiKey: "k", baseURL: "", model: "" },
    });
  });

  it("serializes blank records to an empty pref", () => {
    expect(serializeProviderCredentials({})).toBe("");
    expect(
      serializeProviderCredentials({
        openai: { apiKey: " ", baseURL: "", model: "" },
      }),
    ).toBe("");
  });

  it("parks the active values and loads the target provider", () => {
    const first = switchProviderCredentials(
      {},
      "openai",
      "deepseek",
      openaiValues,
    );
    expect(first.credentials.openai).toEqual(openaiValues);
    expect(first.values).toEqual(EMPTY_PROVIDER_CREDENTIALS);

    const second = switchProviderCredentials(
      first.credentials,
      "deepseek",
      "openai",
      deepseekValues,
    );
    expect(second.credentials.deepseek).toEqual(deepseekValues);
    expect(second.values).toEqual(openaiValues);
  });

  it("does not leak values into a provider that has never been saved", () => {
    const result = switchProviderCredentials(
      {},
      "openai",
      "custom",
      openaiValues,
    );
    expect(result.values).toEqual(EMPTY_PROVIDER_CREDENTIALS);
  });

  it("drops the parked entry when the user cleared every field", () => {
    const result = switchProviderCredentials(
      { openai: openaiValues },
      "openai",
      "deepseek",
      { apiKey: "", baseURL: "", model: "" },
    );
    expect(result.credentials).toEqual({});
    expect(result.values).toEqual(EMPTY_PROVIDER_CREDENTIALS);
  });

  it("keeps the saved copy when the provider does not actually change", () => {
    const credentials = { openai: openaiValues };
    const result = switchProviderCredentials(credentials, "openai", "openai", {
      apiKey: "",
      baseURL: "",
      model: "",
    });
    expect(result.credentials).toBe(credentials);
    expect(result.values).toEqual({
      apiKey: "",
      baseURL: "",
      model: "",
    });
  });

  it("parks one provider's values without loading another", () => {
    const parked = parkProviderCredentials({}, "deepseek", deepseekValues);
    expect(parked).toEqual({ deepseek: deepseekValues });

    // Clearing every field drops the archived entry instead of storing blanks.
    expect(
      parkProviderCredentials(parked, "deepseek", {
        apiKey: " ",
        baseURL: "",
        model: "",
      }),
    ).toEqual({});
  });
});

describe("parseProviderId", () => {
  it('distinguishes a real preset from "nothing chosen"', () => {
    expect(parseProviderId("deepseek")).toBe("deepseek");
    expect(parseProviderId("clinepass")).toBe("clinepass");
    expect(parseProviderId("")).toBeNull();
    expect(parseProviderId("   ")).toBeNull();
    expect(parseProviderId("nope")).toBeNull();
    expect(parseProviderId(undefined)).toBeNull();
    expect(parseProviderId(42)).toBeNull();
  });
});

describe("resolveProviderOverride", () => {
  const translation = resolveProviderConfig({
    provider: "openai",
    apiKey: "sk-openai",
    temperature: 0.2,
    maxTokens: 512,
    timeoutMs: 10000,
    stream: false,
  });

  it("follows the fallback while no provider is chosen", () => {
    expect(resolveProviderOverride(translation, "", {})).toBe(translation);
    expect(
      resolveProviderOverride(translation, "nope", { apiKey: "sk-x" }),
    ).toBe(translation);
  });

  it("uses its own key, URL and model but keeps the request knobs", () => {
    const config = resolveProviderOverride(translation, "clinepass", {
      apiKey: "sk-cline",
      model: "cline-pass/glm-5.3",
    });
    expect(config.provider).toBe("clinepass");
    expect(config.apiKey).toBe("sk-cline");
    expect(config.baseURL).toBe("https://api.cline.bot/api/v1");
    expect(config.model).toBe("cline-pass/glm-5.3");
    expect(config.headers).toEqual({ "X-Response-Format": "openai" });
    expect(config.temperature).toBe(0.2);
    expect(config.maxTokens).toBe(512);
    expect(config.timeoutMs).toBe(10000);
    expect(config.stream).toBe(false);
  });

  it("only asks for no-thinking where the override preset supports it", () => {
    expect(
      resolveProviderOverride(translation, "clinepass", { apiKey: "k" })
        .disableThinking,
    ).toBe(true);
    expect(
      resolveProviderOverride(translation, "openai", { apiKey: "k" })
        .disableThinking,
    ).toBe(false);
    // An explicit opt-out still wins over a supporting preset.
    expect(
      resolveProviderOverride(translation, "clinepass", {
        apiKey: "k",
        disableThinking: false,
      }).disableThinking,
    ).toBe(false);
  });

  it("falls back to the override preset's own defaults", () => {
    const config = resolveProviderOverride(translation, "deepseek", {});
    expect(config.baseURL).toBe("https://api.deepseek.com/v1");
    expect(config.model).toBe("deepseek-chat");
    expect(config.apiKey).toBe("");
  });
});

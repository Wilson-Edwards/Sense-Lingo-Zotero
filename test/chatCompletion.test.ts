import { describe, expect, it, vi } from "vitest";

import { LlmError, chatCompletion } from "../src/modules/llm/client";
import {
  isConfigured,
  normalizeProviderId,
  resolveProviderConfig,
} from "../src/modules/llm/providers";

const config = {
  ...resolveProviderConfig({
    provider: "openai",
    apiKey: "sk-test",
    model: "",
    baseURL: "",
  }),
  // This suite covers the non-streaming path; streaming has its own tests.
  stream: false,
};

const messages = [
  { role: "system" as const, content: "sys" },
  { role: "user" as const, content: "usr" },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("chatCompletion", () => {
  it("returns the translated content and sends the expected request", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        model: "gpt-4o-mini",
        choices: [{ message: { content: "减轻（v.）" } }],
      }),
    );
    const result = await chatCompletion({
      messages,
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.content).toBe("减轻（v.）");
    expect(result.model).toBe("gpt-4o-mini");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.stream).toBe(false);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.temperature).toBe(0.3);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-test",
    );
  });

  it("maps HTTP errors and keeps the provider message", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "invalid api key" } }, 401),
    );
    await expect(
      chatCompletion({
        messages,
        config,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "HTTP", status: 401 });
  });

  it("maps network failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    });
    await expect(
      chatCompletion({
        messages,
        config,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("maps aborts to TIMEOUT", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    await expect(
      chatCompletion({
        messages,
        config,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("refuses to run without an API key", async () => {
    const fetchImpl = vi.fn();
    await expect(
      chatCompletion({
        messages,
        config: { ...config, apiKey: "" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body on a 200 response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("not json", { status: 200 }),
    );
    await expect(
      chatCompletion({
        messages,
        config,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "PARSE" });
  });

  it("produces a LlmError instance", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    try {
      await chatCompletion({
        messages,
        config,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LlmError);
    }
  });
});

describe("provider presets", () => {
  it("uses the deepseek preset", () => {
    const resolved = resolveProviderConfig({ provider: "deepseek" });
    expect(resolved.baseURL).toBe("https://api.deepseek.com/v1");
    expect(resolved.model).toBe("deepseek-chat");
  });

  it("lets explicit values win over presets", () => {
    const resolved = resolveProviderConfig({
      provider: "openai",
      baseURL: "https://gateway.local/v1",
      model: "my-model",
    });
    expect(resolved.baseURL).toBe("https://gateway.local/v1");
    expect(resolved.model).toBe("my-model");
  });

  it("needs a key, a URL and a model to be configured", () => {
    expect(isConfigured(config)).toBe(true);
    expect(isConfigured({ ...config, apiKey: "" })).toBe(false);
    expect(isConfigured({ ...config, model: "" })).toBe(false);
    expect(
      isConfigured(resolveProviderConfig({ provider: "custom", apiKey: "k" })),
    ).toBe(false);
  });

  it("normalizes unknown provider ids", () => {
    expect(normalizeProviderId("deepseek")).toBe("deepseek");
    expect(normalizeProviderId("nope")).toBe("openai");
  });

  it("streams by default and can be turned off", () => {
    expect(resolveProviderConfig({ provider: "openai" }).stream).toBe(true);
    expect(
      resolveProviderConfig({ provider: "openai", stream: false }).stream,
    ).toBe(false);
  });
});

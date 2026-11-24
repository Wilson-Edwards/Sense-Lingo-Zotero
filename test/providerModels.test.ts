import { describe, expect, it, vi } from "vitest";

import {
  buildModelsEndpoint,
  chatCompletion,
  fetchModelIds,
  parseModelIds,
} from "../src/modules/llm/client";
import {
  PROVIDERS,
  normalizeModelId,
  normalizeProviderId,
  resolveProviderConfig,
} from "../src/modules/llm/providers";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("clinepass preset", () => {
  it("uses the Cline API base URL and a ClinePass model", () => {
    const resolved = resolveProviderConfig({ provider: "clinepass" });
    expect(resolved.baseURL).toBe("https://api.cline.bot/api/v1");
    expect(resolved.model).toBe("cline-pass/deepseek-v4.1-flash");
    expect(resolved.modelsPath).toBe("/cline-pass/models");
  });

  it("adds X-Response-Format: openai to every request", () => {
    const resolved = resolveProviderConfig({ provider: "clinepass" });
    expect(resolved.headers).toEqual({ "X-Response-Format": "openai" });
    expect(PROVIDERS.clinepass.headers).toEqual({
      "X-Response-Format": "openai",
    });
  });

  it("sends the preset header with a chat completion", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "译文" } }] }),
    );
    await chatCompletion({
      messages: [{ role: "user", content: "hello" }],
      config: {
        ...resolveProviderConfig({ provider: "clinepass", apiKey: "k" }),
        stream: false,
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.cline.bot/api/v1/chat/completions");
    expect((init.headers as Record<string, string>)["X-Response-Format"]).toBe(
      "openai",
    );
  });

  it("does not leak headers into other presets", () => {
    expect(resolveProviderConfig({ provider: "openai" }).headers).toEqual({});
    expect(resolveProviderConfig({ provider: "deepseek" }).headers).toEqual({});
  });

  it("normalizes the provider id", () => {
    expect(normalizeProviderId("clinepass")).toBe("clinepass");
  });
});

describe("normalizeModelId", () => {
  it("qualifies a bare ClinePass slug", () => {
    expect(normalizeModelId("clinepass", "glm-5.3-flash")).toBe(
      "cline-pass/glm-5.3-flash",
    );
  });

  it("keeps an already qualified id", () => {
    expect(normalizeModelId("clinepass", "cline-pass/glm-5.3")).toBe(
      "cline-pass/glm-5.3",
    );
  });

  it("leaves other providers alone", () => {
    expect(normalizeModelId("openai", "gpt-4o-mini")).toBe("gpt-4o-mini");
  });
});

describe("buildModelsEndpoint", () => {
  it("defaults to /models", () => {
    expect(buildModelsEndpoint("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/models",
    );
  });

  it("honours a custom path", () => {
    expect(
      buildModelsEndpoint("https://api.cline.bot/api/v1", "/cline-pass/models"),
    ).toBe("https://api.cline.bot/api/v1/cline-pass/models");
  });

  it("does not duplicate an existing suffix", () => {
    expect(
      buildModelsEndpoint(
        "https://api.cline.bot/api/v1/cline-pass/models",
        "/cline-pass/models",
      ),
    ).toBe("https://api.cline.bot/api/v1/cline-pass/models");
  });

  it("returns an empty string without a base URL", () => {
    expect(buildModelsEndpoint("")).toBe("");
  });
});

describe("parseModelIds", () => {
  it("reads the OpenAI list shape", () => {
    expect(
      parseModelIds({
        object: "list",
        data: [
          { id: "cline-pass/glm-5.3", object: "model" },
          { id: "cline-pass/kimi-k3" },
        ],
      }),
    ).toEqual(["cline-pass/glm-5.3", "cline-pass/kimi-k3"]);
  });

  it("reads a bare array of ids", () => {
    expect(parseModelIds(["a", "b"])).toEqual(["a", "b"]);
  });

  it("reads a models wrapper and drops duplicates", () => {
    expect(
      parseModelIds({ models: [{ model: "a" }, { slug: "a" }, { name: "b" }] }),
    ).toEqual(["a", "b"]);
  });

  it("reads a map keyed by model id", () => {
    expect(
      parseModelIds({
        success: true,
        "cline-pass/a": { name: "A" },
        "cline-pass/b": { name: "B" },
      }),
    ).toEqual(["cline-pass/a", "cline-pass/b"]);
  });

  it("ignores payloads without ids", () => {
    expect(parseModelIds({ success: true })).toEqual([]);
    expect(parseModelIds(null)).toEqual([]);
    expect(parseModelIds("nope")).toEqual([]);
  });
});

describe("fetchModelIds", () => {
  it("GETs the preset model path with auth and preset headers", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ id: "cline-pass/glm-5.3" }, { id: "cline-pass/kimi-k3" }],
      }),
    );
    const ids = await fetchModelIds({
      config: resolveProviderConfig({ provider: "clinepass", apiKey: "k" }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(ids).toEqual(["cline-pass/glm-5.3", "cline-pass/kimi-k3"]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.cline.bot/api/v1/cline-pass/models");
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer k");
    expect(headers["X-Response-Format"]).toBe("openai");
  });

  it("keeps the API error message", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "Unauthorized: re-authenticate" }, 401),
    );
    await expect(
      fetchModelIds({
        config: resolveProviderConfig({ provider: "clinepass", apiKey: "k" }),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      code: "HTTP",
      status: 401,
      detail: "Unauthorized: re-authenticate",
    });
  });

  it("rejects an empty catalogue", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));
    await expect(
      fetchModelIds({
        config: resolveProviderConfig({ provider: "openai", apiKey: "k" }),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "EMPTY" });
  });

  it("refuses to run without a base URL", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchModelIds({
        config: resolveProviderConfig({ provider: "custom", apiKey: "k" }),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

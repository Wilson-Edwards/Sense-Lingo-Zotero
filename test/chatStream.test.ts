import { describe, expect, it, vi } from "vitest";

import { LlmError, chatCompletion } from "../src/modules/llm/client";
import { resolveProviderConfig } from "../src/modules/llm/providers";

const baseConfig = resolveProviderConfig({
  provider: "openai",
  apiKey: "sk-test",
  model: "",
  baseURL: "",
});
const config = { ...baseConfig, stream: true };

const messages = [
  { role: "system" as const, content: "sys" },
  { role: "user" as const, content: "usr" },
];

/** Build a response whose body arrives in the given network chunks. */
function streamResponse(
  chunks: string[],
  contentType = "text/event-stream",
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function delta(content: string): string {
  return sseData({ choices: [{ delta: { content } }] });
}

describe("chatCompletion streaming", () => {
  it("calls onDelta per chunk and returns the assembled text", async () => {
    const deltas: string[] = [];
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        sseData({
          model: "gpt-4o-mini",
          choices: [{ delta: { content: "减" } }],
        }),
        delta("轻"),
        sseData({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]\n\n",
      ]),
    );

    const result = await chatCompletion({
      messages,
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: (d) => deltas.push(d),
    });

    expect(deltas).toEqual(["减", "轻"]);
    expect(result.content).toBe("减轻");
    expect(result.model).toBe("gpt-4o-mini");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(String(init.body)).stream).toBe(true);
  });

  it("reassembles events split across network chunks", async () => {
    const deltas: string[] = [];
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        'data: {"choices":[{"delta":{"content":"miti',
        'gate"}}]}\n\ndata: {"choices":[{"delta":{"content":"!"}}]}\n',
        "\ndata: [DONE]\n\n",
      ]),
    );

    const result = await chatCompletion({
      messages,
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: (d) => deltas.push(d),
    });

    expect(deltas).toEqual(["mitigate", "!"]);
    expect(result.content).toBe("mitigate!");
  });

  it("tolerates CRLF, comments, keep-alives and malformed payloads", async () => {
    const deltas: string[] = [];
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        ": ping\r\n\r\n",
        "event: message\r\n",
        'data: {"choices":[{"delta":{"content":"a"}}]}\r\n\r\n',
        "data: not-json\r\n\r\n",
        'data: {"choices":[{"delta":{"content":"b"}}]}\r\n\r\n',
        "data: [DONE]\r\n\r\n",
      ]),
    );

    const result = await chatCompletion({
      messages,
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: (d) => deltas.push(d),
    });

    expect(deltas).toEqual(["a", "b"]);
    expect(result.content).toBe("ab");
  });

  it("stops at [DONE] and ignores trailing data", async () => {
    const deltas: string[] = [];
    const fetchImpl = vi.fn(async () =>
      streamResponse([delta("done"), "data: [DONE]\n\n", delta("ignored")]),
    );

    const result = await chatCompletion({
      messages,
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: (d) => deltas.push(d),
    });

    expect(deltas).toEqual(["done"]);
    expect(result.content).toBe("done");
  });

  it("accepts a provider that ignores stream and answers with JSON", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "gpt-4o-mini",
            choices: [{ message: { content: "整体译文" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await chatCompletion({
      messages,
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.content).toBe("整体译文");
  });

  it("parses an event stream served as plain text", async () => {
    const deltas: string[] = [];
    const fetchImpl = vi.fn(async () =>
      streamResponse([delta("a"), delta("b"), "data: [DONE]\n"], "text/plain"),
    );

    const result = await chatCompletion({
      messages,
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: (d) => deltas.push(d),
    });

    expect(deltas).toEqual(["a", "b"]);
    expect(result.content).toBe("ab");
  });

  it("surfaces an error payload received mid-stream", async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        delta("partial"),
        sseData({ error: { message: "rate limited" } }),
      ]),
    );

    await expect(
      chatCompletion({
        messages,
        config,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "HTTP", detail: "rate limited" });
  });

  it("rejects an empty stream", async () => {
    const fetchImpl = vi.fn(async () => streamResponse(["data: [DONE]\n\n"]));
    await expect(
      chatCompletion({
        messages,
        config,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("does not stream when the setting is off", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "x" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    await chatCompletion({
      messages,
      config: { ...baseConfig, stream: false },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body)).stream).toBe(false);
  });
});

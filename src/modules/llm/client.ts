/**
 * Minimal OpenAI-compatible chat client.
 *
 * `fetch` is available in the Zotero 7 sandbox, and every provider we support
 * (OpenAI, DeepSeek, self-hosted gateways) speaks the same
 * `POST {base}/chat/completions` protocol.
 */

import type { EffectiveProviderConfig } from "./providers";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LlmErrorCode =
  "NOT_CONFIGURED" | "TIMEOUT" | "HTTP" | "NETWORK" | "PARSE" | "EMPTY";

export class LlmError extends Error {
  public readonly code: LlmErrorCode;
  public readonly status?: number;
  public readonly detail?: string;

  constructor(
    code: LlmErrorCode,
    message: string,
    options: { status?: number; detail?: string } = {},
  ) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.status = options.status;
    this.detail = options.detail;
  }
}

/** Strip trailing slashes and add `/v1` when the user typed a bare host. */
export function normalizeBaseURL(baseURL: string): string {
  const url = (baseURL ?? "").trim().replace(/\/+$/, "");
  if (!url) {
    return "";
  }
  const withoutScheme = url.replace(/^https?:\/\//i, "");
  return withoutScheme.includes("/") ? url : `${url}/v1`;
}

export function buildChatEndpoint(baseURL: string): string {
  const url = normalizeBaseURL(baseURL);
  if (!url) {
    return "";
  }
  return /\/chat\/completions$/i.test(url) ? url : `${url}/chat/completions`;
}

function contentToString(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

/** Pull the assistant message out of a chat-completions payload. */
export function parseChatCompletion(payload: unknown): {
  content: string;
  model?: string;
} {
  if (!payload || typeof payload !== "object") {
    throw new LlmError("PARSE", "Response is not a JSON object");
  }
  const body = payload as {
    model?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = contentToString(body.choices?.[0]?.message?.content).trim();
  if (!content) {
    throw new LlmError("EMPTY", "Model returned an empty message");
  }
  return {
    content,
    model: typeof body.model === "string" ? body.model : undefined,
  };
}

export function extractErrorMessage(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const body = payload as {
      error?: { message?: unknown };
      message?: unknown;
    };
    if (body.error && typeof body.error.message === "string") {
      return body.error.message;
    }
    if (typeof body.message === "string") {
      return body.message;
    }
  }
  return "";
}

/** Pull the incremental text out of one streamed chat-completions chunk. */
export function parseStreamChunk(payload: unknown): {
  delta: string;
  model?: string;
} {
  if (!payload || typeof payload !== "object") {
    return { delta: "" };
  }
  const body = payload as {
    model?: unknown;
    choices?: Array<{ delta?: { content?: unknown } }>;
  };
  return {
    delta: contentToString(body.choices?.[0]?.delta?.content),
    model: typeof body.model === "string" ? body.model : undefined,
  };
}

interface StreamAccumulator {
  content: string;
  model?: string;
  done: boolean;
}

/**
 * Feed one line of an SSE response into the accumulator.
 *
 * `event:` / `id:` lines and comments (`: ping`) are skipped. A malformed
 * `data:` payload is ignored instead of aborting the request: gateways
 * occasionally emit non-JSON keep-alives, and dropping a whole translation
 * over one of them would be worse than skipping it.
 */
function consumeStreamLine(
  line: string,
  state: StreamAccumulator,
  onDelta?: (delta: string) => void,
): void {
  const trimmed = line.replace(/\r$/, "");
  if (!trimmed.startsWith("data:")) {
    return;
  }
  const data = trimmed.slice(5).trim();
  if (!data) {
    return;
  }
  if (data === "[DONE]") {
    state.done = true;
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return;
  }
  const streamError = extractErrorMessage(payload);
  if (streamError) {
    throw new LlmError("HTTP", `Stream error: ${streamError}`, {
      detail: streamError,
    });
  }
  const chunk = parseStreamChunk(payload);
  if (chunk.model) {
    state.model = chunk.model;
  }
  if (chunk.delta) {
    state.content += chunk.delta;
    onDelta?.(chunk.delta);
  }
}

/**
 * Consume a `text/event-stream` response body.
 *
 * `onActivity` fires on every received chunk so the caller can implement an
 * inactivity timeout: a long translation may legitimately take longer than one
 * timeout window, but a stalled connection still has to fail.
 */
async function readEventStream(
  body: ReadableStream,
  onDelta: ((delta: string) => void) | undefined,
  onActivity: () => void,
): Promise<StreamAccumulator> {
  const state: StreamAccumulator = { content: "", done: false };
  const reader = body.getReader() as ReadableStreamDefaultReader;
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!state.done) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      onActivity();
      buffer += decoder.decode(value as Uint8Array, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        consumeStreamLine(line, state, onDelta);
        if (state.done) {
          break;
        }
        newline = buffer.indexOf("\n");
      }
    }
    if (!state.done) {
      const tail = buffer + decoder.decode();
      if (tail) {
        consumeStreamLine(tail, state, onDelta);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream is already closed or aborted; nothing left to release.
    }
  }
  return state;
}

/** For event streams that arrive as one buffered string (no body reader). */
function parseEventStreamText(
  text: string,
  onDelta?: (delta: string) => void,
): StreamAccumulator {
  const state: StreamAccumulator = { content: "", done: false };
  for (const line of text.split("\n")) {
    if (state.done) {
      break;
    }
    consumeStreamLine(line, state, onDelta);
  }
  return state;
}

/**
 * Read a response that was requested with `stream: true`.
 *
 * Most OpenAI-compatible providers answer with `text/event-stream`, but some
 * gateways ignore the flag and return a single JSON body; both are accepted so
 * flipping the setting cannot break a working provider.
 */
async function readStreamedResponse(
  response: Response,
  onDelta: ((delta: string) => void) | undefined,
  onActivity: () => void,
): Promise<{ content: string; model?: string }> {
  const contentType = response.headers?.get?.("content-type") ?? "";
  const body = response.body;
  if (
    contentType.includes("text/event-stream") &&
    body &&
    typeof body.getReader === "function"
  ) {
    const state = await readEventStream(body, onDelta, onActivity);
    return { content: state.content, model: state.model };
  }

  const text = await response.text();
  onActivity();
  if (!text.trim()) {
    return { content: "" };
  }
  if (!text.trimStart().startsWith("data:")) {
    // Not an event stream at all: parse it as a regular completion.
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new LlmError("PARSE", "Response is not valid JSON", {
        detail: text.slice(0, 200),
      });
    }
    return parseChatCompletion(payload);
  }
  const state = parseEventStreamText(text, onDelta);
  return { content: state.content, model: state.model };
}

function parseJsonBody(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new LlmError("PARSE", "Response is not valid JSON", {
      detail: text.slice(0, 200),
    });
  }
}

export interface ChatRequestOptions {
  messages: ChatMessage[];
  config: EffectiveProviderConfig;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /** Overrides `config.timeoutMs`. */
  timeoutMs?: number;
  /**
   * Called with the text of every streamed chunk, so the UI can render the
   * translation while it is still being generated. Only used when
   * `config.stream` is on; the complete text is still returned at the end.
   */
  onDelta?: (delta: string) => void;
}

export interface ChatResult {
  content: string;
  model: string;
  elapsedMs: number;
}

/**
 * Run one chat completion, streaming when `config.stream` is on.
 *
 * Every failure is normalized into an `LlmError` with a stable `code` so the UI
 * can show a localized message instead of a raw stack trace.
 */
export async function chatCompletion(
  options: ChatRequestOptions,
): Promise<ChatResult> {
  const { config, messages } = options;
  const endpoint = buildChatEndpoint(config.baseURL);
  if (!config.apiKey || !endpoint || !config.model) {
    throw new LlmError("NOT_CONFIGURED", "Missing API key, base URL or model");
  }
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new LlmError("NETWORK", "fetch is not available in this environment");
  }

  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * With streaming, a response can legitimately stay open longer than one
   * timeout window, so the timer measures inactivity and is re-armed each time
   * a chunk arrives. Non-streaming requests behave exactly as before.
   */
  const armTimeout = (): void => {
    if (!controller) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  armTimeout();

  const startedAt = Date.now();
  try {
    const response = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: config.stream,
      }),
      signal: controller?.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      let payload: unknown = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        // Keep the raw body as the detail below.
      }
      const detail = extractErrorMessage(payload) || text.slice(0, 200);
      throw new LlmError("HTTP", `HTTP ${response.status}: ${detail}`, {
        status: response.status,
        detail,
      });
    }

    const parsed = config.stream
      ? await readStreamedResponse(response, options.onDelta, armTimeout)
      : parseChatCompletion(parseJsonBody(await response.text()));
    const content = parsed.content.trim();
    if (!content) {
      throw new LlmError("EMPTY", "Model returned an empty message");
    }
    return {
      content,
      model: parsed.model || config.model,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof LlmError) {
      throw error;
    }
    const name = (error as { name?: string })?.name;
    if (name === "AbortError") {
      throw new LlmError("TIMEOUT", `Request timed out after ${timeoutMs}ms`);
    }
    throw new LlmError(
      "NETWORK",
      (error as Error)?.message || "Network request failed",
      { detail: String(error) },
    );
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

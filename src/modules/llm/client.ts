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

export interface ChatRequestOptions {
  messages: ChatMessage[];
  config: EffectiveProviderConfig;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /** Overrides `config.timeoutMs`. */
  timeoutMs?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  elapsedMs: number;
}

/**
 * Run one non-streaming completion.
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
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await doFetch(endpoint, {
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
        stream: false,
      }),
      signal: controller?.signal,
    });
  } catch (error) {
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

  const elapsedMs = Date.now() - startedAt;
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    if (response.ok) {
      throw new LlmError("PARSE", "Response is not valid JSON", {
        detail: text.slice(0, 200),
      });
    }
  }

  if (!response.ok) {
    const detail = extractErrorMessage(payload) || text.slice(0, 200);
    throw new LlmError("HTTP", `HTTP ${response.status}: ${detail}`, {
      status: response.status,
      detail,
    });
  }

  const parsed = parseChatCompletion(payload);
  return {
    content: parsed.content,
    model: parsed.model || config.model,
    elapsedMs,
  };
}

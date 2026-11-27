/**
 * Minimal OpenAI-compatible chat client.
 *
 * `fetch` is available in the Zotero 7 sandbox, and every provider we support
 * (OpenAI, DeepSeek, self-hosted gateways) speaks the same
 * `POST {base}/chat/completions` protocol.
 */

import { log, warn } from "../../utils/logger";
import type { EffectiveProviderConfig } from "./providers";
import { resolveWebApis, type ResolvedWebApis } from "./runtime";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LlmErrorCode =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "ABORTED"
  | "HTTP"
  | "NETWORK"
  | "PARSE"
  | "EMPTY";

export class LlmError extends Error {
  public readonly code: LlmErrorCode;
  public readonly status?: number;
  public readonly detail?: string;
  public readonly retryAfterMs?: number;

  constructor(
    code: LlmErrorCode,
    message: string,
    options: { status?: number; detail?: string; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.status = options.status;
    this.detail = options.detail;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Parse either Retry-After seconds or an HTTP date. */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  const raw = value?.trim();
  if (!raw) {
    return undefined;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
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

/**
 * URL of the model list, e.g. `https://api.openai.com/v1/models`.
 *
 * Most providers expose `/models`; a preset that keeps its catalogue elsewhere
 * passes the path in through `modelsPath`.
 */
export function buildModelsEndpoint(
  baseURL: string,
  modelsPath = "/models",
): string {
  const url = normalizeBaseURL(baseURL);
  if (!url) {
    return "";
  }
  const path = modelsPath.startsWith("/") ? modelsPath : `/${modelsPath}`;
  return url.endsWith(path) ? url : `${url}${path}`;
}

const MODEL_WRAPPER_KEYS = ["data", "models", "items", "results"] as const;

interface ModelEntry {
  id: string;
  /**
   * Endpoints the catalogue declares for this model, when it declares any.
   * A gateway that serves everything usually omits the field entirely.
   */
  endpoints?: string[];
}

function endpointsOf(record: Record<string, unknown>): string[] | undefined {
  const raw = record.supported_endpoints;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  return raw.filter((path): path is string => typeof path === "string");
}

/**
 * Pull model entries out of whatever shape a catalogue endpoint answers with.
 *
 * The OpenAI list (`{ object: "list", data: [{ id }] }`) is the common case;
 * gateways also answer with a bare array, a `models` array, or a map keyed by
 * model id, and all of those are accepted so one parser works for every
 * preset.
 */
function collectModelEntries(value: unknown, depth: number): ModelEntry[] {
  if (depth > 3 || value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry): ModelEntry[] => {
      if (typeof entry === "string") {
        return [{ id: entry }];
      }
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        for (const key of ["id", "model", "slug", "name"] as const) {
          if (typeof record[key] === "string") {
            return [
              { id: record[key] as string, endpoints: endpointsOf(record) },
            ];
          }
        }
      }
      return [];
    });
  }
  if (typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  for (const key of MODEL_WRAPPER_KEYS) {
    if (key in record) {
      const entries = collectModelEntries(record[key], depth + 1);
      if (entries.length) {
        return entries;
      }
    }
  }
  // Some catalogues are a plain map of `{ "<model id>": { ... } }`; the wrapper
  // keys above are skipped so `object` / `success` metadata cannot leak in.
  const entries = Object.entries(record).filter(
    ([key]) =>
      !(MODEL_WRAPPER_KEYS as readonly string[]).includes(key) &&
      !["object", "success", "error", "message", "status"].includes(key),
  );
  if (
    entries.length &&
    entries.every(([, entry]) => entry && typeof entry === "object")
  ) {
    return entries.map(([key]) => ({ id: key }));
  }
  return [];
}

/**
 * Read the model ids out of a catalogue payload.
 *
 * `requiredEndpoint` drops ids the catalogue declares as served elsewhere only.
 * Command Code lists every model with `supported_endpoints`, and its Claude
 * ids answer `must be called via /provider/v1/messages` on the chat route, so
 * they must not be offered. An id whose entry declares no endpoints is kept:
 * most gateways omit the field and serve everything.
 */
export function parseModelIds(
  payload: unknown,
  requiredEndpoint = "",
): string[] {
  const ids = collectModelEntries(payload, 0)
    .filter(
      (entry) =>
        !requiredEndpoint ||
        !entry.endpoints?.length ||
        entry.endpoints.includes(requiredEndpoint),
    )
    .map((entry) => entry.id.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

/**
 * Keep only the ids the preset can actually call, and top them up with the ones
 * baked into the preset.
 *
 * A catalogue can be broader than one credential: Cline's `/models` lists the
 * whole pay-as-you-go catalogue and none of the `cline-pass/...` aliases, so a
 * ClinePass key would otherwise be offered models outside its subscription.
 */
export function selectModelIds(
  ids: readonly string[],
  modelPrefix: string,
  fallbackModels: readonly string[],
): string[] {
  const scoped = modelPrefix
    ? ids.filter((id) => id.startsWith(modelPrefix))
    : [...ids];
  if (!scoped.length) {
    return [...new Set(fallbackModels)];
  }
  return [...new Set([...scoped, ...fallbackModels])];
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
      error?: unknown;
      message?: unknown;
    };
    // ClinePass answers `{ "error": "Unauthorized: ..." }` (a string), while
    // OpenAI-compatible gateways nest the text under `error.message`.
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
    if (
      body.error &&
      typeof body.error === "object" &&
      typeof (body.error as { message?: unknown }).message === "string"
    ) {
      return (body.error as { message: string }).message;
    }
    if (typeof body.message === "string") {
      return body.message;
    }
  }
  return "";
}

/** Never let a provider echo credentials into UI errors or debug logs. */
export function redactCredential(text: string, apiKey = ""): string {
  let safe = text ?? "";
  const key = apiKey.trim();
  if (key) {
    safe = safe.split(key).join("[REDACTED]");
  }
  return safe.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]");
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
  /** Every decoded byte, kept so a non-SSE body can still be parsed. */
  raw: string;
  chunks: number;
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
 * Consume a readable response body.
 *
 * `onActivity` fires on every received chunk so the caller can implement an
 * inactivity timeout: a long translation may legitimately take longer than one
 * timeout window, but a stalled connection still has to fail.
 */
async function readEventStream(
  body: ReadableStream,
  onDelta: ((delta: string) => void) | undefined,
  onActivity: () => void,
  decoder: TextDecoder,
): Promise<StreamAccumulator> {
  const state: StreamAccumulator = {
    content: "",
    raw: "",
    chunks: 0,
    done: false,
  };
  const reader = body.getReader() as ReadableStreamDefaultReader;
  let buffer = "";
  try {
    while (!state.done) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      onActivity();
      const text = decoder.decode(value as Uint8Array, { stream: true });
      state.chunks += 1;
      state.raw += text;
      buffer += text;
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
  const state: StreamAccumulator = {
    content: "",
    raw: text,
    chunks: 1,
    done: false,
  };
  for (const line of text.split("\n")) {
    if (state.done) {
      break;
    }
    consumeStreamLine(line, state, onDelta);
  }
  return state;
}

function contentTypeOf(response: Response): string {
  try {
    return response.headers?.get?.("content-type") ?? "";
  } catch {
    // Headers of a response created in another realm may not be readable.
    return "";
  }
}

/**
 * The streaming body, when this realm can actually read it.
 *
 * Some Zotero scopes hand back a `Response` whose `body` is missing or throws
 * on access even though the server streamed it; the request then has to be
 * read as one buffered string, which is why the caller warns about it.
 */
function readableBody(response: Response): ReadableStream | null {
  try {
    const body = response.body as unknown as ReadableStream | null;
    if (
      body &&
      typeof (body as { getReader?: unknown }).getReader === "function"
    ) {
      return body;
    }
  } catch {
    // Reading `body` can throw across compartments (e.g. in the plugin sandbox).
  }
  return null;
}

/**
 * Read a response that was requested with `stream: true`.
 *
 * Most OpenAI-compatible providers answer with `text/event-stream`, but some
 * gateways ignore the flag and return a single JSON body; both are accepted so
 * flipping the setting cannot break a working provider. A body is read
 * incrementally unless the provider declared JSON, so a gateway that labels an
 * event stream as `text/plain` still streams instead of buffering.
 */
async function readStreamedResponse(
  response: Response,
  onDelta: ((delta: string) => void) | undefined,
  onActivity: () => void,
  apis: ResolvedWebApis | null,
): Promise<{ content: string; model?: string }> {
  const contentType = contentTypeOf(response);
  const body = readableBody(response);

  if (!body) {
    warn(
      "streaming unavailable: response has no readable body, waiting for the full answer",
    );
  }

  if (body && !contentType.includes("json")) {
    const state = await readEventStream(
      body,
      onDelta,
      onActivity,
      apis?.createTextDecoder() ?? new TextDecoder(),
    );
    log(
      "stream finished",
      `${state.chunks} chunk(s),`,
      `${state.content.length} char(s)`,
    );
    if (state.content) {
      return { content: state.content, model: state.model };
    }
    // The body was readable but carried no `data:` payload: an unusual
    // content-type must not lose a normal JSON answer.
    const raw = state.raw.trim();
    return raw.startsWith("{")
      ? parseChatCompletion(parseJsonBody(raw))
      : { content: "" };
  }

  if (contentType.includes("json")) {
    log("provider ignored stream, reading a JSON response");
  }

  const text = await response.text();
  onActivity();
  if (!text.trim()) {
    return { content: "" };
  }
  if (!text.trimStart().startsWith("data:")) {
    // Not an event stream at all: parse it as a regular completion.
    return parseChatCompletion(parseJsonBody(text));
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
  /** Cancels the request independently of its inactivity timeout. */
  signal?: AbortSignal;
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
  /** True when at least one incremental delta was received. */
  streamed: boolean;
}

/**
 * Body fragment that asks a gateway to skip the reasoning phase.
 *
 * Measured against the live Cline API: Qwen and Kimi stop emitting reasoning
 * tokens entirely, DeepSeek and GLM ignore it, and a model that mandates
 * reasoning answers `400 Reasoning is mandatory…` — which is why
 * `chatCompletion` retries once without this fragment.
 */
const NO_THINKING_FRAGMENT = { reasoning: { enabled: false } } as const;

/**
 * Models that answered "reasoning is mandatory" once, keyed by
 * `baseURL|model`. Remembering them keeps later translations from paying the
 * doomed first round trip.
 */
const thinkingMandatory = new Set<string>();

/** Test seam: forget which models refuse the "no thinking" hint. */
export function resetThinkingSupportCache(): void {
  thinkingMandatory.clear();
}

function thinkingHintKey(config: { baseURL: string; model: string }): string {
  return `${config.baseURL}|${config.model}`;
}

function isReasoningMandatory(error: unknown): boolean {
  if (!(error instanceof LlmError)) {
    return false;
  }
  const detail = `${error.detail ?? ""} ${error.message}`.toLowerCase();
  return (
    detail.includes("reasoning is mandatory") ||
    detail.includes("reasoning cannot be disabled")
  );
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
  /**
   * Prefer a real window scope. The plugin sandbox exposes `fetch` but no
   * `AbortController` (so `requestTimeoutMs` silently did nothing), and on
   * some builds its `Response` has no readable body, which turns streaming
   * into one buffered answer. Tests inject `fetchImpl` and keep the ambient
   * APIs instead.
   */
  const apis = options.fetchImpl ? null : resolveWebApis();
  const doFetch = options.fetchImpl ?? apis?.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new LlmError("NETWORK", "fetch is not available in this environment");
  }

  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const controller = apis
    ? apis.createAbortController()
    : typeof AbortController === "function"
      ? new AbortController()
      : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const abortFromCaller = (): void => controller?.abort();
  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
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
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  };

  const hintKey = thinkingHintKey(config);
  // A model that already refused the hint must not be asked again.
  const skipThinking =
    config.disableThinking && !thinkingMandatory.has(hintKey);
  /** Set once a chunk reached the UI: a retry would duplicate that text. */
  let streamed = false;
  const onDelta = options.onDelta
    ? (delta: string) => {
        streamed = true;
        options.onDelta?.(delta);
      }
    : undefined;

  const attempt = async (withHint: boolean): Promise<ChatResult> => {
    armTimeout();
    const startedAt = Date.now();
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: config.stream,
    };
    if (withHint) {
      Object.assign(body, NO_THINKING_FRAGMENT);
    }

    const response = await doFetch(endpoint, {
      method: "POST",
      headers: {
        ...config.headers,
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
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
      const detail = redactCredential(
        extractErrorMessage(payload) || text.slice(0, 200),
        config.apiKey,
      );
      throw new LlmError("HTTP", `HTTP ${response.status}: ${detail}`, {
        status: response.status,
        detail,
        retryAfterMs: parseRetryAfter(response.headers?.get?.("retry-after")),
      });
    }

    const parsed = config.stream
      ? await readStreamedResponse(response, onDelta, armTimeout, apis)
      : parseChatCompletion(parseJsonBody(await response.text()));
    const content = parsed.content.trim();
    if (!content) {
      throw new LlmError("EMPTY", "Model returned an empty message");
    }
    return {
      content,
      model: parsed.model || config.model,
      elapsedMs: Date.now() - startedAt,
      streamed,
    };
  };

  armTimeout();
  try {
    log(
      "request",
      config.provider,
      config.model,
      config.stream ? "stream" : "buffered",
      skipThinking ? "no-thinking" : "",
      `via ${apis?.label ?? "injected fetch"}`,
      controller ? "" : "(no timeout)",
    );
    try {
      return await attempt(skipThinking);
    } catch (error) {
      // Some models cannot turn reasoning off at all. Retry once without the
      // hint instead of failing the translation, and remember the model so the
      // next request goes straight to the working body.
      if (!skipThinking || streamed || !isReasoningMandatory(error)) {
        throw error;
      }
      thinkingMandatory.add(hintKey);
      warn("model requires reasoning, retrying without the hint", config.model);
      return await attempt(false);
    }
  } catch (error) {
    if (error instanceof LlmError) {
      throw error;
    }
    const name = (error as { name?: string })?.name;
    if (name === "AbortError") {
      if (options.signal?.aborted && !timedOut) {
        throw new LlmError("ABORTED", "Request was cancelled");
      }
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
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export interface ListModelsOptions {
  config: EffectiveProviderConfig;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /** Overrides `config.timeoutMs`. */
  timeoutMs?: number;
}

/**
 * Read the provider's model list.
 *
 * This is what powers the "fetch models" button in the settings pane: a GET on
 * the preset's `modelsPath` with the same key and extra headers as a chat
 * request. A provider that exposes an open catalogue simply ignores the key.
 *
 * ClinePass answers on the shared `/models` and never lists its subscription
 * aliases there, so the result is narrowed to `modelPrefix` and completed from
 * the preset's `fallbackModels`; that also keeps a provider without a catalogue
 * endpoint usable instead of failing the button.
 *
 * Failures are normalized into `LlmError` exactly like `chatCompletion`, so the
 * pane can print one localized message.
 */
export async function fetchModelIds(
  options: ListModelsOptions,
): Promise<string[]> {
  const { config } = options;
  const endpoint = buildModelsEndpoint(config.baseURL, config.modelsPath);
  if (!endpoint) {
    throw new LlmError("NOT_CONFIGURED", "Missing base URL");
  }
  const apis = options.fetchImpl ? null : resolveWebApis();
  const doFetch = options.fetchImpl ?? apis?.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new LlmError("NETWORK", "fetch is not available in this environment");
  }

  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const controller = apis
    ? apis.createAbortController()
    : typeof AbortController === "function"
      ? new AbortController()
      : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...config.headers,
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  try {
    const response = await doFetch(endpoint, {
      method: "GET",
      headers,
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
      const detail = redactCredential(
        extractErrorMessage(payload) || text.slice(0, 200),
        config.apiKey,
      );
      throw new LlmError("HTTP", `HTTP ${response.status}: ${detail}`, {
        status: response.status,
        detail,
      });
    }
    const listed = parseModelIds(
      parseJsonBody(await response.text()),
      config.requiredEndpoint,
    );
    const ids = selectModelIds(
      listed,
      config.modelPrefix,
      config.fallbackModels,
    );
    if (!ids.length) {
      throw new LlmError("EMPTY", "The provider returned no models");
    }
    return ids;
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

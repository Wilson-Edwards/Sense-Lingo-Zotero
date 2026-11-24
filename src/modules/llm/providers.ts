/**
 * Provider presets.
 *
 * OpenAI, DeepSeek and ClinePass all speak the OpenAI chat-completions
 * protocol, so one client covers them; a preset is a default base URL, a
 * default model and — for gateways that need it — extra request headers.
 */

export type ProviderId = "openai" | "deepseek" | "clinepass" | "custom";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  baseURL: string;
  model: string;
  /**
   * Headers every request to this provider must carry. ClinePass uses
   * `X-Response-Format: openai` so non-streaming answers keep the standard
   * `choices[0].message.content` shape instead of the legacy `data` wrapper.
   */
  headers?: Record<string, string>;
  /**
   * Path (relative to `baseURL`) of the model list, if the provider does not
   * expose it at the usual `/models`. ClinePass keeps its subscription models
   * on `/cline-pass/models`.
   */
  modelsPath?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  clinepass: {
    id: "clinepass",
    label: "ClinePass",
    baseURL: "https://api.cline.bot/api/v1",
    // Flash models keep translation latency low; any `cline-pass/...` slug from
    // the subscription works, and the settings pane can fetch the live list.
    model: "cline-pass/deepseek-v4.1-flash",
    headers: { "X-Response-Format": "openai" },
    modelsPath: "/cline-pass/models",
  },
  custom: {
    id: "custom",
    label: "Custom (OpenAI compatible)",
    baseURL: "",
    model: "",
  },
};

export const PROVIDER_IDS: ProviderId[] = [
  "openai",
  "deepseek",
  "clinepass",
  "custom",
];

export function normalizeProviderId(raw: unknown): ProviderId {
  return raw === "deepseek" || raw === "clinepass" || raw === "custom"
    ? raw
    : "openai";
}

/**
 * Turn a listed model id into something usable in the `model` field.
 *
 * ClinePass documents full `cline-pass/<slug>` ids; a list that returns a bare
 * slug is completed with the prefix so the request does not fail.
 */
export function normalizeModelId(provider: ProviderId, raw: string): string {
  const id = raw.trim();
  if (provider === "clinepass" && id && !id.includes("/")) {
    return `cline-pass/${id}`;
  }
  return id;
}

export interface ProviderPrefsInput {
  provider?: unknown;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  stream?: boolean;
}

export interface EffectiveProviderConfig {
  provider: ProviderId;
  apiKey: string;
  baseURL: string;
  model: string;
  /** Extra headers the preset needs on every request (e.g. ClinePass). */
  headers: Record<string, string>;
  /** Path of the model list relative to `baseURL`, e.g. `/models`. */
  modelsPath: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  /** Ask the provider to stream the answer chunk by chunk. */
  stream: boolean;
}

/**
 * Merge user prefs with the preset. Empty `baseURL` / `model` fall back to the
 * preset values, which keeps the settings pane usable: switch provider, leave
 * the URL blank, and it still works.
 */
export function resolveProviderConfig(
  input: ProviderPrefsInput,
): EffectiveProviderConfig {
  const provider = normalizeProviderId(input.provider);
  const preset = PROVIDERS[provider];
  const baseURL = (input.baseURL ?? "").trim() || preset.baseURL;
  const model = (input.model ?? "").trim() || preset.model;
  return {
    provider,
    apiKey: (input.apiKey ?? "").trim(),
    baseURL,
    model,
    headers: { ...(preset.headers ?? {}) },
    modelsPath: preset.modelsPath ?? "/models",
    temperature:
      typeof input.temperature === "number" &&
      Number.isFinite(input.temperature)
        ? input.temperature
        : 0.3,
    maxTokens:
      typeof input.maxTokens === "number" && input.maxTokens > 0
        ? Math.floor(input.maxTokens)
        : 1024,
    timeoutMs:
      typeof input.timeoutMs === "number" && input.timeoutMs > 0
        ? Math.floor(input.timeoutMs)
        : 30000,
    stream: input.stream !== false,
  };
}

/** A key is required for every provider, `custom` included. */
export function isConfigured(config: EffectiveProviderConfig): boolean {
  return Boolean(config.apiKey && config.baseURL && config.model);
}

/** The fields that belong to one provider rather than to the plugin. */
export const PROVIDER_FIELD_KEYS = ["apiKey", "baseURL", "model"] as const;

export interface ProviderCredentialValues {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** Saved values per provider, keyed by provider id. */
export type ProviderCredentials = Partial<
  Record<ProviderId, ProviderCredentialValues>
>;

export const EMPTY_PROVIDER_CREDENTIALS: ProviderCredentialValues = {
  apiKey: "",
  baseURL: "",
  model: "",
};

function normalizeCredentialValues(value: unknown): ProviderCredentialValues {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    baseURL: typeof raw.baseURL === "string" ? raw.baseURL : "",
    model: typeof raw.model === "string" ? raw.model : "",
  };
}

/** Blank fields mean "use the preset", so an all-blank entry is not worth keeping. */
function hasCredentialValues(values: ProviderCredentialValues): boolean {
  return PROVIDER_FIELD_KEYS.some((key) => values[key].trim() !== "");
}

/**
 * Read the `providerConfigs` pref.
 *
 * Stored as JSON for the same reason as `promptProfiles`: pref values are
 * limited to int/bool/string, and we need one record per provider. Anything
 * malformed is dropped instead of breaking the settings pane.
 */
export function parseProviderCredentials(
  raw: string | null | undefined,
): ProviderCredentials {
  if (!raw || !raw.trim()) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  const credentials: ProviderCredentials = {};
  for (const id of PROVIDER_IDS) {
    if (!(id in record)) {
      continue;
    }
    const values = normalizeCredentialValues(record[id]);
    if (hasCredentialValues(values)) {
      credentials[id] = values;
    }
  }
  return credentials;
}

/** Serialize for storage; empty records are omitted, an empty map becomes "". */
export function serializeProviderCredentials(
  credentials: ProviderCredentials,
): string {
  const cleaned: ProviderCredentials = {};
  for (const id of PROVIDER_IDS) {
    const values = credentials[id];
    if (values && hasCredentialValues(values)) {
      cleaned[id] = normalizeCredentialValues(values);
    }
  }
  return Object.keys(cleaned).length ? JSON.stringify(cleaned) : "";
}

export interface ProviderSwitchResult {
  credentials: ProviderCredentials;
  /** Values the settings pane should show for `to`. */
  values: ProviderCredentialValues;
}

/**
 * Park the active values under `from` and load the saved values of `to`.
 *
 * Switching presets must not leak one provider's key / URL / model into the
 * other, but the pipeline always reads the flat prefs, so the pane keeps those
 * in sync with `providerConfigs` on every switch.
 */
export function switchProviderCredentials(
  credentials: ProviderCredentials,
  from: ProviderId,
  to: ProviderId,
  active: ProviderCredentialValues,
): ProviderSwitchResult {
  if (from === to) {
    return { credentials, values: { ...active } };
  }
  const parked: ProviderCredentials = { ...credentials };
  const current = normalizeCredentialValues(active);
  if (hasCredentialValues(current)) {
    parked[from] = current;
  } else {
    delete parked[from];
  }
  return {
    credentials: parked,
    values: { ...(parked[to] ?? EMPTY_PROVIDER_CREDENTIALS) },
  };
}

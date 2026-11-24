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
   * Path (relative to `baseURL`) of the model list, when the provider does not
   * expose it at the usual `/models`.
   */
  modelsPath?: string;
  /**
   * Namespace the `model` field accepts. A catalogue can list ids outside it
   * (ClinePass' `/models` answers with the plain `provider/model` catalogue),
   * so suggestions are filtered down to this prefix.
   */
  modelPrefix?: string;
  /**
   * Ids known to work with a valid key, offered when the catalogue endpoint has
   * nothing inside `modelPrefix`.
   *
   * ClinePass has no endpoint for its subscription models: `/api/v1/models`
   * returns the full pay-as-you-go catalogue and none of the `cline-pass/...`
   * aliases, and `/api/v1/cline-pass/models` is a 404. The list below was
   * verified one slug at a time against a live subscription.
   */
  fallbackModels?: readonly string[];
}

/**
 * ClinePass models that answered a real request with a subscription key.
 *
 * The published table is not authoritative — `minimax-m3`, `mimo-v2.6-pro`,
 * `mimo-v2.6-flash` answer `404 model not found`, and `qwen3.7-max` /
 * `qwen3.7-plus` fail provider routing, so they are left out instead of being
 * suggested.
 */
export const CLINE_PASS_MODELS: readonly string[] = [
  "cline-pass/deepseek-v4.1-flash",
  "cline-pass/deepseek-v4.1-flash-1017",
  "cline-pass/deepseek-v4-pro",
  "cline-pass/glm-5.3",
  "cline-pass/glm-5.3-flash",
  "cline-pass/kimi-k3",
  "cline-pass/kimi-k3.1-pro",
  "cline-pass/minimax-m3.1-flash",
  "cline-pass/muse-spark-1.3-contributor",
  "cline-pass/qwen3.8-max",
];

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
    // the subscription works, and the settings pane offers the ones we could
    // confirm against a live key.
    model: "cline-pass/deepseek-v4.1-flash",
    headers: { "X-Response-Format": "openai" },
    // The Cline API exposes one shared catalogue; `/cline-pass/models` does not
    // exist, so the subscription aliases come from `CLINE_PASS_MODELS`.
    modelsPath: "/models",
    modelPrefix: "cline-pass/",
    fallbackModels: CLINE_PASS_MODELS,
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

/**
 * Models the settings pane can offer before any request is made.
 *
 * Only presets that ship a verified list have one (ClinePass); everything else
 * is discovered from `GET {baseURL}/models`.
 */
export function presetModelIds(provider: ProviderId): string[] {
  return (PROVIDERS[provider].fallbackModels ?? []).map((id) =>
    normalizeModelId(provider, id),
  );
}

/**
 * Values for the settings pane's model dropdown.
 *
 * The first entry is the empty string, meaning "use the preset model" (which is
 * what a blank `model` pref does). The offered ids follow, de-duplicated, and a
 * model typed by hand is appended so the dropdown always reflects the field.
 */
export function modelChoices(
  ids: readonly string[],
  current: string,
): string[] {
  const value = current.trim();
  const choices = ["", ...new Set(ids.filter((id) => id !== ""))];
  if (value && !choices.includes(value)) {
    choices.push(value);
  }
  return choices;
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
  /** Only ids with this prefix are usable, e.g. `cline-pass/`. */
  modelPrefix: string;
  /** Ids to offer when the catalogue has nothing inside `modelPrefix`. */
  fallbackModels: readonly string[];
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
    modelPrefix: preset.modelPrefix ?? "",
    fallbackModels: preset.fallbackModels ?? [],
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

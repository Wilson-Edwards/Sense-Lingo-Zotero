/**
 * Provider presets.
 *
 * DeepSeek speaks the OpenAI chat-completions protocol, so one client covers
 * both; a preset is nothing but a default base URL plus a default model.
 */

export type ProviderId = "openai" | "deepseek" | "custom";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  baseURL: string;
  model: string;
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
  custom: {
    id: "custom",
    label: "Custom (OpenAI compatible)",
    baseURL: "",
    model: "",
  },
};

export const PROVIDER_IDS: ProviderId[] = ["openai", "deepseek", "custom"];

export function normalizeProviderId(raw: unknown): ProviderId {
  return raw === "deepseek" || raw === "custom" ? raw : "openai";
}

export interface ProviderPrefsInput {
  provider?: unknown;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface EffectiveProviderConfig {
  provider: ProviderId;
  apiKey: string;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
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
  };
}

/** A key is required for every provider, `custom` included. */
export function isConfigured(config: EffectiveProviderConfig): boolean {
  return Boolean(config.apiKey && config.baseURL && config.model);
}

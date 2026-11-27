import { config } from "../../package.json";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

const PREFS_PREFIX = config.prefsPrefix;

export interface NumericPrefSpec {
  defaultValue: number;
  min: number;
  max: number;
  step: number;
}

/**
 * One runtime contract for every numeric setting.
 *
 * HTML attributes are only hints: old prefs and about:config can bypass them,
 * so all readers and the preferences pane normalize through this table.
 */
export const NUMERIC_PREF_SCHEMA = {
  maxTokens: { defaultValue: 1024, min: 1, max: 131072, step: 1 },
  wordMaxWords: { defaultValue: 3, min: 1, max: 20, step: 1 },
  wordMaxChars: { defaultValue: 40, min: 1, max: 500, step: 1 },
  maxSentenceChars: { defaultValue: 400, min: 40, max: 10000, step: 10 },
  popupFontSize: { defaultValue: 12, min: 8, max: 32, step: 1 },
  requestTimeoutMs: {
    defaultValue: 30000,
    min: 1000,
    max: 300000,
    step: 1000,
  },
  prefetchConcurrency: { defaultValue: 2, min: 1, max: 8, step: 1 },
  prefetchBatchSize: { defaultValue: 12, min: 1, max: 100, step: 1 },
  prefetchMaxSentencesPerWord: {
    defaultValue: 3,
    min: 1,
    max: 20,
    step: 1,
  },
  prefetchDelayMs: { defaultValue: 200, min: 0, max: 60000, step: 50 },
} as const satisfies Partial<Record<keyof PluginPrefsMap, NumericPrefSpec>>;

export type NumericPrefKey = keyof typeof NUMERIC_PREF_SCHEMA;

export function normalizeNumberPref(
  key: NumericPrefKey,
  value: unknown,
): number {
  const spec: NumericPrefSpec = NUMERIC_PREF_SCHEMA[key];
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : spec.defaultValue;
  const clamped = Math.min(spec.max, Math.max(spec.min, finite));
  return spec.step >= 1 ? Math.round(clamped) : clamped;
}

/** Full pref key, e.g. `extensions.zotero.sense-lingo.apiKey`. */
export function prefKey<K extends keyof PluginPrefsMap>(key: K): string {
  return `${PREFS_PREFIX}.${key}`;
}

export function getPref<K extends keyof PluginPrefsMap>(
  key: K,
): PluginPrefsMap[K] {
  return Zotero.Prefs.get(prefKey(key), true) as PluginPrefsMap[K];
}

export function setPref<K extends keyof PluginPrefsMap>(
  key: K,
  value: PluginPrefsMap[K],
): void {
  Zotero.Prefs.set(prefKey(key), value, true);
}

export function clearPref<K extends keyof PluginPrefsMap>(key: K): void {
  Zotero.Prefs.clear(prefKey(key), true);
}

/** Loosely typed setter for loops over pref keys. */
export function setPrefRaw(
  key: keyof PluginPrefsMap,
  value: string | number | boolean,
): void {
  Zotero.Prefs.set(prefKey(key), value, true);
}

/** Read a numeric pref, falling back when the stored value is invalid. */
export function getNumberPref<K extends keyof PluginPrefsMap>(
  key: K,
  fallback: number,
): number {
  const value = Number(getPref(key));
  if (key in NUMERIC_PREF_SCHEMA) {
    return normalizeNumberPref(key as NumericPrefKey, value);
  }
  return Number.isFinite(value) ? value : fallback;
}

export function getBooleanPref<K extends keyof PluginPrefsMap>(
  key: K,
  fallback = false,
): boolean {
  const value = getPref(key);
  return typeof value === "boolean" ? value : fallback;
}

export function getStringPref<K extends keyof PluginPrefsMap>(
  key: K,
  fallback = "",
): string {
  const value = getPref(key);
  return typeof value === "string" ? value : fallback;
}

import { config } from "../../package.json";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

const PREFS_PREFIX = config.prefsPrefix;

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

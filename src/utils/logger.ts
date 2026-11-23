import { config } from "../../package.json";
import { getBooleanPref } from "./prefs";

const PREFIX = `[${config.addonRef}]`;

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Logging must never take the request down: the client logs while running in
 * unit tests too, where neither the `debug` pref nor `Zotero.debug` exists.
 */
function debugEnabled(): boolean {
  try {
    return getBooleanPref("debug", false);
  } catch {
    return false;
  }
}

function emit(line: string): void {
  try {
    Zotero.debug(line);
  } catch {
    // Unit tests run outside Zotero; there is no debug output to write to.
  }
}

/** Verbose log, only when the `debug` pref is on. */
export function log(...args: unknown[]): void {
  if (!debugEnabled()) {
    return;
  }
  emit(`${PREFIX} ${args.map(stringify).join(" ")}`);
}

export function warn(...args: unknown[]): void {
  emit(`${PREFIX} WARN ${args.map(stringify).join(" ")}`);
}

export function error(...args: unknown[]): void {
  emit(`${PREFIX} ERROR ${args.map(stringify).join(" ")}`);
}

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

/** Verbose log, only when the `debug` pref is on. */
export function log(...args: unknown[]): void {
  if (!getBooleanPref("debug", false)) {
    return;
  }
  Zotero.debug(`${PREFIX} ${args.map(stringify).join(" ")}`);
}

export function warn(...args: unknown[]): void {
  Zotero.debug(`${PREFIX} WARN ${args.map(stringify).join(" ")}`);
}

export function error(...args: unknown[]): void {
  Zotero.debug(`${PREFIX} ERROR ${args.map(stringify).join(" ")}`);
}

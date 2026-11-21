import { config } from "../../package.json";
import { warn } from "./logger";

interface FluentPattern {
  value: string | null;
  attributes: Array<{ name: string; value: string }> | null;
}

let l10n: any;

/** Load the addon FTL bundle. Called once during startup. */
export function initLocale(): void {
  try {
    const LocalizationCtor: any =
      typeof Localization === "undefined"
        ? (Zotero.getMainWindow() as any)?.Localization
        : Localization;
    l10n = new LocalizationCtor([`${config.addonRef}-addon.ftl`], true);
  } catch (e) {
    warn("Failed to initialize locale", e);
  }
}

/**
 * Read a localized string. Falls back to the key itself, so a missing
 * translation never breaks the UI.
 */
export function getString(key: string, args?: Record<string, unknown>): string {
  const id = `${config.addonRef}-${key}`;
  try {
    const pattern = l10n?.formatMessagesSync([{ id, args }])?.[0] as
      FluentPattern | undefined;
    return pattern?.value || id;
  } catch (e) {
    warn("Failed to format string", key, e);
    return id;
  }
}

export function getLocaleID(key: string): string {
  return `${config.addonRef}-${key}`;
}

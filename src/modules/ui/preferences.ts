/**
 * Settings pane logic.
 *
 * Values are read/written explicitly through `Zotero.Prefs` instead of relying
 * on `preference=` auto-binding: HTML inputs, XUL checkboxes and textareas have
 * subtly different binding rules, and the prompt templates need normalising
 * before they are stored.
 */

import { getString } from "../../utils/locale";
import { getPref, setPref, setPrefRaw } from "../../utils/prefs";
import {
  PROVIDER_FIELD_KEYS,
  PROVIDER_IDS,
  PROVIDERS,
  normalizeProviderId,
  parseProviderCredentials,
  serializeProviderCredentials,
  switchProviderCredentials,
  type ProviderCredentialValues,
  type ProviderId,
} from "../llm/providers";
import {
  buildProfiles,
  isDefaultProfiles,
  parseProfiles,
  readProfileTemplates,
  stringifyProfiles,
} from "../llm/prompt";
import { normalizePopupFontSize } from "../reader/popupFontSize";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

type PrefKey = keyof _ZoteroTypes.Prefs["PluginPrefsMap"];

const TEXT_KEYS = [
  "apiKey",
  "baseURL",
  "model",
  "temperature",
] as const satisfies readonly PrefKey[];

const NUMBER_KEYS = [
  "maxTokens",
  "wordMaxWords",
  "wordMaxChars",
  "maxSentenceChars",
  "requestTimeoutMs",
] as const satisfies readonly PrefKey[];

const BOOL_KEYS = [
  "useContext",
  "sentenceContextNeighbors",
  "showInPopup",
  "autoTranslate",
  "shortcutEnabled",
  "debug",
] as const satisfies readonly PrefKey[];

function byId<T extends HTMLElement>(win: Window, name: string): T | null {
  return win.document.getElementById(`sl-${name}`) as T | null;
}

function addOption(
  win: Window,
  select: HTMLSelectElement,
  value: string,
  label: string,
): void {
  const option = win.document.createElementNS(
    XHTML_NS,
    "option",
  ) as HTMLOptionElement;
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function populateStaticSelects(win: Window): void {
  const providerSelect = byId<HTMLSelectElement>(win, "provider");
  if (providerSelect && !providerSelect.options.length) {
    for (const id of PROVIDER_IDS) {
      addOption(win, providerSelect, id, PROVIDERS[id].label);
    }
  }

  const kindSelect = byId<HTMLSelectElement>(win, "selectionKindMode");
  if (kindSelect && !kindSelect.options.length) {
    addOption(win, kindSelect, "auto", getString("pref-kind-auto"));
    addOption(win, kindSelect, "alwaysWord", getString("pref-kind-word"));
    addOption(
      win,
      kindSelect,
      "alwaysSentence",
      getString("pref-kind-sentence"),
    );
  }
}

function syncFromPrefs(win: Window): void {
  const providerSelect = byId<HTMLSelectElement>(win, "provider");
  if (providerSelect) {
    providerSelect.value = normalizeProviderId(getPref("provider"));
  }
  const kindSelect = byId<HTMLSelectElement>(win, "selectionKindMode");
  if (kindSelect) {
    kindSelect.value = String(getPref("selectionKindMode") || "auto");
  }

  for (const key of TEXT_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    if (input) {
      input.value = String(getPref(key) ?? "");
    }
  }
  for (const key of NUMBER_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    if (input) {
      input.value = String(getPref(key) ?? "");
    }
  }
  for (const key of BOOL_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    if (input) {
      input.checked = Boolean(getPref(key));
    }
  }

  // Kept out of NUMBER_KEYS because the value is clamped before it is stored.
  const fontSizeInput = byId<HTMLInputElement>(win, "popupFontSize");
  if (fontSizeInput) {
    fontSizeInput.value = String(
      normalizePopupFontSize(getPref("popupFontSize")),
    );
  }

  syncPromptTemplates(win);
  updatePlaceholders(win);
}

/** Show the preset values as placeholders so "blank = preset" is discoverable. */
function updatePlaceholders(win: Window): void {
  const provider = normalizeProviderId(getPref("provider"));
  const preset = PROVIDERS[provider];
  const baseURL = byId<HTMLInputElement>(win, "baseURL");
  if (baseURL) {
    baseURL.placeholder = preset.baseURL || "https://example.com/v1";
  }
  const model = byId<HTMLInputElement>(win, "model");
  if (model) {
    model.placeholder = preset.model || "model-name";
  }
}

/** Current contents of the three provider-owned inputs. */
function readProviderInputs(win: Window): ProviderCredentialValues {
  return {
    apiKey: byId<HTMLInputElement>(win, "apiKey")?.value.trim() ?? "",
    baseURL: byId<HTMLInputElement>(win, "baseURL")?.value.trim() ?? "",
    model: byId<HTMLInputElement>(win, "model")?.value.trim() ?? "",
  };
}

function writeProviderInputs(
  win: Window,
  values: ProviderCredentialValues,
): void {
  for (const key of PROVIDER_FIELD_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    if (input) {
      input.value = values[key];
    }
    setPref(key, values[key]);
  }
}

/**
 * Switching presets must also switch the saved key / URL / model.
 *
 * The flat prefs always describe the active provider (the pipeline reads them),
 * while `providerConfigs` remembers the other providers, so going
 * OpenAI -> DeepSeek -> OpenAI restores each side's own values.
 */
function switchProvider(win: Window, next: ProviderId): void {
  const previous = normalizeProviderId(getPref("provider"));
  const { credentials, values } = switchProviderCredentials(
    parseProviderCredentials(getPref("providerConfigs")),
    previous,
    next,
    readProviderInputs(win),
  );
  setPref("providerConfigs", serializeProviderCredentials(credentials));
  setPref("provider", next);
  writeProviderInputs(win, values);
}

/** Fill the two prompt textareas from the stored templates. */
function syncPromptTemplates(win: Window): void {
  const templates = readProfileTemplates(
    parseProfiles(getPref("promptProfiles")),
  );
  const wordBox = byId<HTMLTextAreaElement>(win, "promptWord");
  if (wordBox) {
    wordBox.value = templates.word;
  }
  const sentenceBox = byId<HTMLTextAreaElement>(win, "promptSentence");
  if (sentenceBox) {
    sentenceBox.value = templates.sentence;
  }
}

function setPromptStatus(win: Window, message: string): void {
  const status = byId<HTMLElement>(win, "prompt-status");
  if (status) {
    status.textContent = message;
  }
}

/**
 * Store both textareas.
 *
 * The pref stays empty while both templates match the built-ins, so a future
 * release can still improve the defaults without overwriting untouched
 * settings. A blank box is restored to its built-in prompt instead of being
 * saved as an empty system message, which every model would ignore.
 */
function savePromptTemplates(win: Window): void {
  const wordBox = byId<HTMLTextAreaElement>(win, "promptWord");
  const sentenceBox = byId<HTMLTextAreaElement>(win, "promptSentence");
  if (!wordBox || !sentenceBox) {
    return;
  }
  const blank = !wordBox.value.trim() || !sentenceBox.value.trim();
  const profiles = buildProfiles(
    { word: wordBox.value, sentence: sentenceBox.value },
    parseProfiles(getPref("promptProfiles")),
  );
  setPref(
    "promptProfiles",
    isDefaultProfiles(profiles) ? "" : stringifyProfiles(profiles),
  );
  if (blank) {
    // Show the restored prompt so a cleared box cannot look saved-as-empty.
    syncPromptTemplates(win);
    setPromptStatus(win, getString("pref-profile-empty-reset"));
  } else {
    setPromptStatus(win, "");
  }
}

const bound = new WeakSet<Window>();

function bindEvents(win: Window): void {
  const providerSelect = byId<HTMLSelectElement>(win, "provider");
  providerSelect?.addEventListener("change", () => {
    switchProvider(win, normalizeProviderId(providerSelect.value));
    updatePlaceholders(win);
  });

  const kindSelect = byId<HTMLSelectElement>(win, "selectionKindMode");
  kindSelect?.addEventListener("change", () => {
    setPref("selectionKindMode", kindSelect.value);
  });

  for (const key of TEXT_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    input?.addEventListener("change", () => setPref(key, input.value.trim()));
  }

  for (const key of NUMBER_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    input?.addEventListener("change", () => {
      const value = Number(input.value);
      if (Number.isFinite(value) && value > 0) {
        setPrefRaw(key, value);
      }
    });
  }

  for (const key of BOOL_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    input?.addEventListener("command", () => setPrefRaw(key, input.checked));
    input?.addEventListener("change", () => setPrefRaw(key, input.checked));
  }

  const fontSizeInput = byId<HTMLInputElement>(win, "popupFontSize");
  fontSizeInput?.addEventListener("change", () => {
    const size = normalizePopupFontSize(fontSizeInput.value);
    // Show the clamped value so a typo (or a cleared field) cannot look saved.
    fontSizeInput.value = String(size);
    setPref("popupFontSize", size);
  });

  for (const key of ["promptWord", "promptSentence"] as const) {
    const textarea = byId<HTMLTextAreaElement>(win, key);
    textarea?.addEventListener("change", () => savePromptTemplates(win));
  }

  const resetBtn = byId<HTMLButtonElement>(win, "reset-profiles");
  resetBtn?.addEventListener("click", () => {
    setPref("promptProfiles", "");
    syncPromptTemplates(win);
    setPromptStatus(win, "");
  });
}

/** Entry point, called from `preferences.xhtml` via `onPrefsEvent("load")`. */
export function registerPrefsScripts(win: Window): void {
  populateStaticSelects(win);
  syncFromPrefs(win);
  if (!bound.has(win)) {
    bound.add(win);
    bindEvents(win);
  }
}

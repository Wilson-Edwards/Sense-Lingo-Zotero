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
  DEFAULT_PROFILE_ID,
  PROFILE_KINDS,
  activeProfileId,
  addProfile,
  defaultNameFor,
  defaultSystemFor,
  isBuiltinProfileId,
  isDefaultProfiles,
  parseProfiles,
  profileKind,
  profileList,
  removeProfile,
  stringifyProfiles,
  updateProfile,
  type PromptProfiles,
} from "../llm/prompt";
import type { SelectionKind } from "../reader/selectionKind";
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
  "stream",
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

/** DOM ids of one kind's preset editor. */
interface PromptEditorIds {
  select: string;
  name: string;
  system: string;
  create: string;
  duplicate: string;
  remove: string;
}

const PROMPT_EDITORS: Record<SelectionKind, PromptEditorIds> = {
  word: {
    select: "promptWordSelect",
    name: "promptWordName",
    system: "promptWord",
    create: "promptWordNew",
    duplicate: "promptWordCopy",
    remove: "promptWordDelete",
  },
  sentence: {
    select: "promptSentenceSelect",
    name: "promptSentenceName",
    system: "promptSentence",
    create: "promptSentenceNew",
    duplicate: "promptSentenceCopy",
    remove: "promptSentenceDelete",
  },
};

/** Which preset each kind is showing; kept per pane window. */
const promptState = new WeakMap<
  Window,
  Partial<Record<SelectionKind, string>>
>();

function routingPrefFor(
  kind: SelectionKind,
): "promptProfileWord" | "promptProfileSentence" {
  return kind === "word" ? "promptProfileWord" : "promptProfileSentence";
}

function readPromptLibrary(): PromptProfiles {
  return parseProfiles(getPref("promptProfiles"));
}

/**
 * The pref stays empty while the library is just the built-ins, so a future
 * release can still improve the defaults without overwriting untouched
 * settings.
 */
function storePromptLibrary(profiles: PromptProfiles): void {
  setPref(
    "promptProfiles",
    isDefaultProfiles(profiles) ? "" : stringifyProfiles(profiles),
  );
}

function setPromptStatus(win: Window, message: string): void {
  const status = byId<HTMLElement>(win, "prompt-status");
  if (status) {
    status.textContent = message;
  }
}

/** Draw one kind's preset list and load the selected preset into the fields. */
function renderPromptEditor(
  win: Window,
  kind: SelectionKind,
  profiles: PromptProfiles = readPromptLibrary(),
): void {
  const ids = PROMPT_EDITORS[kind];
  const state = promptState.get(win) ?? {};
  promptState.set(win, state);

  const list = profileList(profiles, kind);
  const fallbackId = list[0]?.id ?? DEFAULT_PROFILE_ID[kind];
  let id = state[kind];
  if (!id || !profiles[id] || profileKind(id, profiles[id]) !== kind) {
    id = fallbackId;
  }
  state[kind] = id;

  const select = byId<HTMLSelectElement>(win, ids.select);
  if (select) {
    select.textContent = "";
    for (const entry of list) {
      addOption(win, select, entry.id, entry.name);
    }
    select.value = id;
  }

  const profile = profiles[id];
  const nameInput = byId<HTMLInputElement>(win, ids.name);
  if (nameInput) {
    nameInput.value = profile?.name ?? id;
  }
  const systemBox = byId<HTMLTextAreaElement>(win, ids.system);
  if (systemBox) {
    systemBox.value = profile?.system ?? defaultSystemFor(kind);
  }

  const removeBtn = byId<HTMLButtonElement>(win, ids.remove);
  if (removeBtn) {
    removeBtn.disabled = isBuiltinProfileId(id);
  }
}

/** Load both kinds from prefs (called when the pane is shown). */
function syncPromptTemplates(win: Window): void {
  const profiles = readPromptLibrary();
  const state = promptState.get(win) ?? {};
  promptState.set(win, state);
  state.word = activeProfileId(profiles, "word", getPref("promptProfileWord"));
  state.sentence = activeProfileId(
    profiles,
    "sentence",
    getPref("promptProfileSentence"),
  );
  for (const kind of PROFILE_KINDS) {
    renderPromptEditor(win, kind, profiles);
  }
}

/**
 * Write the visible fields back into the store.
 *
 * `id` defaults to the preset currently shown; the select handler passes the
 * previous id because the DOM already holds the newly chosen one. A blank
 * system prompt is restored to the built-in for that kind instead of being
 * saved as an empty system message, which every model would ignore.
 */
function commitPromptEditor(
  win: Window,
  kind: SelectionKind,
  id?: string,
): PromptProfiles {
  const ids = PROMPT_EDITORS[kind];
  const current = readPromptLibrary();
  const target = id ?? promptState.get(win)?.[kind];
  if (!target || !current[target]) {
    return current;
  }

  const nameInput = byId<HTMLInputElement>(win, ids.name);
  const systemBox = byId<HTMLTextAreaElement>(win, ids.system);
  const system = systemBox?.value ?? current[target].system;
  if (systemBox && !system.trim()) {
    // Show the restored prompt so a cleared box cannot look saved-as-empty.
    systemBox.value = defaultSystemFor(kind);
    setPromptStatus(win, getString("pref-profile-empty-reset"));
  }

  const next = updateProfile(current, target, {
    name: nameInput?.value,
    system: system.trim() ? system : defaultSystemFor(kind),
  });
  storePromptLibrary(next);
  return next;
}

/** Pick the preset that translations of this kind use by default. */
function selectPromptProfile(
  win: Window,
  kind: SelectionKind,
  id: string,
): void {
  // The select already holds the new id, so the fields still belong to the
  // previously shown preset and must be committed before switching.
  const profiles = commitPromptEditor(win, kind);
  const state = promptState.get(win) ?? {};
  promptState.set(win, state);
  state[kind] =
    profiles[id] && profileKind(id, profiles[id]) === kind
      ? id
      : activeProfileId(profiles, kind);
  setPref(routingPrefFor(kind), state[kind]!);
  setPromptStatus(win, "");
  renderPromptEditor(win, kind, profiles);
}

/** Add a preset, either from the built-in or as a copy of the current one. */
function addPromptProfile(
  win: Window,
  kind: SelectionKind,
  mode: "new" | "copy",
): void {
  const current = commitPromptEditor(win, kind);
  const state = promptState.get(win) ?? {};
  const id = state[kind];
  const baseName = (id && current[id]?.name) || defaultNameFor(kind);
  const name =
    mode === "copy"
      ? `${baseName}${getString("pref-prompt-copy-suffix")}`
      : `${defaultNameFor(kind)} ${profileList(current, kind).length + 1}`;
  const created = addProfile(current, kind, {
    basedOn: mode === "copy" && id ? id : DEFAULT_PROFILE_ID[kind],
    name,
  });
  storePromptLibrary(created.profiles);
  state[kind] = created.id;
  setPref(routingPrefFor(kind), created.id);
  setPromptStatus(win, "");
  renderPromptEditor(win, kind, created.profiles);
  byId<HTMLInputElement>(win, PROMPT_EDITORS[kind].name)?.focus();
}

/** Delete a user preset; the built-in one is protected. */
function deletePromptProfile(win: Window, kind: SelectionKind): void {
  const state = promptState.get(win) ?? {};
  const current = readPromptLibrary();
  const id = state[kind];
  if (!id || isBuiltinProfileId(id)) {
    return;
  }
  const next = removeProfile(current, id);
  storePromptLibrary(next);
  // Deleting the active preset must not leave the router pointing at nothing.
  const fallback = activeProfileId(next, kind);
  state[kind] = fallback;
  setPref(routingPrefFor(kind), fallback);
  setPromptStatus(win, "");
  renderPromptEditor(win, kind, next);
}

/** Drop every custom preset and go back to the built-in defaults. */
function resetPromptProfiles(win: Window): void {
  setPref("promptProfiles", "");
  setPref("promptProfileWord", DEFAULT_PROFILE_ID.word);
  setPref("promptProfileSentence", DEFAULT_PROFILE_ID.sentence);
  const state = promptState.get(win) ?? {};
  promptState.set(win, state);
  state.word = DEFAULT_PROFILE_ID.word;
  state.sentence = DEFAULT_PROFILE_ID.sentence;
  const profiles = parseProfiles("");
  for (const kind of PROFILE_KINDS) {
    renderPromptEditor(win, kind, profiles);
  }
  setPromptStatus(win, "");
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

  for (const kind of PROFILE_KINDS) {
    const ids = PROMPT_EDITORS[kind];
    const select = byId<HTMLSelectElement>(win, ids.select);
    select?.addEventListener("change", () => {
      selectPromptProfile(win, kind, select.value);
    });

    for (const key of [ids.name, ids.system]) {
      const field = byId<HTMLInputElement | HTMLTextAreaElement>(win, key);
      field?.addEventListener("change", () => {
        renderPromptEditor(win, kind, commitPromptEditor(win, kind));
      });
    }

    byId<HTMLButtonElement>(win, ids.create)?.addEventListener("click", () => {
      addPromptProfile(win, kind, "new");
    });
    byId<HTMLButtonElement>(win, ids.duplicate)?.addEventListener(
      "click",
      () => {
        addPromptProfile(win, kind, "copy");
      },
    );
    byId<HTMLButtonElement>(win, ids.remove)?.addEventListener("click", () => {
      deletePromptProfile(win, kind);
    });
  }

  const resetBtn = byId<HTMLButtonElement>(win, "reset-profiles");
  resetBtn?.addEventListener("click", () => {
    resetPromptProfiles(win);
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

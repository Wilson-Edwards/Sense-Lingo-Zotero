/**
 * Settings pane logic.
 *
 * Values are read/written explicitly through `Zotero.Prefs` instead of relying
 * on `preference=` auto-binding: HTML inputs, XUL checkboxes and textareas have
 * subtly different binding rules, and the prompt templates need normalising
 * before they are stored.
 */

import { getString } from "../../utils/locale";
import { getNumberPref, getPref, setPref, setPrefRaw } from "../../utils/prefs";
import { clearCache, getCacheStats } from "../cache/db";
import { fetchModelIds } from "../llm/client";
import {
  EMPTY_PROVIDER_CREDENTIALS,
  PROVIDER_IDS,
  PROVIDERS,
  canDisableThinking,
  modelChoices,
  normalizeModelId,
  normalizeProviderId,
  parkProviderCredentials,
  parseProviderCredentials,
  parseProviderId,
  presetModelIds,
  resolveProviderConfig,
  serializeProviderCredentials,
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
import {
  cancelActiveJob,
  isJobRunning,
  startPreprocess,
} from "../preprocess/job";
import { isEpubAttachment } from "../preprocess/menu";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

type PrefKey = keyof _ZoteroTypes.Prefs["PluginPrefsMap"];

const TEXT_KEYS = [
  "apiKey",
  "baseURL",
  "model",
  "temperature",
] as const satisfies readonly PrefKey[];

/** Text inputs of the preprocessing provider (their own flat prefs). */
const PREFETCH_TEXT_KEYS = [
  "prefetchApiKey",
  "prefetchBaseURL",
  "prefetchModel",
] as const satisfies readonly PrefKey[];

const NUMBER_KEYS = [
  "maxTokens",
  "wordMaxWords",
  "wordMaxChars",
  "maxSentenceChars",
  "requestTimeoutMs",
  "prefetchConcurrency",
  "prefetchBatchSize",
  "prefetchMinOccurrences",
  "prefetchMaxWords",
  "prefetchMaxSentencesPerWord",
  "prefetchDelayMs",
] as const satisfies readonly PrefKey[];

const BOOL_KEYS = [
  "useContext",
  "sentenceContextNeighbors",
  "showInPopup",
  "autoTranslate",
  "shortcutEnabled",
  "stream",
  "disableThinking",
  "debug",
  "cacheEnabled",
  "cacheStrictSentence",
  "cacheSingleCandidateFallback",
  "autoCacheOnMiss",
  "prefetchOnOpen",
] as const satisfies readonly PrefKey[];

/**
 * One provider form in the pane. `translation` drives click / shortcut
 * translation, `preprocess` drives whole-book pre-translation; both read and
 * write their own flat prefs so the two keys never overwrite each other.
 */
type ProviderScope = "translation" | "preprocess";

interface ProviderScopeIds {
  provider: string;
  apiKey: string;
  baseURL: string;
  modelSelect: string;
  modelFetch: string;
  model: string;
  modelStatus: string;
}

const PROVIDER_SCOPES: Record<ProviderScope, ProviderScopeIds> = {
  translation: {
    provider: "provider",
    apiKey: "apiKey",
    baseURL: "baseURL",
    modelSelect: "modelSelect",
    modelFetch: "modelFetch",
    model: "model",
    modelStatus: "model-status",
  },
  preprocess: {
    provider: "prefetchProvider",
    apiKey: "prefetchApiKey",
    baseURL: "prefetchBaseURL",
    modelSelect: "prefetchModelSelect",
    modelFetch: "prefetchModelFetch",
    model: "prefetchModel",
    modelStatus: "prefetch-model-status",
  },
};

interface ProviderScopePrefKeys {
  provider: "provider" | "prefetchProvider";
  apiKey: "apiKey" | "prefetchApiKey";
  baseURL: "baseURL" | "prefetchBaseURL";
  model: "model" | "prefetchModel";
  providerConfigs: "providerConfigs" | "prefetchProviderConfigs";
}

const PROVIDER_SCOPE_PREFS: Record<ProviderScope, ProviderScopePrefKeys> = {
  translation: {
    provider: "provider",
    apiKey: "apiKey",
    baseURL: "baseURL",
    model: "model",
    providerConfigs: "providerConfigs",
  },
  preprocess: {
    provider: "prefetchProvider",
    apiKey: "prefetchApiKey",
    baseURL: "prefetchBaseURL",
    model: "prefetchModel",
    providerConfigs: "prefetchProviderConfigs",
  },
};

/** The provider the scope is set to, or `null` when it follows another scope. */
function chosenScopeProvider(scope: ProviderScope): ProviderId | null {
  const raw = getPref(PROVIDER_SCOPE_PREFS[scope].provider);
  return scope === "translation"
    ? normalizeProviderId(raw)
    : parseProviderId(raw);
}

/** The provider whose preset fills the placeholders / model list. */
function effectiveScopeProvider(scope: ProviderScope): ProviderId {
  return chosenScopeProvider(scope) ?? normalizeProviderId(getPref("provider"));
}
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

  // The first entry is the empty value: "follow the translation provider".
  const prefetchSelect = byId<HTMLSelectElement>(win, "prefetchProvider");
  if (prefetchSelect && !prefetchSelect.options.length) {
    addOption(win, prefetchSelect, "", getString("pref-prefetch-follow"));
    for (const id of PROVIDER_IDS) {
      addOption(win, prefetchSelect, id, PROVIDERS[id].label);
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
  const prefetchSelect = byId<HTMLSelectElement>(win, "prefetchProvider");
  if (prefetchSelect) {
    prefetchSelect.value = parseProviderId(getPref("prefetchProvider")) ?? "";
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
  for (const key of PREFETCH_TEXT_KEYS) {
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
  updateScopeAvailability(win);
  updatePlaceholders(win, "translation");
  updatePlaceholders(win, "preprocess");
  updateThinkingToggle(win);
}

/** Show the preset values as placeholders so "blank = preset" is discoverable. */
function updatePlaceholders(win: Window, scope: ProviderScope): void {
  const ids = PROVIDER_SCOPES[scope];
  const preset = PROVIDERS[effectiveScopeProvider(scope)];
  const baseURL = byId<HTMLInputElement>(win, ids.baseURL);
  if (baseURL) {
    baseURL.placeholder = preset.baseURL || "https://example.com/v1";
  }
  const model = byId<HTMLInputElement>(win, ids.model);
  if (model) {
    model.placeholder = preset.model || "model-name";
  }
}

/**
 * When the preprocessing scope follows the translation provider, its own three
 * fields are unused: disable them instead of letting the user type into a form
 * that would be ignored (and keep the flat prefs blank meanwhile).
 */
function updateScopeAvailability(win: Window): void {
  const ids = PROVIDER_SCOPES.preprocess;
  const following = !parseProviderId(getPref("prefetchProvider"));
  for (const key of [
    ids.apiKey,
    ids.baseURL,
    ids.modelSelect,
    ids.modelFetch,
    ids.model,
  ]) {
    const input = byId<HTMLElement>(win, key) as
      (HTMLElement & { disabled: boolean }) | null;
    if (input) {
      input.disabled = following;
    }
  }
  const hint = byId<HTMLElement>(win, "prefetch-provider-hint");
  if (hint) {
    hint.textContent = following ? getString("pref-prefetch-follow-hint") : "";
  }
}

/**
 * Gate the "disable thinking" switch on the presets.
 *
 * The request field it controls is only accepted by some gateways, so the box
 * stays disabled while neither scope talks to a provider that honors it. Both
 * scopes share the toggle, hence both are considered.
 */
function updateThinkingToggle(win: Window): void {
  const prefetch = parseProviderId(getPref("prefetchProvider"));
  const supported =
    canDisableThinking(normalizeProviderId(getPref("provider"))) ||
    (!!prefetch && canDisableThinking(prefetch));
  const input = byId<HTMLInputElement>(win, "disableThinking");
  if (input) {
    input.disabled = !supported;
  }
  const hint = byId<HTMLElement>(win, "thinking-hint");
  if (hint) {
    hint.textContent = supported
      ? ""
      : getString("pref-disable-thinking-unsupported");
  }
}

/** Current contents of one scope's three provider-owned inputs. */
function readProviderInputs(
  win: Window,
  scope: ProviderScope,
): ProviderCredentialValues {
  const ids = PROVIDER_SCOPES[scope];
  return {
    apiKey: byId<HTMLInputElement>(win, ids.apiKey)?.value.trim() ?? "",
    baseURL: byId<HTMLInputElement>(win, ids.baseURL)?.value.trim() ?? "",
    model: byId<HTMLInputElement>(win, ids.model)?.value.trim() ?? "",
  };
}

function writeProviderInputs(
  win: Window,
  scope: ProviderScope,
  values: ProviderCredentialValues,
): void {
  const ids = PROVIDER_SCOPES[scope];
  const prefKeys = PROVIDER_SCOPE_PREFS[scope];
  const fields: Array<[string, PrefKey, string]> = [
    [ids.apiKey, prefKeys.apiKey, values.apiKey],
    [ids.baseURL, prefKeys.baseURL, values.baseURL],
    [ids.model, prefKeys.model, values.model],
  ];
  for (const [domId, prefKey, value] of fields) {
    const input = byId<HTMLInputElement>(win, domId);
    if (input) {
      input.value = value;
    }
    setPref(prefKey, value);
  }
}

/** One-line feedback under a scope's model field. */
function setModelStatus(
  win: Window,
  scope: ProviderScope,
  message: string,
): void {
  const status = byId<HTMLElement>(win, PROVIDER_SCOPES[scope].modelStatus);
  if (status) {
    status.textContent = message;
  }
}

/** Model ids each scope's dropdown currently offers, per pane window. */
const modelListState = new WeakMap<
  Window,
  Partial<Record<ProviderScope, string[]>>
>();

function storedModelIds(win: Window, scope: ProviderScope): string[] {
  return modelListState.get(win)?.[scope] ?? [];
}

/**
 * Draw a scope's model dropdown from the offered ids.
 *
 * `<datalist>` is never rendered in Zotero's XUL-hosted preferences document,
 * so the choices are real `<option>`s: the first one is the empty value, which
 * means "use the preset model" (exactly what a blank `model` pref does), the
 * rest are model ids, and a hand-typed id is appended so the two controls never
 * disagree. The text field below stays free-form for models the list lacks.
 */
function renderModelSelect(win: Window, scope: ProviderScope): void {
  const ids = PROVIDER_SCOPES[scope];
  const select = byId<HTMLSelectElement>(win, ids.modelSelect);
  if (!select) {
    return;
  }
  const provider = effectiveScopeProvider(scope);
  const current = byId<HTMLInputElement>(win, ids.model)?.value.trim() ?? "";
  select.textContent = "";
  addOption(
    win,
    select,
    "",
    getString("pref-model-use-preset", {
      model: PROVIDERS[provider].model || "-",
    }),
  );
  for (const id of modelChoices(storedModelIds(win, scope), current)) {
    if (id) {
      addOption(win, select, id, id);
    }
  }
  select.value = current;
}

/** Offer `ids` in a scope's dropdown, keeping the value in the text field. */
function setModelOptions(
  win: Window,
  scope: ProviderScope,
  ids: readonly string[],
): void {
  const state = modelListState.get(win) ?? {};
  state[scope] = [...ids];
  modelListState.set(win, state);
  renderModelSelect(win, scope);
}

/**
 * Reset a scope's dropdown to the preset's own models.
 *
 * ClinePass publishes no catalogue endpoint for its subscription aliases, so
 * this list is the only source there; seeding it means the pane is usable
 * before the first request (and before a key is entered). Switching presets
 * re-seeds, so another provider's models cannot be picked.
 */
function seedModelOptions(win: Window, scope: ProviderScope): void {
  setModelOptions(win, scope, presetModelIds(effectiveScopeProvider(scope)));
  setModelStatus(win, scope, "");
}

/**
 * Ask the provider for its model list and offer the ids as choices.
 *
 * ClinePass answers on the shared catalogue, which carries none of its
 * `cline-pass/...` aliases, so the result collapses back to the preset list;
 * the status line reports what was actually offered. A scope that follows the
 * other one has no provider of its own, so its button is disabled and this is a
 * no-op.
 */
async function loadModelOptions(
  win: Window,
  scope: ProviderScope,
): Promise<void> {
  const provider = chosenScopeProvider(scope);
  if (!provider) {
    return;
  }
  const button = byId<HTMLButtonElement>(
    win,
    PROVIDER_SCOPES[scope].modelFetch,
  );
  const values = readProviderInputs(win, scope);
  if (!values.apiKey) {
    setModelStatus(win, scope, getString("pref-model-status-need-key"));
    return;
  }

  if (button) {
    button.disabled = true;
  }
  setModelStatus(win, scope, getString("pref-model-status-loading"));
  try {
    const ids = await fetchModelIds({
      config: resolveProviderConfig({
        provider,
        apiKey: values.apiKey,
        baseURL: values.baseURL,
        model: values.model,
      }),
      timeoutMs: getNumberPref("requestTimeoutMs", 30000),
    });
    setModelOptions(
      win,
      scope,
      ids.map((id) => normalizeModelId(provider, id)),
    );
    setModelStatus(
      win,
      scope,
      getString("pref-model-status-loaded", { count: ids.length }),
    );
  } catch (e) {
    // Keep the preset list on screen: a failed fetch must not leave the pane
    // with no choices at all.
    seedModelOptions(win, scope);
    setModelStatus(
      win,
      scope,
      getString("pref-model-status-failed", {
        error: (e as Error)?.message || String(e),
      }),
    );
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

/**
 * Seed the dropdown, and fetch the catalogue when there is nothing to seed.
 *
 * Presets that ship a verified list (ClinePass) are usable immediately; the
 * others can only offer models after `GET {baseURL}/models`, so a saved key
 * triggers one fetch on open instead of leaving the dropdown with just the
 * "use preset" entry.
 */
function maybeAutoFetchModelOptions(win: Window, scope: ProviderScope): void {
  const provider = chosenScopeProvider(scope);
  if (!provider || presetModelIds(provider).length) {
    return;
  }
  if (!readProviderInputs(win, scope).apiKey) {
    return;
  }
  void loadModelOptions(win, scope);
}

/**
 * Switching presets must also switch the saved key / URL / model.
 *
 * The flat prefs always describe the scope's active provider (the pipeline
 * reads them), while its `providerConfigs` pref remembers the other providers,
 * so OpenAI -> DeepSeek -> OpenAI restores each side's own values. Passing `""`
 * (only the preprocessing scope allows it) means "follow the translation
 * provider": the active values are archived and the flat prefs are blanked, so
 * follow mode is a real fallback instead of a stale copy.
 */
function switchProvider(
  win: Window,
  scope: ProviderScope,
  next: ProviderId | "",
): void {
  const prefKeys = PROVIDER_SCOPE_PREFS[scope];
  const previous = chosenScopeProvider(scope);
  const stored = parseProviderCredentials(getPref(prefKeys.providerConfigs));
  const parked = previous
    ? parkProviderCredentials(stored, previous, readProviderInputs(win, scope))
    : stored;
  setPref(prefKeys.providerConfigs, serializeProviderCredentials(parked));
  setPref(prefKeys.provider, next);
  writeProviderInputs(
    win,
    scope,
    next
      ? (parked[next] ?? EMPTY_PROVIDER_CREDENTIALS)
      : EMPTY_PROVIDER_CREDENTIALS,
  );
}

/** React to a scope's preset select: park/load values and refresh the pane. */
function onProviderChanged(win: Window, scope: ProviderScope): void {
  const select = byId<HTMLSelectElement>(win, PROVIDER_SCOPES[scope].provider);
  const raw = select?.value ?? "";
  const next =
    scope === "translation"
      ? normalizeProviderId(raw)
      : (parseProviderId(raw) ?? "");
  switchProvider(win, scope, next);
  updateScopeAvailability(win);
  updatePlaceholders(win, scope);
  updateThinkingToggle(win);
  seedModelOptions(win, scope);
  maybeAutoFetchModelOptions(win, scope);
  // A following preprocessing form mirrors the translation provider, so its
  // placeholders and preset model list must move with it.
  if (scope === "translation" && !chosenScopeProvider("preprocess")) {
    updatePlaceholders(win, "preprocess");
    seedModelOptions(win, "preprocess");
  }
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

/** Write a one-line status under the cache buttons. */
function setCacheStatus(win: Window, message: string): void {
  const status = byId<HTMLElement>(win, "cacheStatus");
  if (status) {
    status.textContent = message;
  }
}

/** The EPUB attachment selected in the library, when exactly one is selected. */
function selectedEpubAttachment(): Zotero.Item | null {
  try {
    const items = Zotero.getActiveZoteroPane()?.getSelectedItems?.() ?? [];
    if (items.length !== 1) {
      return null;
    }
    return isEpubAttachment(items[0]) ? items[0] : null;
  } catch {
    return null;
  }
}

/** Cache size, reported as counts and an estimated size (never as money). */
async function refreshCacheStats(win: Window): Promise<void> {
  const stats = await getCacheStats();
  setCacheStatus(
    win,
    getString("pref-cache-stats", {
      entries: String(stats.entries),
      attachments: String(stats.attachments),
      kb: String(Math.max(0, Math.round(stats.bytes / 1024))),
    }),
  );
}

const bound = new WeakSet<Window>();

function bindEvents(win: Window): void {
  // Both provider forms behave identically; only their DOM ids and prefs differ.
  for (const scope of ["translation", "preprocess"] as const) {
    const ids = PROVIDER_SCOPES[scope];

    byId<HTMLSelectElement>(win, ids.provider)?.addEventListener("change", () =>
      onProviderChanged(win, scope),
    );

    byId<HTMLButtonElement>(win, ids.modelFetch)?.addEventListener(
      "click",
      () => {
        void loadModelOptions(win, scope);
      },
    );

    // Two controls, one value: picking an option writes the text field (and the
    // pref), typing in the field re-selects the matching option (or adds one).
    byId<HTMLSelectElement>(win, ids.modelSelect)?.addEventListener(
      "change",
      (event) => {
        const select = event.target as HTMLSelectElement;
        const input = byId<HTMLInputElement>(win, ids.model);
        if (input) {
          input.value = select.value;
        }
        setPref(PROVIDER_SCOPE_PREFS[scope].model, select.value);
        renderModelSelect(win, scope);
      },
    );
    byId<HTMLInputElement>(win, ids.model)?.addEventListener("change", () => {
      renderModelSelect(win, scope);
    });
  }

  const kindSelect = byId<HTMLSelectElement>(win, "selectionKindMode");
  kindSelect?.addEventListener("change", () => {
    setPref("selectionKindMode", kindSelect.value);
  });

  for (const key of TEXT_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    input?.addEventListener("change", () => setPref(key, input.value.trim()));
  }

  for (const key of PREFETCH_TEXT_KEYS) {
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

  byId<HTMLButtonElement>(win, "cachePretranslate")?.addEventListener(
    "click",
    () => {
      if (isJobRunning()) {
        setCacheStatus(win, getString("pref-cache-busy"));
        return;
      }
      const item = selectedEpubAttachment();
      if (!item) {
        setCacheStatus(win, getString("pref-cache-select-epub"));
        return;
      }
      setCacheStatus(win, getString("pref-cache-running"));
      void startPreprocess(item.id).then(() => refreshCacheStats(win));
    },
  );

  byId<HTMLButtonElement>(win, "cacheStop")?.addEventListener("click", () => {
    if (!isJobRunning()) {
      setCacheStatus(win, getString("pref-cache-idle"));
      return;
    }
    cancelActiveJob();
    setCacheStatus(win, getString("pref-cache-stopping"));
  });

  byId<HTMLButtonElement>(win, "cacheRefresh")?.addEventListener(
    "click",
    () => {
      void refreshCacheStats(win);
    },
  );

  byId<HTMLButtonElement>(win, "cacheClear")?.addEventListener("click", () => {
    if (!win.confirm(getString("pref-cache-clear-confirm"))) {
      return;
    }
    void clearCache().then(() => refreshCacheStats(win));
  });
}

/** Entry point, called from `preferences.xhtml` via `onPrefsEvent("load")`. */
export function registerPrefsScripts(win: Window): void {
  populateStaticSelects(win);
  syncFromPrefs(win);
  seedModelOptions(win, "translation");
  seedModelOptions(win, "preprocess");
  maybeAutoFetchModelOptions(win, "translation");
  maybeAutoFetchModelOptions(win, "preprocess");
  void refreshCacheStats(win);
  if (!bound.has(win)) {
    bound.add(win);
    bindEvents(win);
  }
}

/**
 * Settings pane logic.
 *
 * Values are read/written explicitly through `Zotero.Prefs` instead of relying
 * on `preference=` auto-binding: HTML inputs, XUL checkboxes and textareas have
 * subtly different binding rules, and the prompt templates need normalising
 * before they are stored.
 */

import { getString } from "../../utils/locale";
import { warn } from "../../utils/logger";
import {
  NUMERIC_PREF_SCHEMA,
  getNumberPref,
  getPref,
  normalizeNumberPref,
  setPref,
  setPrefRaw,
  type NumericPrefKey,
} from "../../utils/prefs";
import {
  clearCache,
  getCacheStats,
  listAttachmentStates,
  type AttachmentState,
} from "../cache/db";
import { chatCompletion, fetchModelIds } from "../llm/client";
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
  defaultUserFor,
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
import { collectReaderDocuments } from "../reader/readerText";
import { renderPrompt } from "../llm/render";
import { canBatch } from "../preprocess/batch";
import {
  cancelActiveJob,
  getActiveJobProgress,
  isJobRunning,
  startPreprocess,
  subscribePreprocessProgress,
} from "../preprocess/job";
import { normalizePreprocessLanguageFilter } from "../preprocess/extract";
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
  "prefetchMaxSentencesPerWord",
  "prefetchDelayMs",
] as const satisfies readonly PrefKey[];

const LANGUAGE_CHOICES = [
  ["auto", "Auto"],
  ["zh-CN", "简体中文"],
  ["zh-TW", "繁體中文"],
  ["en", "English"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["ru", "Русский"],
] as const;

const PROMPT_VARIABLES = [
  "text",
  "word",
  "sentence",
  "prevSentence",
  "nextSentence",
  "sourceLang",
  "targetLang",
  "selectionType",
  "itemTitle",
] as const;

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

function setActiveTab(win: Window, tab: string): void {
  for (const panel of Array.from(
    win.document.querySelectorAll<HTMLElement>("[data-sl-tab-panel]"),
  )) {
    panel.hidden = panel.dataset.slTabPanel !== tab;
  }
  for (const button of Array.from(
    win.document.querySelectorAll<HTMLButtonElement>("[data-sl-tab]"),
  )) {
    const active = button.dataset.slTab === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
}

/** Move runtime knobs out of the everyday behaviour/provider forms. */
function organizePanels(win: Window): void {
  const advanced = byId<HTMLElement>(win, "advancedRuntime");
  if (advanced && advanced.childElementCount === 1) {
    for (const id of [
      "advanced-request-row",
      "advanced-thinking-row",
      "thinking-hint",
      "advanced-stream-row",
      "advanced-timeout-row",
      "advanced-debug-row",
    ]) {
      const row = byId<HTMLElement>(win, id);
      if (row) {
        advanced.appendChild(row);
      }
    }
  }
  for (const button of Array.from(
    win.document.querySelectorAll<HTMLButtonElement>("[data-sl-tab]"),
  )) {
    button.addEventListener("click", () =>
      setActiveTab(win, button.dataset.slTab ?? "basic"),
    );
  }
  setActiveTab(win, "basic");
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

  const languageFilter = byId<HTMLSelectElement>(win, "prefetchLanguageFilter");
  if (languageFilter && !languageFilter.options.length) {
    addOption(
      win,
      languageFilter,
      "system",
      getString("pref-prefetch-language-system"),
    );
    addOption(
      win,
      languageFilter,
      "none",
      getString("pref-prefetch-language-none"),
    );
    addOption(
      win,
      languageFilter,
      "han",
      getString("pref-prefetch-language-han"),
    );
    addOption(
      win,
      languageFilter,
      "latin",
      getString("pref-prefetch-language-latin"),
    );
  }

  for (const [name, allowAuto] of [
    ["targetLangSelect", false],
    ["sourceLangSelect", true],
  ] as const) {
    const select = byId<HTMLSelectElement>(win, name);
    if (!select || select.options.length) {
      continue;
    }
    for (const [value, label] of LANGUAGE_CHOICES) {
      if (value !== "auto" || allowAuto) {
        addOption(win, select, value, label);
      }
    }
    addOption(win, select, "__custom__", getString("pref-language-custom"));
  }

  for (const kind of PROFILE_KINDS) {
    const select = byId<HTMLSelectElement>(
      win,
      `${kind === "word" ? "promptWord" : "promptSentence"}Variable`,
    );
    if (select && !select.options.length) {
      for (const variable of PROMPT_VARIABLES) {
        addOption(win, select, `{${variable}}`, `{${variable}}`);
      }
    }
  }
}

function syncLanguageControl(
  win: Window,
  pref: "targetLang" | "sourceLang",
): void {
  const prefix = pref === "targetLang" ? "targetLang" : "sourceLang";
  const value = String(
    getPref(pref) || (pref === "targetLang" ? "zh-CN" : "auto"),
  );
  const select = byId<HTMLSelectElement>(win, `${prefix}Select`);
  const input = byId<HTMLInputElement>(win, prefix);
  if (input) {
    input.value = value;
  }
  if (select) {
    select.value = Array.from(select.options).some(
      (option) => option.value === value,
    )
      ? value
      : "__custom__";
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
  const languageFilter = byId<HTMLSelectElement>(win, "prefetchLanguageFilter");
  if (languageFilter) {
    languageFilter.value = normalizePreprocessLanguageFilter(
      getPref("prefetchLanguageFilter"),
    );
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
  deduplicateActiveProviderCredentials("translation");
  deduplicateActiveProviderCredentials("preprocess");
  for (const key of NUMBER_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    if (input) {
      const numericKey = key as NumericPrefKey;
      const spec = NUMERIC_PREF_SCHEMA[numericKey];
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      input.value = String(normalizeNumberPref(numericKey, getPref(key)));
    }
  }

  syncLanguageControl(win, "targetLang");
  syncLanguageControl(win, "sourceLang");
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
  updateEffectiveConfig(win, "translation");
  updateEffectiveConfig(win, "preprocess");
  updateDependentControls(win);
}

function deduplicateActiveProviderCredentials(scope: ProviderScope): void {
  const provider = chosenScopeProvider(scope);
  if (!provider) {
    return;
  }
  const keys = PROVIDER_SCOPE_PREFS[scope];
  const stored = parseProviderCredentials(getPref(keys.providerConfigs));
  const duplicate = stored[provider];
  const active = {
    apiKey: String(getPref(keys.apiKey) ?? ""),
    baseURL: String(getPref(keys.baseURL) ?? ""),
    model: String(getPref(keys.model) ?? ""),
  };
  if (
    duplicate &&
    duplicate.apiKey === active.apiKey &&
    duplicate.baseURL === active.baseURL &&
    duplicate.model === active.model
  ) {
    const inactive = { ...stored };
    delete inactive[provider];
    setPref(keys.providerConfigs, serializeProviderCredentials(inactive));
  }
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
      if (scopeFieldOwnsRow(key, ids)) {
        input.parentElement!.hidden = following;
      }
    }
  }
  const hint = byId<HTMLElement>(win, "prefetch-provider-hint");
  if (hint) {
    hint.textContent = following ? getString("pref-prefetch-follow-hint") : "";
  }
}

function scopeFieldOwnsRow(key: string, ids: ProviderScopeIds): boolean {
  return [ids.apiKey, ids.baseURL, ids.modelSelect, ids.model].includes(key);
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

function effectiveProviderConfigFromForm(win: Window, scope: ProviderScope) {
  const actualScope =
    scope === "preprocess" && !chosenScopeProvider("preprocess")
      ? "translation"
      : scope;
  const provider = effectiveScopeProvider(scope);
  const values = readProviderInputs(win, actualScope);
  const rawTemperature = Number.parseFloat(
    byId<HTMLInputElement>(win, "temperature")?.value || "0.3",
  );
  const temperature = Number.isFinite(rawTemperature) ? rawTemperature : 0.3;
  return resolveProviderConfig({
    provider,
    ...values,
    temperature: Math.min(2, Math.max(0, temperature)),
    maxTokens: normalizeNumberPref(
      "maxTokens",
      byId<HTMLInputElement>(win, "maxTokens")?.value,
    ),
    timeoutMs: normalizeNumberPref(
      "requestTimeoutMs",
      byId<HTMLInputElement>(win, "requestTimeoutMs")?.value,
    ),
    stream: true,
    disableThinking:
      byId<HTMLInputElement>(win, "disableThinking")?.checked ?? true,
  });
}

function updateEffectiveConfig(win: Window, scope: ProviderScope): void {
  const config = effectiveProviderConfigFromForm(win, scope);
  const id =
    scope === "translation" ? "effective-config" : "prefetch-effective-config";
  const node = byId<HTMLElement>(win, id);
  if (node) {
    node.textContent = getString("pref-effective-config", {
      url: config.baseURL || "-",
      model: config.model || "-",
      following:
        scope === "preprocess" && !chosenScopeProvider("preprocess")
          ? getString("pref-effective-following")
          : "",
    });
  }
}

async function testConnection(
  win: Window,
  scope: ProviderScope,
): Promise<void> {
  const button = byId<HTMLButtonElement>(
    win,
    scope === "translation" ? "testConnection" : "prefetchTestConnection",
  );
  const config = effectiveProviderConfigFromForm(win, scope);
  setModelStatus(win, scope, getString("pref-test-running"));
  if (button) {
    button.disabled = true;
  }
  try {
    let deltas = 0;
    const result = await chatCompletion({
      config: {
        ...config,
        maxTokens: Math.min(config.maxTokens, 64),
        stream: true,
      },
      messages: [
        { role: "system", content: "Return exactly OK." },
        { role: "user", content: "Connection test" },
      ],
      onDelta: () => {
        deltas += 1;
      },
    });
    setModelStatus(
      win,
      scope,
      getString("pref-test-ok", {
        latency: String(result.elapsedMs),
        model: result.model,
        stream: result.streamed || deltas > 0 ? "✓" : "—",
      }),
    );
  } catch (e) {
    setModelStatus(
      win,
      scope,
      getString("pref-test-failed", {
        error: (e as Error)?.message || String(e),
      }),
    );
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
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
  const nextValues = next
    ? (parked[next] ?? EMPTY_PROVIDER_CREDENTIALS)
    : EMPTY_PROVIDER_CREDENTIALS;
  // The active provider already lives in the flat prefs consumed at runtime;
  // keeping it in providerConfigs too creates a needless second plaintext key.
  const inactive = { ...parked };
  if (next) {
    delete inactive[next];
  }
  setPref(prefKeys.providerConfigs, serializeProviderCredentials(inactive));
  setPref(prefKeys.provider, next);
  writeProviderInputs(win, scope, nextValues);
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
  updateEffectiveConfig(win, scope);
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
  user: string;
  variable: string;
  insert: string;
  previewButton: string;
  preview: string;
  create: string;
  duplicate: string;
  remove: string;
}

const PROMPT_EDITORS: Record<SelectionKind, PromptEditorIds> = {
  word: {
    select: "promptWordSelect",
    name: "promptWordName",
    system: "promptWord",
    user: "promptWordUser",
    variable: "promptWordVariable",
    insert: "promptWordInsert",
    previewButton: "promptWordPreviewButton",
    preview: "promptWordPreview",
    create: "promptWordNew",
    duplicate: "promptWordCopy",
    remove: "promptWordDelete",
  },
  sentence: {
    select: "promptSentenceSelect",
    name: "promptSentenceName",
    system: "promptSentence",
    user: "promptSentenceUser",
    variable: "promptSentenceVariable",
    insert: "promptSentenceInsert",
    previewButton: "promptSentencePreviewButton",
    preview: "promptSentencePreview",
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
  const userBox = byId<HTMLTextAreaElement>(win, ids.user);
  if (userBox) {
    userBox.value = profile?.user ?? defaultUserFor(kind);
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
  const userBox = byId<HTMLTextAreaElement>(win, ids.user);
  const system = systemBox?.value ?? current[target].system;
  const user = userBox?.value ?? current[target].user;
  if (systemBox && !system.trim()) {
    // Show the restored prompt so a cleared box cannot look saved-as-empty.
    systemBox.value = defaultSystemFor(kind);
    setPromptStatus(win, getString("pref-profile-empty-reset"));
  }

  const next = updateProfile(current, target, {
    name: nameInput?.value,
    system: system.trim() ? system : defaultSystemFor(kind),
    user: user.trim() ? user : defaultUserFor(kind),
  });
  storePromptLibrary(next);
  validatePromptEditor(win, kind, next[target]);
  return next;
}

function validatePromptEditor(
  win: Window,
  kind: SelectionKind,
  profile: { system: string; user: string },
): void {
  const combined = `${profile.system}\n${profile.user}`;
  if (!/\{\s*(text|word)\s*\}/u.test(combined)) {
    setPromptStatus(win, getString("pref-prompt-warning-text"));
  } else if (kind === "word" && !canBatch(profile.system)) {
    setPromptStatus(win, getString("pref-prompt-warning-batch"));
  } else {
    setPromptStatus(win, getString("pref-prompt-saved"));
  }
}

function currentReaderSelection(): string {
  try {
    const readers = (Zotero.Reader._readers ?? []) as Array<{
      _iframeWindow?: { document?: Document };
    }>;
    for (const reader of [...readers].reverse()) {
      const root = reader._iframeWindow?.document;
      if (!root) {
        continue;
      }
      for (const doc of collectReaderDocuments(root)) {
        const selected = doc.getSelection?.()?.toString().trim();
        if (selected) {
          return selected;
        }
      }
    }
  } catch {
    // The preview falls back to a small sample below.
  }
  return "";
}

function renderPromptPreview(win: Window, kind: SelectionKind): void {
  const ids = PROMPT_EDITORS[kind];
  const system = byId<HTMLTextAreaElement>(win, ids.system)?.value ?? "";
  const user = byId<HTMLTextAreaElement>(win, ids.user)?.value ?? "";
  const selected =
    currentReaderSelection() ||
    (kind === "word" ? "mitigate" : "The proposed method works.");
  const vars = {
    text: selected,
    word: selected,
    sentence: kind === "word" ? `The new policy may ${selected} the risk.` : "",
    prevSentence: "Previous sentence.",
    nextSentence: "Next sentence.",
    sourceLang: String(getPref("sourceLang") || "auto"),
    targetLang: String(getPref("targetLang") || "zh-CN"),
    selectionType: kind,
    itemTitle: "Current Zotero item",
  };
  const preview = byId<HTMLElement>(win, ids.preview);
  if (preview) {
    preview.hidden = false;
    preview.textContent = `${getString("pref-system-prompt")}:\n${renderPrompt(
      system,
      vars,
    )}\n\n${getString("pref-user-prompt")}:\n${renderPrompt(user, vars)}`;
  }
}

function insertPromptVariable(win: Window, kind: SelectionKind): void {
  const ids = PROMPT_EDITORS[kind];
  const textarea = byId<HTMLTextAreaElement>(win, ids.user);
  const variable =
    byId<HTMLSelectElement>(win, ids.variable)?.value ?? "{text}";
  if (!textarea) {
    return;
  }
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  textarea.setRangeText(variable, start, end, "end");
  textarea.focus();
  setPromptStatus(win, getString("pref-prompt-unsaved"));
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

function updateDependentControls(win: Window): void {
  const cacheEnabled =
    byId<HTMLInputElement>(win, "cacheEnabled")?.checked ?? true;
  const useContext = byId<HTMLInputElement>(win, "useContext")?.checked ?? true;
  const running = isJobRunning();
  for (const id of [
    "autoCacheOnMiss",
    "cacheStrictSentence",
    "cacheSingleCandidateFallback",
    "prefetchOnOpen",
    "prefetchProvider",
    "prefetchBatchSize",
    "prefetchConcurrency",
    "prefetchDelayMs",
    "prefetchMaxSentencesPerWord",
    "prefetchLanguageFilter",
    "prefetchApiKey",
    "prefetchApiKeyToggle",
    "prefetchApiKeyClear",
    "prefetchBaseURL",
    "prefetchModelSelect",
    "prefetchModelFetch",
    "prefetchModel",
    "prefetchTestConnection",
  ]) {
    const control = byId<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >(win, id);
    if (control) {
      control.disabled = !cacheEnabled;
    }
  }
  if (cacheEnabled) {
    updateScopeAvailability(win);
  }
  const autoPrefetch = byId<HTMLInputElement>(win, "prefetchOnOpen");
  if (autoPrefetch) {
    autoPrefetch.disabled = !cacheEnabled || !useContext;
    autoPrefetch.title = !useContext
      ? getString("pref-prefetch-context-disabled")
      : "";
  }
  const pretranslate = byId<HTMLButtonElement>(win, "cachePretranslate");
  if (pretranslate) {
    pretranslate.disabled = !cacheEnabled || !useContext || running;
    pretranslate.title = !useContext
      ? getString("pref-prefetch-context-disabled")
      : "";
  }
  const clear = byId<HTMLButtonElement>(win, "cacheClear");
  if (clear) {
    clear.disabled = running;
    clear.title = running ? getString("pref-cache-stop-before-clear") : "";
  }
  const stop = byId<HTMLButtonElement>(win, "cacheStop");
  if (stop) {
    stop.disabled = !running;
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

type DisplayTask = AttachmentState & { active: boolean };

/** A task may outlive an attachment, so its last known filename is retained in the signature. */
function titleFromSignature(signature: string): string {
  const parts = signature.split("|");
  // `signatureOf()` writes `${modified}|${filename}|${length}`. Join the middle
  // pieces defensively: a filename is allowed to contain a vertical bar.
  const filename = parts.length >= 3 ? parts.slice(1, -1).join("|").trim() : "";
  return filename.replace(/\.epub$/i, "").trim();
}

/** Prefer the parent bibliographic title over Zotero's generic attachment label. */
function attachmentTitle(task: AttachmentState): string {
  try {
    const item = Zotero.Items.get(task.attachmentID);
    if (!item) {
      return (
        titleFromSignature(task.signature) ||
        getString("pref-task-missing-book", { id: String(task.attachmentID) })
      );
    }
    const parent = item.parentItemID
      ? Zotero.Items.get(item.parentItemID)
      : null;
    const parentTitle = parent ? parent.getField("title").trim() : "";
    const filename = (item.attachmentFilename ?? "")
      .replace(/\.epub$/i, "")
      .trim();
    return (
      parentTitle ||
      filename ||
      item.getField("title").trim() ||
      titleFromSignature(task.signature) ||
      getString("pref-task-unnamed-book", { id: String(task.attachmentID) })
    );
  } catch {
    return (
      titleFromSignature(task.signature) ||
      getString("pref-task-missing-book", { id: String(task.attachmentID) })
    );
  }
}

function taskStateLabel(state: AttachmentState["state"]): string {
  return getString(`pref-task-state-${state}`);
}

function taskProgressLabel(task: DisplayTask): string {
  if (task.active && !task.total) {
    return getString("pref-task-preparing");
  }
  return getString("pref-task-progress", {
    done: String(task.done),
    total: String(task.total),
    failed: String(task.failed),
  });
}

function taskButton(
  win: Window,
  label: string,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const button = win.document.createElementNS(
    XHTML_NS,
    "button",
  ) as HTMLButtonElement;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function taskAttachment(attachmentID: number): Zotero.Item | null {
  try {
    const item = Zotero.Items.get(attachmentID);
    return item && isEpubAttachment(item) ? item : null;
  } catch {
    return null;
  }
}

/** Select the attachment in the library, then open it in Zotero's reader. */
async function openTaskAttachment(
  win: Window,
  attachmentID: number,
): Promise<void> {
  if (!taskAttachment(attachmentID)) {
    setCacheStatus(win, getString("pref-task-missing"));
    return;
  }
  try {
    await Zotero.getActiveZoteroPane()?.selectItem?.(attachmentID, true);
    await Zotero.Reader.open?.(attachmentID);
  } catch (e) {
    warn("failed to open preprocessing attachment", attachmentID, e);
    setCacheStatus(win, getString("pref-task-open-failed"));
  }
}

async function runTask(win: Window, attachmentID: number): Promise<void> {
  if (isJobRunning()) {
    setCacheStatus(win, getString("pref-cache-busy"));
    return;
  }
  if (!taskAttachment(attachmentID)) {
    setCacheStatus(win, getString("pref-task-missing"));
    return;
  }
  setCacheStatus(win, getString("pref-cache-running"));
  const result = await startPreprocess(attachmentID);
  showPreprocessResult(win, result);
  await Promise.all([refreshCacheStats(win), refreshPreprocessTasks(win)]);
}

function showPreprocessResult(
  win: Window,
  result: Awaited<ReturnType<typeof startPreprocess>>,
): void {
  if (result.status === "done") {
    setCacheStatus(
      win,
      getString("pref-task-result-done", {
        done: String(result.done),
        failed: String(result.failed),
      }),
    );
  } else if (result.status === "cancelled") {
    setCacheStatus(win, getString("pref-task-result-cancelled"));
  } else if (result.status === "paused") {
    setCacheStatus(
      win,
      getString("pref-task-result-paused", { reason: result.reason ?? "" }),
    );
  } else {
    setCacheStatus(
      win,
      getString("pref-task-result-failed", { reason: result.reason }),
    );
  }
}

async function restartTask(win: Window, attachmentID: number): Promise<void> {
  if (isJobRunning()) {
    setCacheStatus(win, getString("pref-cache-busy"));
    return;
  }
  if (!taskAttachment(attachmentID)) {
    setCacheStatus(win, getString("pref-task-missing"));
    return;
  }
  if (!win.confirm(getString("pref-task-restart-confirm"))) {
    return;
  }
  await clearCache(attachmentID);
  await runTask(win, attachmentID);
}

async function deleteTaskCache(
  win: Window,
  attachmentID: number,
): Promise<void> {
  if (getActiveJobProgress()?.attachmentID === attachmentID) {
    setCacheStatus(win, getString("pref-task-stop-before-delete"));
    return;
  }
  if (!win.confirm(getString("pref-task-delete-confirm"))) {
    return;
  }
  await clearCache(attachmentID);
  await Promise.all([refreshCacheStats(win), refreshPreprocessTasks(win)]);
}

/** Draw the persistent per-book preprocessing task manager. */
async function refreshPreprocessTasks(win: Window): Promise<void> {
  const list = byId<HTMLElement>(win, "preprocessTasks");
  if (!list) {
    return;
  }
  updateDependentControls(win);
  const active = getActiveJobProgress();
  const states = await listAttachmentStates();
  const tasks: DisplayTask[] = states.map((state) => ({
    ...state,
    active: active?.attachmentID === state.attachmentID,
    ...(active?.attachmentID === state.attachmentID
      ? {
          state: "running" as const,
          total: active.total || state.total,
          done: active.done,
          failed: active.failed,
        }
      : {}),
  }));
  if (
    active &&
    !tasks.some((task) => task.attachmentID === active.attachmentID)
  ) {
    tasks.unshift({
      attachmentID: active.attachmentID,
      state: "running",
      signature: "",
      textLength: 0,
      total: active.total,
      done: active.done,
      failed: active.failed,
      updatedAt: Date.now(),
      active: true,
    });
  }
  tasks.sort(
    (a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt,
  );

  list.replaceChildren();
  if (!tasks.length) {
    const empty = win.document.createElementNS(XHTML_NS, "div");
    empty.className = "sl-task-empty";
    empty.textContent = getString("pref-task-empty");
    list.appendChild(empty);
    return;
  }

  for (const task of tasks) {
    const row = win.document.createElementNS(XHTML_NS, "div");
    row.className = "sl-task-row";
    const details = win.document.createElementNS(XHTML_NS, "div");
    details.className = "sl-task-details";
    const title = win.document.createElementNS(
      XHTML_NS,
      "button",
    ) as HTMLButtonElement;
    title.className = "sl-task-title";
    title.classList.add("sl-task-open");
    title.type = "button";
    title.textContent = attachmentTitle(task);
    const available = !!taskAttachment(task.attachmentID);
    title.disabled = !available;
    if (available) {
      title.title = getString("pref-task-open");
      title.addEventListener("click", () => {
        void openTaskAttachment(win, task.attachmentID);
      });
    }
    const meta = win.document.createElementNS(XHTML_NS, "div");
    meta.className = "sl-task-meta";
    meta.textContent = `${taskStateLabel(task.state)} · ${taskProgressLabel(task)}`;
    details.append(title, meta);

    const actions = win.document.createElementNS(XHTML_NS, "div");
    actions.className = "sl-task-actions";
    if (task.active) {
      actions.appendChild(
        taskButton(win, getString("pref-task-stop"), () => {
          cancelActiveJob();
          setCacheStatus(win, getString("pref-cache-stopping"));
        }),
      );
    } else if (
      task.state === "paused" ||
      task.state === "failed" ||
      task.state === "running"
    ) {
      actions.appendChild(
        taskButton(win, getString("pref-task-resume"), () => {
          void runTask(win, task.attachmentID);
        }),
      );
    }
    if (!task.active) {
      actions.appendChild(
        taskButton(win, getString("pref-task-restart"), () => {
          void restartTask(win, task.attachmentID);
        }),
      );
    }
    actions.appendChild(
      taskButton(
        win,
        getString("pref-task-delete"),
        () => {
          void deleteTaskCache(win, task.attachmentID);
        },
        task.active,
      ),
    );
    row.append(details, actions);
    list.appendChild(row);
  }
}

const taskRefreshSubscriptions = new WeakMap<Window, () => void>();

function startTaskRefresh(win: Window): void {
  if (taskRefreshSubscriptions.has(win)) {
    return;
  }
  let refreshQueued = false;
  const unsubscribe = subscribePreprocessProgress(() => {
    if (refreshQueued || win.document.visibilityState === "hidden") {
      return;
    }
    refreshQueued = true;
    win.setTimeout(() => {
      refreshQueued = false;
      void Promise.all([refreshPreprocessTasks(win), refreshCacheStats(win)]);
    }, 100);
  });
  taskRefreshSubscriptions.set(win, unsubscribe);
  win.addEventListener(
    "unload",
    () => {
      unsubscribe();
      taskRefreshSubscriptions.delete(win);
    },
    { once: true },
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
      updateEffectiveConfig(win, scope);
    });

    byId<HTMLButtonElement>(
      win,
      scope === "translation" ? "testConnection" : "prefetchTestConnection",
    )?.addEventListener("click", () => void testConnection(win, scope));

    const keyInput = byId<HTMLInputElement>(win, ids.apiKey);
    byId<HTMLButtonElement>(win, `${ids.apiKey}Toggle`)?.addEventListener(
      "click",
      (event) => {
        if (!keyInput) {
          return;
        }
        keyInput.type = keyInput.type === "password" ? "text" : "password";
        (event.currentTarget as HTMLButtonElement).textContent = getString(
          keyInput.type === "password" ? "pref-key-show" : "pref-key-hide",
        );
      },
    );
    byId<HTMLButtonElement>(win, `${ids.apiKey}Clear`)?.addEventListener(
      "click",
      () => {
        if (keyInput) {
          keyInput.value = "";
        }
        setPref(PROVIDER_SCOPE_PREFS[scope].apiKey, "");
        updateEffectiveConfig(win, scope);
      },
    );
  }

  for (const pref of ["targetLang", "sourceLang"] as const) {
    const select = byId<HTMLSelectElement>(win, `${pref}Select`);
    const input = byId<HTMLInputElement>(win, pref);
    select?.addEventListener("change", () => {
      if (select.value === "__custom__") {
        input?.focus();
        return;
      }
      if (input) {
        input.value = select.value;
      }
      setPref(pref, select.value);
    });
    input?.addEventListener("change", () => {
      const value =
        input.value.trim() || (pref === "targetLang" ? "zh-CN" : "auto");
      input.value = value;
      setPref(pref, value);
      syncLanguageControl(win, pref);
    });
  }

  const kindSelect = byId<HTMLSelectElement>(win, "selectionKindMode");
  kindSelect?.addEventListener("change", () => {
    setPref("selectionKindMode", kindSelect.value);
  });

  const languageFilter = byId<HTMLSelectElement>(win, "prefetchLanguageFilter");
  languageFilter?.addEventListener("change", () => {
    setPref(
      "prefetchLanguageFilter",
      normalizePreprocessLanguageFilter(languageFilter.value),
    );
  });

  for (const key of TEXT_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    input?.addEventListener("change", () => {
      setPref(key, input.value.trim());
      updateEffectiveConfig(win, "translation");
      if (!chosenScopeProvider("preprocess")) {
        updateEffectiveConfig(win, "preprocess");
      }
    });
  }

  for (const key of PREFETCH_TEXT_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    input?.addEventListener("change", () => {
      setPref(key, input.value.trim());
      updateEffectiveConfig(win, "preprocess");
    });
  }

  for (const key of NUMBER_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    input?.addEventListener("change", () => {
      const value = normalizeNumberPref(key as NumericPrefKey, input.value);
      input.value = String(value);
      setPrefRaw(key, value);
      updateEffectiveConfig(win, "translation");
      updateEffectiveConfig(win, "preprocess");
    });
  }

  for (const key of BOOL_KEYS) {
    const input = byId<HTMLInputElement>(win, key);
    input?.addEventListener("change", () => {
      if (
        input.checked &&
        (key === "autoTranslate" || key === "prefetchOnOpen") &&
        !win.confirm(
          getString(
            key === "autoTranslate"
              ? "pref-auto-translate-confirm"
              : "pref-prefetch-on-open-confirm",
          ),
        )
      ) {
        input.checked = false;
      }
      setPrefRaw(key, input.checked);
      updateDependentControls(win);
      updateEffectiveConfig(win, "translation");
      updateEffectiveConfig(win, "preprocess");
    });
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

    for (const key of [ids.name, ids.system, ids.user]) {
      const field = byId<HTMLInputElement | HTMLTextAreaElement>(win, key);
      field?.addEventListener("input", () =>
        setPromptStatus(win, getString("pref-prompt-unsaved")),
      );
      field?.addEventListener("change", () => {
        renderPromptEditor(win, kind, commitPromptEditor(win, kind));
      });
    }

    byId<HTMLButtonElement>(win, ids.insert)?.addEventListener("click", () =>
      insertPromptVariable(win, kind),
    );
    byId<HTMLButtonElement>(win, ids.previewButton)?.addEventListener(
      "click",
      () => renderPromptPreview(win, kind),
    );

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
      void startPreprocess(item.id).then(async (result) => {
        showPreprocessResult(win, result);
        await Promise.all([
          refreshCacheStats(win),
          refreshPreprocessTasks(win),
        ]);
      });
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
    if (isJobRunning()) {
      setCacheStatus(win, getString("pref-cache-stop-before-clear"));
      return;
    }
    if (!win.confirm(getString("pref-cache-clear-confirm"))) {
      return;
    }
    void clearCache().then(() =>
      Promise.all([refreshCacheStats(win), refreshPreprocessTasks(win)]),
    );
  });
}

/** Entry point, called from `preferences.xhtml` via `onPrefsEvent("load")`. */
export function registerPrefsScripts(win: Window): void {
  if (!bound.has(win)) {
    organizePanels(win);
  }
  populateStaticSelects(win);
  syncFromPrefs(win);
  seedModelOptions(win, "translation");
  seedModelOptions(win, "preprocess");
  maybeAutoFetchModelOptions(win, "translation");
  maybeAutoFetchModelOptions(win, "preprocess");
  void refreshCacheStats(win);
  void refreshPreprocessTasks(win);
  startTaskRefresh(win);
  if (!bound.has(win)) {
    bound.add(win);
    bindEvents(win);
  }
}

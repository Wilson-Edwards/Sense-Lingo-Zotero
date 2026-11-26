/* Default preferences. The prefix is added by zotero-plugin-scaffold. */

// Provider
pref("provider", "openai");
pref("apiKey", "");
pref("baseURL", "");
pref("model", "");
// Per-provider apiKey/baseURL/model, keyed by provider id (JSON).
pref("providerConfigs", "");

// Preprocessing (whole-book pre-translation) can use its own provider.
// An empty `prefetchProvider` means "follow the translation provider above".
pref("prefetchProvider", "");
pref("prefetchApiKey", "");
pref("prefetchBaseURL", "");
pref("prefetchModel", "");
pref("prefetchProviderConfigs", "");

pref("temperature", "0.3");
pref("maxTokens", 1024);

// Language
pref("targetLang", "zh-CN");
pref("sourceLang", "auto");

// Selection kind
pref("selectionKindMode", "auto");
pref("wordMaxWords", 3);
pref("wordMaxChars", 40);

// Context
pref("useContext", true);
pref("sentenceContextNeighbors", false);
pref("maxSentenceChars", 400);

// Prompts: the library lives in `promptProfiles`; each kind remembers the id
// of the preset it currently uses, so adding presets never changes routing.
pref("promptProfileWord", "word");
pref("promptProfileSentence", "sentence");
pref("promptProfiles", "");

// UI
pref("showInPopup", true);
pref("autoTranslate", false);
pref("shortcutEnabled", true);
pref("popupFontSize", 12);
pref("requestTimeoutMs", 30000);
pref("stream", true);
// Ask the gateway to skip the model's reasoning phase (ClinePass only).
pref("disableThinking", true);
pref("debug", false);

// Translation cache (plugin-private SQLite file)
pref("cacheEnabled", true);
pref("cacheStrictSentence", true);
// Accept the only stored row even when its sentence differs. Off by default:
// a wrong sense costs more than one extra request.
pref("cacheSingleCandidateFallback", false);
// Write every successful click translation back into the cache.
pref("autoCacheOnMiss", true);

// Book preprocessing (manual batch job)
pref("prefetchConcurrency", 2);
pref("prefetchBatchSize", 12);
pref("prefetchMaxSentencesPerWord", 3);
pref("prefetchDelayMs", 200);
// Off by default: opening a book must never spend money silently.
pref("prefetchOnOpen", false);

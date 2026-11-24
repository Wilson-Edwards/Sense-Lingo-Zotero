/* Default preferences. The prefix is added by zotero-plugin-scaffold. */

// Provider
pref("provider", "openai");
pref("apiKey", "");
pref("baseURL", "");
pref("model", "");
// Per-provider apiKey/baseURL/model, keyed by provider id (JSON).
pref("providerConfigs", "");
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

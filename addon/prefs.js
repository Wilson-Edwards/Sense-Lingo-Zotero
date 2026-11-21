/* Default preferences. The prefix is added by zotero-plugin-scaffold. */

// Provider
pref("provider", "openai");
pref("apiKey", "");
pref("baseURL", "");
pref("model", "");
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

// Prompts
pref("promptProfileWord", "word");
pref("promptProfileSentence", "sentence");
pref("promptProfiles", "");

// UI
pref("showInPopup", true);
pref("autoTranslate", false);
pref("shortcutEnabled", true);
pref("requestTimeoutMs", 30000);
pref("debug", false);

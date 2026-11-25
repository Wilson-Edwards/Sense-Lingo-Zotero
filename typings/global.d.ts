/// <reference types="zotero-types" />

declare const __env__: "development" | "production";

/** Passed in by `addon/bootstrap.js` (`ctx = { rootURI }`). */
declare var rootURI: string;

declare const _globalThis: {
  [key: string]: unknown;
  rootURI: string;
  addon: import("../src/addon").default;
};

declare var addon: import("../src/addon").default;

declare namespace _ZoteroTypes {
  interface Prefs {
    PluginPrefsMap: {
      provider: string;
      apiKey: string;
      baseURL: string;
      model: string;
      providerConfigs: string;
      prefetchProvider: string;
      prefetchApiKey: string;
      prefetchBaseURL: string;
      prefetchModel: string;
      prefetchProviderConfigs: string;
      temperature: string;
      maxTokens: number;
      targetLang: string;
      sourceLang: string;
      selectionKindMode: string;
      wordMaxWords: number;
      wordMaxChars: number;
      useContext: boolean;
      sentenceContextNeighbors: boolean;
      maxSentenceChars: number;
      promptProfileWord: string;
      promptProfileSentence: string;
      promptProfiles: string;
      showInPopup: boolean;
      autoTranslate: boolean;
      shortcutEnabled: boolean;
      popupFontSize: number;
      requestTimeoutMs: number;
      stream: boolean;
      disableThinking: boolean;
      debug: boolean;
      cacheEnabled: boolean;
      cacheStrictSentence: boolean;
      cacheSingleCandidateFallback: boolean;
      autoCacheOnMiss: boolean;
      prefetchConcurrency: number;
      prefetchBatchSize: number;
      prefetchMinOccurrences: number;
      prefetchMaxWords: number;
      prefetchMaxSentencesPerWord: number;
      prefetchDelayMs: number;
      prefetchOnOpen: boolean;
    };
  }
}

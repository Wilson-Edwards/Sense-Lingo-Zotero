import { config } from "../package.json";
import { registerSelectionPopup } from "./modules/reader/selectionPopup";
import { attachShortcutToWindow } from "./modules/reader/shortcuts";
import { registerPrefsScripts } from "./modules/ui/preferences";
import { initLocale } from "./utils/locale";
import { error as logError, log, warn } from "./utils/logger";

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  try {
    await Zotero.PreferencePanes.register({
      pluginID: config.addonID,
      src: `${rootURI}content/preferences.xhtml`,
      label: config.addonName,
      image: `${rootURI}content/icons/favicon@0.5x.png`,
      // Loaded into the pane scope before the fragment is inserted; it listens
      // for the `showing` event and forwards it to `onPrefsEvent("load")`.
      scripts: [`${rootURI}content/preferences.js`],
    });
  } catch (e) {
    logError("failed to register preferences pane", e);
  }

  addon.data.disposers.push(registerSelectionPopup());

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;
  log("startup finished");
}

async function onMainWindowLoad(win: Window): Promise<void> {
  attachShortcutToWindow(win);
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  // Reader documents die with their window, nothing to clean up here.
}

async function onShutdown(): Promise<void> {
  for (const dispose of addon.data.disposers) {
    try {
      dispose();
    } catch (e) {
      warn("disposer failed", e);
    }
  }
  addon.data.disposers = [];
  addon.data.alive = false;
  delete (Zotero as unknown as Record<string, unknown>)[config.addonInstance];
}

/** Dispatcher for the preferences pane. */
async function onPrefsEvent(
  type: string,
  data: { [key: string]: any },
): Promise<void> {
  if (type === "load" && data?.window) {
    addon.data.prefsWindow = data.window;
    registerPrefsScripts(data.window);
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};

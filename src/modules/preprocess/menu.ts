/**
 * Entry points for preprocessing: the item context menu and the optional
 * auto-run when an EPUB is opened.
 *
 * `Zotero.MenuManager` exists from Zotero 8 on; the plugin still supports 7, so
 * the menu falls back to inserting a `menuitem` into the library's
 * `zotero-itemmenu` popup. The settings pane buttons work either way.
 */

import { config } from "../../../package.json";
import { getBooleanPref } from "../../utils/prefs";
import { getString } from "../../utils/locale";
import { warn } from "../../utils/logger";
import { cancelActiveJob, isJobRunning, startPreprocess } from "./job";

const MENU_ID = "sense-lingo-prefetch-menu";
const MENUITEM_ID = "sense-lingo-prefetch-menuitem";

export function isEpubAttachment(
  item: Zotero.Item | false | undefined | null,
): boolean {
  try {
    return (
      !!item &&
      item.isAttachment() &&
      item.attachmentContentType === "application/epub+zip"
    );
  } catch {
    return false;
  }
}

function singleEpubItem(items: Zotero.Item[] | undefined): Zotero.Item | null {
  if (!items || items.length !== 1) {
    return null;
  }
  return isEpubAttachment(items[0]) ? items[0] : null;
}

function labelForState(): string {
  return isJobRunning() ? getString("menu-stop") : getString("menu-preprocess");
}

function runMenuCommand(item: Zotero.Item | null): void {
  if (isJobRunning()) {
    cancelActiveJob();
    return;
  }
  if (item) {
    void startPreprocess(item.id);
  }
}

interface SelectionWindow extends Window {
  ZoteroPane?: { getSelectedItems?: () => Zotero.Item[] };
}

/** Selected EPUB attachment of a main window, when exactly one is selected. */
function selectedEpubItem(win: Window): Zotero.Item | null {
  try {
    const pane = (win as SelectionWindow).ZoteroPane;
    return singleEpubItem(pane?.getSelectedItems?.());
  } catch {
    return null;
  }
}

function registerViaMenuManager(): (() => void) | null {
  const manager = (
    Zotero as unknown as { MenuManager?: _ZoteroTypes.MenuManager }
  ).MenuManager;
  if (!manager || typeof manager.registerMenu !== "function") {
    return null;
  }
  try {
    const id = manager.registerMenu({
      menuID: MENU_ID,
      pluginID: config.addonID,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          onShowing: (_event, context) => {
            const item = singleEpubItem(context.items);
            context.setVisible(!!item);
            context.setEnabled(!!item);
            context.menuElem.setAttribute("label", labelForState());
          },
          onCommand: () => {
            const pane = Zotero.getActiveZoteroPane();
            const items = pane?.getSelectedItems?.() ?? [];
            runMenuCommand(singleEpubItem(items));
          },
        },
      ],
    });
    if (!id) {
      return null;
    }
    return () => {
      try {
        manager.unregisterMenu(id);
      } catch (e) {
        warn("failed to unregister preprocessing menu", e);
      }
    };
  } catch (e) {
    warn("MenuManager registration failed, using the XUL fallback", e);
    return null;
  }
}

function attachXulMenu(win: Window): () => void {
  const doc = win.document;
  const popup = doc.getElementById("zotero-itemmenu");
  if (!popup) {
    return () => undefined;
  }
  // `onStartup` and `onMainWindowLoad` can both reach the same window.
  if (doc.getElementById(MENUITEM_ID)) {
    return () => undefined;
  }
  const menuitem = doc.createXULElement("menuitem");
  menuitem.id = MENUITEM_ID;
  menuitem.setAttribute("label", getString("menu-preprocess"));

  const onShowing = (): void => {
    const item = selectedEpubItem(win);
    (menuitem as Element & { hidden: boolean }).hidden = !item;
    menuitem.setAttribute("disabled", item ? "false" : "true");
    menuitem.setAttribute("label", labelForState());
  };
  const onCommand = (): void => {
    runMenuCommand(selectedEpubItem(win));
  };

  popup.addEventListener("popupshowing", onShowing);
  menuitem.addEventListener("command", onCommand);
  popup.appendChild(menuitem);

  return () => {
    try {
      popup.removeEventListener("popupshowing", onShowing);
      menuitem.removeEventListener("command", onCommand);
      menuitem.remove();
    } catch (e) {
      warn("failed to remove preprocessing menu", e);
    }
  };
}

interface ReaderEvent {
  reader?: { itemID?: number };
}

function registerAutoRun(): () => void {
  const reader = Zotero.Reader as typeof Zotero.Reader & {
    registerEventListener?: (
      type: string,
      handler: (event: ReaderEvent) => void,
      pluginID?: string,
    ) => void;
    unregisterEventListener?: (
      type: string,
      handler: (event: ReaderEvent) => void,
    ) => void;
  };
  if (typeof reader?.registerEventListener !== "function") {
    return () => undefined;
  }
  const started = new Set<number>();
  const inFlight = new Set<number>();
  const handler = (event: ReaderEvent): void => {
    if (!getBooleanPref("prefetchOnOpen", false)) {
      return;
    }
    const itemID = event.reader?.itemID;
    if (!itemID || started.has(itemID) || inFlight.has(itemID)) {
      return;
    }
    if (!isEpubAttachment(Zotero.Items.get(itemID))) {
      return;
    }
    // Auto-run skips the confirmation dialog: the user opted in explicitly.
    inFlight.add(itemID);
    void startPreprocess(itemID, { confirm: false }).then(
      (result) => {
        inFlight.delete(itemID);
        if (
          result.status === "done" ||
          result.status === "paused" ||
          result.status === "cancelled"
        ) {
          started.add(itemID);
        }
      },
      () => inFlight.delete(itemID),
    );
  };
  try {
    reader.registerEventListener("renderReader", handler, config.addonID);
  } catch (e) {
    warn("failed to register auto preprocessing", e);
    return () => undefined;
  }
  return () => {
    try {
      reader.unregisterEventListener?.("renderReader", handler);
    } catch (e) {
      warn("failed to unregister auto preprocessing", e);
    }
  };
}

/** True once the Zotero 8 MenuManager took over the menu. */
let usingMenuManager = false;

/**
 * Attach the Zotero 7 fallback menu to one main window.
 * A no-op when MenuManager registered the menu already.
 */
export function attachPreprocessMenuToWindow(win: Window): () => void {
  return usingMenuManager ? () => undefined : attachXulMenu(win);
}

/** Register the menu (and the auto-run listener). Returns a disposer. */
export function registerPreprocessMenu(): () => void {
  const disposers: Array<() => void> = [];
  const viaManager = registerViaMenuManager();
  usingMenuManager = !!viaManager;
  if (viaManager) {
    disposers.push(viaManager);
  } else {
    for (const win of Zotero.getMainWindows()) {
      disposers.push(attachPreprocessMenuToWindow(win));
    }
  }
  disposers.push(registerAutoRun());
  return () => {
    usingMenuManager = false;
    for (const dispose of disposers) {
      dispose();
    }
  };
}

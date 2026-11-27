/**
 * Bootstrap entry of the Sense Lingo plugin.
 *
 * Most of this code is from Zotero team's official Make It Red example[1]
 * or the Zotero 7 documentation[2].
 * [1] https://github.com/zotero/make-it-red
 * [2] https://www.zotero.org/support/dev/zotero_7_for_developers
 */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  /**
   * Global variables for plugin code.
   * `_globalThis` is the global root variable of the plugin sandbox and all
   * child variables assigned to it are globally accessible.
   */
  const ctx = { rootURI };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/__addonRef__.js`,
    ctx,
  );
  await Zotero.__addonInstance__.hooks.onStartup();
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  // `APP_SHUTDOWN` still has to close plugin-owned resources. In particular,
  // Gecko does not manage the external SQLite connection created by the
  // plugin, and leaving it open can keep Zotero waiting during application
  // shutdown. Chrome teardown is unnecessary at that point, but the plugin
  // hook is not.
  await Zotero.__addonInstance__?.hooks.onShutdown();

  if (reason === APP_SHUTDOWN) {
    return;
  }

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall(data, reason) {}

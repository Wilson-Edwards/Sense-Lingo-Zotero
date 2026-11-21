/* global Zotero, window, document */

/**
 * Preferences pane bootstrap.
 *
 * Zotero loads this file *before* inserting the pane fragment (see
 * `PreferencePanes.register({ scripts })`) and only dispatches a `showing`
 * event on the pane's top-level nodes when the pane becomes visible.
 * That event is the reliable "pane is ready" hook — an `onload` attribute on
 * a plugin pane element is never fired by Zotero.
 *
 * The real work stays in TypeScript; this shim only forwards the event.
 */
(function () {
  function init(node) {
    try {
      Zotero.SenseLingo.hooks.onPrefsEvent("load", {
        window: window,
        pane: node,
      });
    } catch (e) {
      Zotero.debug("[sense-lingo] preferences init failed: " + e);
    }
  }

  document.addEventListener(
    "showing",
    function (event) {
      var target = event.target;
      if (!target || typeof target.querySelector !== "function") {
        return;
      }
      // Only react to our own pane, not to Zotero's built-in panes.
      if (!target.querySelector('[id^="sl-"]')) {
        return;
      }
      init(target);
    },
    true,
  );
})();

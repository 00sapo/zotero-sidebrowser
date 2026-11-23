/*
 * Side Browser: a web browser in Zotero's right sidebar.
 *
 * Lifecycle entry point. Zotero loads this file in a sandbox with `Zotero`,
 * `Services`, `ChromeUtils`, and the other privileged globals in scope, then
 * calls the exported functions on lifecycle events.
 *
 * The real code lives in ES modules under `src/`, loaded through the
 * `resource://sidebrowser/` alias that `src/core.mjs` registers. A bare
 * `import()` does not work in the sandbox, so module loading happens through
 * `ChromeUtils.importESModule`.
 */

"use strict";

const PLUGIN_NAME = "Side Browser";

var core = null;
var debug = function (msg) {
  Zotero.debug(`[${PLUGIN_NAME}] ${msg}`);
};

function logError(err) {
  Zotero.logError(err instanceof Error ? err : new Error(String(err)));
}

/**
 * Read the master switch. `Zotero.Prefs` adds the `extensions.zotero.` branch
 * itself, so the key here is relative.
 */
function isEnabled() {
  let value;
  try {
    value = Zotero.Prefs.get("sidebrowser.enabled", true);
  } catch (e) {
    value = undefined;
  }
  return value !== false;
}

async function startup({ id, version, rootURI }, reason) {
  debug(`Starting ${version}`);

  await Zotero.initializationPromise;
  await Zotero.unlockPromise;
  await Zotero.uiReadyPromise;

  try {
    Services.scriptloader.loadSubScript(rootURI + "src/bootstrap-module.mjs", {
      Zotero,
      Services,
      ChromeUtils,
      rootURI,
    });
  } catch (e) {
    logError(e);
    return;
  }

  core = Zotero.SideBrowserCore;
  if (!core) {
    logError("Core module did not load");
    return;
  }

  if (!isEnabled()) {
    debug("Disabled by preference, not creating the sidebar");
    return;
  }

  try {
    await core.start({ rootURI, pluginID: id });
  } catch (e) {
    logError(e);
  }

  // Zotero starts plugins after the first window loaded, so that window never
  // reaches onMainWindowLoad. Walk the open windows instead.
  for (let win of Services.wm.getEnumerator("navigator:browser")) {
    try {
      await core.onMainWindowLoad(win);
    } catch (e) {
      logError(e);
    }
  }

  // Headless check hook. Off by default; the test runner turns it on.
  if (Zotero.Prefs.get("sidebrowser.runSelfTest")) {
    Zotero.Prefs.set("sidebrowser.runSelfTest", false);
    Zotero.debug("[Side Browser] selfTest scheduled");
    // Run detached: awaiting here would block the rest of startup, and the test
    // needs the window and the network to be ready.
    Zotero.Promise.delay(8000)
      .then(() => Zotero.SideBrowser.selfTest())
      .then(
        (results) => Zotero.debug(`[Side Browser] selfTest done: ${results.length} checks`),
        (e) => logError(e),
      );
  }
}

async function onMainWindowLoad({ window }) {
  if (!core) {
    return;
  }
  if (!isEnabled()) {
    return;
  }
  try {
    await core.onMainWindowLoad(window);
  } catch (e) {
    logError(e);
  }
}

async function onMainWindowUnload({ window }) {
  if (!core) {
    return;
  }
  try {
    await core.onMainWindowUnload(window);
  } catch (e) {
    logError(e);
  }
}

async function shutdown({ id, version, rootURI }, reason) {
  debug(`Shutting down (reason ${reason})`);
  try {
    await core?.shutdown();
  } catch (e) {
    logError(e);
  }
  core = null;
}

function install() {}

function uninstall() {}

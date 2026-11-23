/*
 * Core plugin logic.
 *
 * Responsibilities:
 *   - register the `resource://` alias and the window actor once per session
 *   - create one sidebar per main window and remove it on unload
 *   - expose a small console API under `Zotero.SideBrowser`
 *
 * The sidebar itself lives in `sidebar.mjs`; this file only wires it up.
 *
 * Module loading note: the plugin sandbox has no ScriptLoader, so a bare
 * `import()` fails there. `ChromeUtils.importESModule` works, caches per URI,
 * and resolves relative specifiers inside the loaded modules.
 */

/** @type {Map<Window, any>} */
const sidebars = new Map();

let actorRegistered = false;
let pluginRootURI = null;

const MENU_ITEM_ID = "sidebrowser-view-menu-item";

function debug(msg) {
  Zotero.debug(`[Side Browser] ${msg}`);
}

function logError(err) {
  Zotero.logError(err instanceof Error ? err : new Error(String(err)));
}

/**
 * Load one plugin module through its `resource://` alias.
 *
 * The alias must exist first; see `src/resource.mjs`. A module can depend on
 * other modules with normal relative imports.
 *
 * @param {string} path - Path under the plugin root, such as `src/sidebar.mjs`.
 * @returns {object}
 */
export function loadModule(path) {
  return ChromeUtils.importESModule(`resource://sidebrowser-x/${path}`);
}

export function getSidebarByWindow(win) {
  return sidebars.get(win) || null;
}

export function getActiveSidebar() {
  let win = Zotero.getMainWindow();
  return win ? sidebars.get(win) || null : null;
}

/**
 * Register the window actor that drives the AI page.
 *
 * The plugin registers its own actor, so no chrome.manifest is needed. The
 * actor module must be reachable as an ES module, which is why the resource
 * alias is registered first.
 */
function registerActor() {
  if (actorRegistered) {
    return;
  }
  try {
    ChromeUtils.registerWindowActor("SideBrowser", {
      child: {
        esModuleURI: "resource://sidebrowser-x/src/actors/ai-child.mjs",
        events: {
          // A capture listener in the system group sees link clicks before the
          // page can swallow them.
          click: { capture: true, mozSystemGroup: true },
        },
      },
      parent: {
        esModuleURI: "resource://sidebrowser-x/src/actors/ai-parent.mjs",
      },
    });
    actorRegistered = true;
    debug("Window actor registered");
  } catch (e) {
    logError(e);
  }
}

/**
 * Add the View menu entry.
 *
 * `Zotero.MenuManager` only fills a popup that the core code rebuilds on open,
 * and the View menu is not one of those targets in practice, so insert a plain
 * item next to Zotero's own entries. The item is removed again on shutdown.
 */
function registerMenus() {
  for (let win of Services.wm.getEnumerator("navigator:browser")) {
    addViewMenuItem(win);
  }
}

function addViewMenuItem(win) {
  try {
    let doc = win.document;
    if (!doc || doc.getElementById(MENU_ITEM_ID)) {
      return;
    }
    let popup = doc.getElementById("menu_viewPopup");
    if (!popup) {
      return;
    }
    let item = doc.createXULElement("menuitem");
    item.id = MENU_ITEM_ID;
    item.setAttribute("label", "Side Browser");
    item.setAttribute("class", "menuitem-iconic");
    item.style.setProperty(
      "--custom-menu-icon-light",
      `url("${pluginRootURI}content/icons/sidebar.svg")`,
    );
    item.style.setProperty(
      "--custom-menu-icon-dark",
      `url("${pluginRootURI}content/icons/sidebar.svg")`,
    );
    item.addEventListener("command", () => {
      let sidebar = sidebars.get(win);
      sidebar?.toggle();
    });
    // Keep it just above the "Show Tabs Menu" separator Zotero appends.
    popup.appendChild(doc.createXULElement("menuseparator"));
    popup.appendChild(item);
    debug("View menu entry added");
  } catch (e) {
    logError(e);
  }
}

function removeViewMenuItems() {
  for (let win of Services.wm.getEnumerator("navigator:browser")) {
    try {
      win.document.getElementById(MENU_ITEM_ID)?.remove();
    } catch (e) {
      debug(`Could not remove the View menu entry: ${e}`);
    }
  }
}

function unregisterActor() {
  if (!actorRegistered) {
    return;
  }
  try {
    ChromeUtils.unregisterWindowActor("SideBrowser");
  } catch (e) {
    debug(`Could not unregister the actor: ${e}`);
  }
  actorRegistered = false;
}

/**
 * Called once at plugin startup.
 *
 * @param {object} params
 * @param {string} params.rootURI - Plugin root URI, from the bootstrap.
 * @param {string} params.pluginID - Plugin ID.
 */
export async function start({ rootURI, pluginID }) {
  pluginRootURI = rootURI;
  let { registerResourceSubstitution } = loadModule("src/resource.mjs");
  registerResourceSubstitution(rootURI);

  registerActor();
  registerMenus();
  await registerPreferencesPane(pluginID, rootURI);
  debug(`Started (${pluginID})`);
}

/**
 * Create the sidebar in a main window. Safe to call twice for one window.
 *
 * @param {Window} win
 */
export async function onMainWindowLoad(win) {
  if (!win || sidebars.has(win)) {
    return;
  }
  let enabled;
  try {
    enabled = Zotero.Prefs.get("sidebrowser.enabled");
  } catch (e) {
    enabled = undefined;
  }
  if (enabled === false) {
    debug("Sidebar disabled by preference");
    return;
  }
  // The window must be fully loaded before the pane is attached, otherwise
  // #zotero-pane-stack does not exist yet.
  if (win.document.readyState !== "complete") {
    await new Promise((resolve) => win.addEventListener("load", resolve, { once: true }));
  }
  debug("Creating the sidebar");
  try {
    let { Sidebar } = loadModule("src/sidebar.mjs");
    let sidebar = new Sidebar(win);
    await sidebar.init();
    sidebars.set(win, sidebar);
    Zotero.SideBrowser = api;
    debug("Sidebar created");
  } catch (e) {
    logError(e);
  }
}

/**
 * Remove the sidebar from a window before that window goes away.
 *
 * @param {Window} win
 */
export async function onMainWindowUnload(win) {
  let sidebar = sidebars.get(win);
  if (!sidebar) {
    return;
  }
  sidebars.delete(win);
  try {
    await sidebar.destroy();
  } catch (e) {
    logError(e);
  }
}

export async function shutdown() {
  for (let [win, sidebar] of Array.from(sidebars.entries())) {
    sidebars.delete(win);
    try {
      await sidebar.destroy();
    } catch (e) {
      logError(e);
    }
  }
  removeViewMenuItems();
  unregisterActor();
  if (Zotero.SideBrowser === api) {
    delete Zotero.SideBrowser;
  }
  pluginRootURI = null;
}

export function toggleSidebar() {
  let sidebar = getActiveSidebar();
  return sidebar ? sidebar.toggle() : false;
}

export function openSidebar() {
  return getActiveSidebar()?.open() ?? false;
}

export function closeSidebar() {
  return getActiveSidebar()?.close() ?? false;
}

// ---------------------------------------------------------------------------
// Console API
// ---------------------------------------------------------------------------

/**
 * Small API for the error console, for tests, and for other plugins that want
 * to push text into the sidebar. Published as `Zotero.SideBrowser`.
 */
export const api = {
  get sidebars() {
    return sidebars;
  },
  get rootURI() {
    return pluginRootURI;
  },
  loadModule,
  getSidebarByWindow,
  getActiveSidebar,
  toggle: toggleSidebar,
  open: openSidebar,
  close: closeSidebar,

  /**
   * Send text to the active provider and resolve with the actor result.
   *
   * @param {string} text
   * @param {object} [options] - Passed through to `Sidebar#ask`.
   */
  async ask(text, options = {}) {
    let sidebar = getActiveSidebar();
    if (!sidebar) {
      throw new Error("No sidebar is available");
    }
    return sidebar.ask(text, options);
  },

  /** Reload the sidebar browser. */
  reload() {
    return getActiveSidebar()?.reload();
  },

  /** Return the current Zotero context as the sidebar sees it. */
  describeContext() {
    return getActiveSidebar()?.buildScopeSnapshot();
  },

  /** Run the built-in checks and print the results to the error console. */
  async selfTest() {
    let { selfTest } = loadModule("src/selftest.mjs");
    return selfTest();
  },
};

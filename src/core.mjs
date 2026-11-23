/*
 * Core plugin logic.
 *
 * Responsibilities:
 *   - register the `resource://` alias and the window actor once per session
 *   - register the AI item pane section
 *   - refresh the pane when the selected tab or the selected items change
 *   - expose a small console API under `Zotero.SideBrowser`
 *
 * The pane itself lives in `src/section.mjs`; this file only wires it up.
 *
 * Module loading note: the plugin sandbox has no ScriptLoader, so a bare
 * `import()` fails there. `ChromeUtils.importESModule` works, caches per URI,
 * and resolves relative specifiers inside the loaded modules.
 */

const PLUGIN_ID = "sidebrowser@00sapo.dev";
const MENU_ITEM_ID = "sidebrowser-view-menu-item";

let actorRegistered = false;
let pluginRootURI = null;
let notifierID = null;
let prefObserverIDs = [];

function debug(msg) {
  Zotero.debug(`[Side Browser] ${msg}`);
}

function logError(err) {
  Zotero.logError(err instanceof Error ? err : new Error(String(err)));
}

function section() {
  return loadModule("src/section.mjs");
}

/**
 * Load one plugin module through its `resource://` alias.
 *
 * @param {string} path - Path under the plugin root, such as `src/section.mjs`.
 * @returns {object}
 */
export function loadModule(path) {
  return ChromeUtils.importESModule(`resource://sidebrowser-x/${path}`);
}

// ---------------------------------------------------------------------------
// Window actor
// ---------------------------------------------------------------------------

/**
 * Register the window actor that drives the AI page.
 *
 * The capture listeners see clicks and Enter before the site's own handlers,
 * which is what makes the send intercept possible.
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
          // Plain capture listeners run before the page's own handlers. A
          // system-group listener runs after them, which is too late: the site
          // would already have read and cleared the message box.
          click: { capture: true },
          keydown: { capture: true },
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

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

/**
 * Add the View menu entry in every window.
 *
 * `Zotero.MenuManager` only fills a popup that Zotero rebuilds when it opens,
 * and the View menu is not one of those targets, so a plain item is inserted.
 */
function addViewMenuItems() {
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
    item.dataset.l10nId = "sidebrowser-view-menu-item";
    item.setAttribute("class", "menuitem-iconic");
    let icon = `url("${pluginRootURI}content/icons/sidebar.svg")`;
    item.style.setProperty("--custom-menu-icon-light", icon);
    item.style.setProperty("--custom-menu-icon-dark", icon);
    item.addEventListener("command", () => openSidebar(win));
    popup.appendChild(doc.createXULElement("menuseparator"));
    popup.appendChild(item);
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

// ---------------------------------------------------------------------------
// Zotero events
// ---------------------------------------------------------------------------

/**
 * Keep the pane in step with the tab and the selection.
 *
 * The pane shows the context for the tab it belongs to, so a tab or selection
 * change means a new context block for the page.
 */
function registerNotifier() {
  notifierID = Zotero.Notifier.registerObserver({
    notify: async (action, type) => {
      if (type === "tab" && ["select", "close", "add"].includes(action)) {
        await refresh();
      }
      if (type === "item" && action === "modify") {
        await refresh();
      }
    },
  }, ["tab", "item"], "sidebrowser");

  // The item tree reports selection changes through a listener binding, not
  // through the notifier.
  for (let win of Services.wm.getEnumerator("navigator:browser")) {
    watchItemsView(win);
  }
}

const watchedViews = new WeakSet();

function watchItemsView(win) {
  let itemsView = win?.ZoteroPane?.itemsView;
  if (!itemsView?.onSelect || watchedViews.has(itemsView)) {
    return;
  }
  watchedViews.add(itemsView);
  let handler = () => {
    refresh();
  };
  itemsView.onSelect.addListener(handler);
  itemsView.onRefresh?.addListener(handler);
}

async function refresh() {
  try {
    await section().refreshAll();
  } catch (e) {
    debug(`Could not refresh the panes: ${e}`);
  }
}

function registerPrefObservers() {
  for (let key of ["provider", "autoContext", "maxItems", "customURL", "customProviders", "showComposer"]) {
    let id = Zotero.Prefs.registerObserver(`sidebrowser.${key}`, () => {
      try {
        section().applySettings();
      } catch (e) {
        debug(`Could not apply the settings: ${e}`);
      }
    });
    prefObserverIDs.push(id);
  }
}

/**
 * The reader offers a text-selection popup. A button there puts the selection in
 * the pane, which is faster than copying and pasting.
 *
 * @param {string} pluginID
 */
function registerReaderEvents(pluginID) {
  if (!Zotero.Reader?.registerEventListener) {
    return;
  }
  try {
    Zotero.Reader.registerEventListener(
      "renderTextSelectionPopup",
      (event) => {
        let { doc, params, append } = event;
        let button = doc.createElement("button");
        button.className = "toolbar-button wide-button";
        button.textContent = "Ask about this";
        button.addEventListener("click", () => {
          let win = Zotero.getMainWindow();
          let ok = section().useSelection(params.annotation, params.reader || event.reader, win);
          if (!ok) {
            debug("No pane is open, so the selection was dropped");
          }
        });
        append(button);
      },
      pluginID,
    );
  } catch (e) {
    logError(e);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Called once at plugin startup.
 *
 * @param {object} params
 * @param {string} params.rootURI
 * @param {string} params.pluginID
 */
export async function start({ rootURI, pluginID }) {
  pluginRootURI = rootURI;
  let { registerResourceSubstitution } = loadModule("src/resource.mjs");
  registerResourceSubstitution(rootURI);

  registerActor();
  addViewMenuItems();
  await registerPreferencesPane(pluginID, rootURI);
  registerReaderEvents(pluginID);

  section().registerSection(rootURI);

  registerNotifier();
  registerPrefObservers();

  // Publish the console API. Other plugins and the self test reach the pane
  // through it, so it must exist before any window is touched.
  Zotero.SideBrowser = api;
  debug(`Started (${pluginID})`);
}

async function registerPreferencesPane(pluginID, rootURI) {
  if (!Zotero.PreferencePanes?.register) {
    return;
  }
  try {
    await Zotero.PreferencePanes.register({
      pluginID,
      id: "sidebrowser-prefs",
      src: `${rootURI}content/preferences.xhtml`,
      label: "AI Sidebar",
      image: `${rootURI}content/icons/sidebar.svg`,
    });
  } catch (e) {
    logError(e);
  }
}

/**
 * Called for each main window. The section is registered once, so this only
 * adds the menu item and the item-tree listener for that window.
 *
 * @param {Window} win
 */
export async function onMainWindowLoad(win) {
  if (!win?.document) {
    return;
  }
  if (win.document.readyState !== "complete") {
    await new Promise((resolve) => win.addEventListener("load", resolve, { once: true }));
  }
  addViewMenuItem(win);
  watchItemsView(win);
  try {
    loadModule("src/multi.mjs").install(win, pluginRootURI);
  } catch (e) {
    logError(e);
  }
  await refresh();
}

export async function onMainWindowUnload(win) {
  try {
    loadModule("src/multi.mjs").remove(win);
  } catch (e) {
    debug(`${e}`);
  }
  try {
    win?.document.getElementById(MENU_ITEM_ID)?.remove();
  } catch (e) {
    debug(`${e}`);
  }
}

export async function shutdown() {
  removeViewMenuItems();
  try {
    loadModule("src/multi.mjs").removeAll();
  } catch (e) {
    debug(`${e}`);
  }
  if (notifierID !== null) {
    try {
      Zotero.Notifier.unregisterObserver(notifierID);
    } catch (e) {
      debug(`${e}`);
    }
    notifierID = null;
  }
  for (let id of prefObserverIDs) {
    try {
      Zotero.Prefs.unregisterObserver(id);
    } catch (e) {
      debug(`${e}`);
    }
  }
  prefObserverIDs = [];
  try {
    section().unregisterSection();
  } catch (e) {
    debug(`${e}`);
  }
  unregisterActor();
  if (Zotero.SideBrowser === api) {
    delete Zotero.SideBrowser;
  }
  pluginRootURI = null;
}

/**
 * Show the AI pane in a window.
 *
 * @param {Window} [win] - Defaults to the active window.
 */
export function openSidebar(win) {
  let target = win || Zotero.getMainWindow();
  if (!target) {
    return false;
  }
  section().loadProviders();
  return section().showInWindow(target);
}

export function reloadAll() {
  section().reloadAll();
}

// ---------------------------------------------------------------------------
// Console API
// ---------------------------------------------------------------------------

/**
 * Small API for the error console, for tests, and for other plugins that want
 * to use the pane. Published as `Zotero.SideBrowser`.
 */
export const api = {
  get rootURI() {
    return pluginRootURI;
  },
  loadModule,
  open: openSidebar,
  reload: reloadAll,
  panes: () => section().describePanes(),
  context: () => loadModule("src/context.mjs"),

  /**
   * Send text to the active pane's provider and resolve with the actor result.
   *
   * @param {string} text
   * @param {object} [options]
   */
  async ask(text, options = {}) {
    let pane = section().activePane();
    if (!pane) {
      throw new Error("No AI pane is open. Use View, then AI sidebar.");
    }
    return pane.ask(text, options);
  },

  /** Run the built-in checks and print the results to the error console. */
  async selfTest() {
    let { selfTest } = loadModule("src/selftest.mjs");
    return selfTest();
  },
};

/*
 * The AI pane, registered as an item pane section.
 *
 * Zotero Skimming and other plugins put their panel in the right-hand column by
 * calling `Zotero.ItemPaneManager.registerSection`. The section gets a body in
 * the item pane and an icon in the sidenav, which is the vertical strip of icons
 * at the right edge, so the browser sits where every other Zotero pane sits.
 *
 * One section is registered per session, not per window. Zotero builds one body
 * per window and tab and calls the hooks below with the body to fill.
 *
 * Each body owns one `<browser>`. A browser element cannot be moved to another
 * parent without losing its page, because the move creates a new browsing
 * context, so a body that Zotero re-creates starts a fresh browser. It reopens
 * the last address it visited, which for a chat service is usually the
 * conversation the user was reading.
 */

import { PaneCSS, paneMarkup } from "./ui/styles.mjs";
import { buildScope, compose, defaultOptions } from "./scope.mjs";
import { DEFAULT_PROVIDERS, findProvider, loadCustomProviders } from "./providers/registry.mjs";
import { getPref, setPref } from "./prefs.mjs";
import * as multi from "./multi.mjs";

const PLUGIN_ID = "sidebrowser@00sapo.dev";
const PANE_ID = "sidebrowser-pane";
const ACTOR_TIMEOUT_MS = 20000;

/** Every live pane, keyed by the body element Zotero handed over. */
const panes = new Map();

let sectionKey = null;
let providers = [];

/**
 * @typedef {object} Pane
 * @property {Document} doc
 * @property {HTMLElement} root
 * @property {object} ui
 * @property {XULBrowserElement} browser
 * @property {object} provider
 * @property {string} providerID
 * @property {object} scope
 * @property {object|null} selection
 * @property {object} options
 * @property {object|null} pageInfo
 * @property {object} api
 */

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the section. Called once at startup, after the resource alias
 * exists, because the icons are loaded through it.
 *
 * @param {string} rootURI
 * @returns {string|false}
 */
export function registerSection(rootURI) {
  if (sectionKey) {
    return sectionKey;
  }
  if (!Zotero.ItemPaneManager?.registerSection) {
    Zotero.debug("[Side Browser] ItemPaneManager is not available in this Zotero version");
    return false;
  }
  loadProviders();

  let icon = `${rootURI}content/icons/sidebar.svg`;
  try {
    sectionKey = Zotero.ItemPaneManager.registerSection({
      paneID: PANE_ID,
      pluginID: PLUGIN_ID,
      header: {
        l10nID: "sidebrowser-section-header",
        icon,
      },
      sidenav: {
        l10nID: "sidebrowser-section-sidenav",
        icon,
      },
      // On in every tab: the browser is useful beside the item list too.
      onItemChange: ({ setEnabled }) => {
        let open = !!getPref("open");
        setEnabled(open);
        return true;
      },
      onRender: ({ doc, body }) => {
        renderPane(doc, body);
      },
      onDestroy: ({ body }) => {
        destroyPane(body);
      },
    });
  } catch (e) {
    Zotero.debug(`[Side Browser] Could not register the section: ${e}`);
    sectionKey = null;
    return false;
  }

  if (sectionKey) {
    Zotero.debug(`[Side Browser] Section registered as ${sectionKey}`);
  }
  return sectionKey;
}

/** Remove the section and stop every pane. Called on plugin shutdown. */
export function unregisterSection() {
  for (let body of Array.from(panes.keys())) {
    destroyPane(body);
  }
  if (sectionKey && Zotero.ItemPaneManager?.unregisterSection) {
    try {
      Zotero.ItemPaneManager.unregisterSection(sectionKey);
    } catch (e) {
      Zotero.debug(`[Side Browser] Could not unregister the section: ${e}`);
    }
  }
  sectionKey = null;
}

export function getSectionKey() {
  return sectionKey;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export function loadProviders() {
  let custom = loadCustomProviders(getPref("customProviders"));
  providers = [...DEFAULT_PROVIDERS, ...custom];
  let customURL = getPref("customURL");
  if (getPref("provider") === "custom" && customURL) {
    providers.push({
      id: "custom",
      label: "Custom",
      url: customURL,
      custom: true,
      composerSelectors: ["div[contenteditable='true']", "textarea", "[role='textbox']"],
      sendSelectors: [],
      sendMode: "button-then-enter",
      fileSelectors: ["input[type='file'][accept*='pdf']", "input[type='file']"],
      acceptsDocuments: true,
    });
  }
  return providers;
}

export function getProviders() {
  return providers;
}

function providerFor(id) {
  return findProvider(providers, id || getPref("provider"));
}

// ---------------------------------------------------------------------------
// Pane bodies
// ---------------------------------------------------------------------------

/**
 * Fill one body with the browser and the context controls.
 *
 * `onRender` can run more than once for the same body, so a second call reuses
 * the existing pane instead of building a second browser.
 *
 * @param {Document} doc
 * @param {HTMLElement} body
 */
export function mountPane(doc, body) {
  return renderPane(doc, body);
}

/** Stop and forget a pane that this plugin mounted by hand. */
export function unmountPane(body) {
  destroyPane(body);
}

function renderPane(doc, body) {
  let existing = panes.get(body);
  if (existing) {
    return existing.api;
  }

  injectPaneStyles(doc);
  applyLabelFallback(doc, body);
  let root = parseMarkup(doc, paneMarkup());
  body.replaceChildren(root);

  let browser = root.querySelector("browser.sb-browser");
  let pane = /** @type {Pane} */ ({
    doc,
    root,
    body,
    browser,
    ui: {},
    provider: null,
    providerID: getPref("provider"),
    scope: { mode: "none", items: [], listedCount: 0, selectedCount: 0 },
    selection: null,
    options: defaultOptions(),
    pageInfo: null,
    pageLoaded: false,
  });

  for (let role of [
    "provider",
    "input",
    "status",
    "scope",
    "selection",
    "overlay",
    "composer",
    "includeItem",
    "includeList",
    "includeSelected",
    "includePDFText",
  ]) {
    pane.ui[role] = root.querySelector(`[data-role="${role}"]`);
  }

  pane.provider = providerFor(pane.providerID);
  panes.set(body, pane);
  pane.api = createPaneApi(pane);
  pane.api.start();
  return pane.api;
}

/**
 * Zotero fills the section header and the sidenav tooltip from the locale file.
 * If the locale did not load, the header stays empty, so write the text by hand
 * after the localization had its chance.
 *
 * @param {Document} doc
 * @param {HTMLElement} body
 */
function applyLabelFallback(doc, body) {
  const label = "AI sidebar";
  doc.defaultView.setTimeout(() => {
    try {
      let head = body.closest("collapsible-section");
      if (head && !head.label) {
        head.removeAttribute("data-l10n-id");
        head.label = label;
      }
      for (let button of doc.querySelectorAll(".btn[custom][data-l10n-id='sidebrowser-section-sidenav']")) {
        if (!button.getAttribute("title") && !button.getAttribute("tooltiptext")) {
          button.setAttribute("title", label);
        }
      }
    } catch (e) {
      Zotero.debug(`[Side Browser] Could not set the labels: ${e}`);
    }
  }, 600);
}

function destroyPane(body) {
  let pane = panes.get(body);
  if (!pane) {
    return;
  }
  panes.delete(body);
  try {
    pane.api.stop();
  } catch (e) {
    Zotero.debug(`[Side Browser] Could not stop a pane: ${e}`);
  }
}

/**
 * Parse the pane markup. The wrapper declares the XHTML namespace, so plain
 * HTML tags need no prefix, while `<browser>` stays a XUL element.
 *
 * @param {Document} doc
 * @param {string} markup
 * @returns {HTMLElement}
 */
function parseMarkup(doc, markup) {
  let wrapped = `<html:div xmlns:html="http://www.w3.org/1999/xhtml" class="sb-root">${markup}</html:div>`;
  let fragment = doc.defaultView.MozXULElement.parseXULToFragment(wrapped);
  return fragment.firstElementChild;
}

function injectPaneStyles(doc) {
  const id = "sidebrowser-pane-styles";
  if (doc.getElementById(id)) {
    return;
  }
  let style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.id = id;
  style.textContent = PaneCSS;
  doc.documentElement.appendChild(style);
}

// ---------------------------------------------------------------------------
// One pane, one browser
// ---------------------------------------------------------------------------

/**
 * Build the object the rest of the plugin talks to. Every method is per pane,
 * because every pane owns its own browser.
 *
 * @param {Pane} pane
 * @returns {object}
 */
function createPaneApi(pane) {
  let { doc, browser, ui, root } = pane;
  let win = doc.defaultView;
  let listeners = [];
  let progressTarget = null;
  let progressListener = null;
  let attachTimer = null;
  let actorWatch = null;

  let api = {
    get pane() {
      return pane;
    },

    /** Called once for a fresh pane. */
    start() {
      bindToolbar();
      bindComposer();
      bindBrowser();
      fillProviders();
      render();
      let saved = getPref("lastURL");
      let startURL = saved || pane.provider.url;
      navigate(startURL);
      refreshScope();
      startActorWatch();
    },

    /** Release every listener and the browser. */
    stop() {
      for (let { target, type, handler, capture } of listeners) {
        try {
          target.removeEventListener(type, handler, capture);
        } catch (e) {
          Zotero.debug(`[Side Browser] ${e}`);
        }
      }
      listeners.length = 0;
      if (progressTarget && progressListener) {
        try {
          progressTarget.removeProgressListener(progressListener);
        } catch (e) {
          Zotero.debug(`[Side Browser] ${e}`);
        }
      }
      progressTarget = null;
      progressListener = null;
      if (attachTimer) {
        win.clearInterval(attachTimer);
        attachTimer = null;
      }
      if (actorWatch) {
        win.clearInterval(actorWatch);
        actorWatch = null;
      }
      try {
        browser.remove();
      } catch (e) {
        Zotero.debug(`[Side Browser] ${e}`);
      }
    },

    reload() {
      navigate(currentURL() || pane.provider.url);
    },

    navigate,

    async refreshScope() {
      return refreshScope();
    },

    render,

    async showContext() {
      return pushContextToPage();
    },

    selectProvider(id) {
      setPref("provider", id);
      pane.providerID = id;
      pane.provider = providerFor(id);
      ui.provider.value = pane.provider.id;
      navigate(pane.provider.url);
      applyAdapter();
      render();
    },

    setProvider(provider) {
      pane.provider = provider;
      pane.providerID = provider.id;
      fillProviders();
    },

    compose() {
      return composed();
    },

    async ask(text, options = {}) {
      return ask(text, options);
    },

    focus() {
      pane.options.composer = true;
      ui.composer.hidden = false;
      ui.input.focus();
    },

    /** Show the pane and put the browser in front of the user. */
    reveal() {
      reveal(pane);
    },
  };

  // ---------------------------------------------------------------- toolbar

  function bindToolbar() {
    on(root.querySelector(".sb-toolbar"), "click", (event) => {
      let button = event.target.closest("button[data-action]");
      if (button) {
        onToolbar(button.dataset.action);
      }
    });
    on(ui.provider, "change", () => api.selectProvider(ui.provider.value));
  }

  function onToolbar(action) {
    switch (action) {
      case "back":
        command("cmd_goBack");
        break;
      case "forward":
        command("cmd_goForward");
        break;
      case "reload":
        api.reload();
        break;
      case "external":
        if (currentURL()) {
          Zotero.launchURL(currentURL());
        }
        break;
      case "composer": {
        let hidden = !ui.composer.hidden;
        ui.composer.hidden = hidden;
        pane.options.composer = !hidden;
        setPref("showComposer", !hidden);
        if (!hidden) {
          ui.input.focus();
        }
        break;
      }
      default:
        break;
    }
  }

  function command(cmd) {
    try {
      let element = doc.getElementById(cmd);
      if (element?.doCommand) {
        element.doCommand();
        return;
      }
    } catch (e) {
      Zotero.debug(`[Side Browser] ${cmd} failed: ${e}`);
    }
    try {
      if (cmd === "cmd_goBack") {
        browser.goBack();
      } else if (cmd === "cmd_goForward") {
        browser.goForward();
      }
    } catch (e) {
      Zotero.debug(`[Side Browser] ${cmd} failed: ${e}`);
    }
  }

  // --------------------------------------------------------------- composer

  function bindComposer() {
    on(root.querySelector(".sb-actions"), "click", (event) => {
      let button = event.target.closest("button[data-action]");
      if (!button || button.disabled) {
        return;
      }
      let action = button.dataset.action;
      if (action === "insert") {
        onInsert();
      } else if (action === "copy") {
        onCopy();
      } else if (action === "attach") {
        onAttach();
      }
    });

    on(ui.input, "keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        onInsert();
      }
    });

    for (let role of ["includeItem", "includeList", "includeSelected", "includePDFText"]) {
      on(ui[role], "change", () => {
        pane.options[role] = ui[role].checked;
        pane.options.touched[role] = true;
        syncContext();
        render();
      });
    }

    if (getPref("showComposer")) {
      ui.composer.hidden = false;
      pane.options.composer = true;
    }
  }

  // ---------------------------------------------------------------- browser

  function bindBrowser() {
    let updateNav = () => {
      let canBack = false;
      let canForward = false;
      try {
        canBack = !!browser.canGoBack;
        canForward = !!browser.canGoForward;
      } catch (e) {
        // The browser element is not ready yet.
      }
      let back = root.querySelector('button[data-action="back"]');
      let forward = root.querySelector('button[data-action="forward"]');
      if (back) {
        back.disabled = !canBack;
      }
      if (forward) {
        forward.disabled = !canForward;
      }
    };

    // A XUL browser in a chrome window does not fire DOM `load` for remote
    // content reliably, so follow the browsing context progress instead.
    let attachProgress = () => {
      let target = null;
      try {
        target = browser.browsingContext?.webProgress;
      } catch (e) {
        target = null;
      }
      if (!target) {
        return false;
      }
      progressListener = {
        onStateChange: (_progress, _request, stateFlags) => {
          let stop = stateFlags & Ci.nsIWebProgressListener.STATE_STOP;
          let isDocument = stateFlags & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT;
          let isNetwork = stateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK;
          if (stop && (isDocument || isNetwork)) {
            onPageLoad();
          }
        },
        onLocationChange: () => updateNav(),
        onProgressChange: () => {},
        onSecurityChange: () => {},
        onStatusChange: () => {},
        onContentBlockingEvent: () => {},
        QueryInterface: ChromeUtils.generateQI([
          "nsIWebProgressListener",
          "nsISupportsWeakReference",
        ]),
      };
      try {
        target.addProgressListener(
          progressListener,
          Ci.nsIWebProgress.NOTIFY_STATE_ALL | Ci.nsIWebProgress.NOTIFY_LOCATION,
        );
        progressTarget = target;
        return true;
      } catch (e) {
        Zotero.debug(`[Side Browser] Could not add a progress listener: ${e}`);
        progressListener = null;
        return false;
      }
    };

    if (!attachProgress()) {
      let tries = 0;
      attachTimer = win.setInterval(() => {
        tries += 1;
        if (attachProgress() || tries > 40) {
          win.clearInterval(attachTimer);
          attachTimer = null;
          updateNav();
        }
      }, 100);
    }
  }

  function onPageLoad() {
    pane.pageLoaded = true;
    if (ui.overlay) {
      ui.overlay.hidden = true;
    }
    let url = currentURL();
    if (url) {
      setPref("lastURL", url);
    }
    applyAdapter().then(() => {
      syncContext();
      refreshScope();
    });
  }

  function navigate(url) {
    if (!url) {
      return;
    }
    pane.pageLoaded = false;
    showOverlay("Loading the AI page...");
    try {
      browser.loadURI(Services.io.newURI(url), {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
    } catch (e) {
      Zotero.logError(e);
      showOverlay(`Could not open ${url}`);
    }
  }

  function currentURL() {
    try {
      let spec = browser.currentURI?.spec || "";
      return spec === "about:blank" ? "" : spec;
    } catch (e) {
      return "";
    }
  }

  function showOverlay(text) {
    if (!ui.overlay) {
      return;
    }
    ui.overlay.textContent = text;
    ui.overlay.hidden = false;
  }

  // ---------------------------------------------------------------- adapter

  async function applyAdapter() {
    let actor = getActor();
    if (!actor) {
      actor = await waitForActor();
      if (!actor) {
        return;
      }
    }
    let adapter = {
      composerSelectors: pane.provider.composerSelectors,
      sendSelectors: pane.provider.sendSelectors,
      sendMode: pane.provider.sendMode,
      fileSelectors: pane.provider.fileSelectors,
      url: currentURL(),
    };
    try {
      await actor.sendQuery("set-adapter", { adapter });
      pane.pageInfo = await actor.sendQuery("prepare", {});
    } catch (e) {
      pane.pageInfo = null;
      Zotero.debug(`[Side Browser] Could not reach the page: ${e}`);
    }
  }

  function getActor() {
    try {
      let windowGlobal = browser?.browsingContext?.currentWindowGlobal;
      return windowGlobal?.getActor("SideBrowser") || null;
    } catch (e) {
      return null;
    }
  }

  async function waitForActor() {
    let start = Date.now();
    while (Date.now() - start < ACTOR_TIMEOUT_MS) {
      let actor = getActor();
      if (actor) {
        return actor;
      }
      await Zotero.Promise.delay(250);
    }
    return null;
  }

  /**
   * Keep the page supplied with the current context block.
   *
   * The actor holds the block and prefixes it to the next message the user
   * sends from the page, so no prompt box is needed anywhere.
   */
  async function pushContextToPage() {
    let actor = getActor();
    if (!actor) {
      return false;
    }
    if (!getPref("autoContext")) {
      await actor.sendQuery("set-context", { context: "" });
      return false;
    }
    let text = composed().text;
    try {
      await actor.sendQuery("set-context", { context: text });
      return true;
    } catch (e) {
      Zotero.debug(`[Side Browser] Could not push the context: ${e}`);
      return false;
    }
  }

  function syncContext() {
    if (!pane.pageInfo) {
      return;
    }
    pushContextToPage();
  }

  /**
   * The actor only exists once the page has a window global. Poll until one
   * appears, then push the context. This covers a navigation as well.
   */
  function startActorWatch() {
    if (actorWatch) {
      win.clearInterval(actorWatch);
    }
    let pushed = false;
    actorWatch = win.setInterval(() => {
      let actor = getActor();
      if (!actor) {
        pushed = false;
        return;
      }
      if (pushed) {
        return;
      }
      pushed = true;
      win.clearInterval(actorWatch);
      actorWatch = null;
      pushContextToPage();
    }, 500);
  }

  // -------------------------------------------------------------- Zotero side

  function fillProviders() {
    let select = ui.provider;
    if (!select) {
      return;
    }
    select.replaceChildren();
    for (let provider of providers) {
      let option = doc.createElementNS("http://www.w3.org/1999/xhtml", "option");
      option.value = provider.id;
      option.textContent = provider.label;
      select.appendChild(option);
    }
    select.value = pane.provider.id;
  }

  async function refreshScope() {
    pane.scope = await buildScope({ doc });
    render();
    return pane.scope;
  }

  // ---------------------------------------------------------------- drawing

  function render() {
    if (!root.isConnected) {
      return;
    }
    let { mode, items, listedCount } = pane.scope;
    let count = items.length;

    ui.scope.textContent = {
      reader: "Context: the paper in the reader",
      selection: `Context: ${count} selected paper${count === 1 ? "" : "s"}`,
      list: `Context: ${count} paper${count === 1 ? "" : "s"} in this list`,
      none: "No paper context in this tab",
    }[mode];

    let showItem = mode === "reader";
    let showList = mode === "list" || (mode === "selection" && listedCount > count);
    let showSelected = mode === "selection";
    let hasSelection = !!pane.selection?.text;

    setHidden("itemContext", !showItem);
    setHidden("listContext", !showList);
    setHidden("selectionContext", !showSelected);
    setHidden("pdfText", !hasSelection);

    if (showItem) {
      let label = root.querySelector('[data-role="includeItemLabel"]');
      if (label) {
        label.textContent = `Include this paper: ${truncate(items[0]?.getField("title") || "", 46)}`;
      }
      if (!pane.options.touched.includeItem) {
        pane.options.includeItem = true;
      }
    }
    if (showList) {
      let label = root.querySelector('[data-role="includeListLabel"]');
      if (label) {
        let n = listedCount || count;
        label.textContent = `Include all ${n} paper${n === 1 ? "" : "s"} in this list`;
      }
      if (!pane.options.touched.includeList) {
        pane.options.includeList = true;
      }
    }
    if (showSelected) {
      let label = root.querySelector('[data-role="includeSelectedLabel"]');
      if (label) {
        label.textContent = `Include the ${count} selected paper${count === 1 ? "" : "s"}`;
      }
      if (!pane.options.touched.includeSelected) {
        pane.options.includeSelected = true;
      }
    }

    ui.includeItem.checked = !!pane.options.includeItem;
    ui.includeList.checked = !!pane.options.includeList;
    ui.includeSelected.checked = !!pane.options.includeSelected;

    if (hasSelection) {
      ui.selection.hidden = false;
      ui.selection.textContent = truncate(pane.selection.text, 320);
    } else {
      ui.selection.hidden = true;
      ui.selection.textContent = "";
    }
    ui.includePDFText.checked = hasSelection && pane.options.includePDFText !== false;

    updateAttachmentAvailability();
    updateInsertState();
  }

  function setHidden(option, hidden) {
    let element = root.querySelector(`[data-option="${option}"]`);
    if (element) {
      element.hidden = hidden;
    }
  }

  /**
   * PDF attach uses the site's own file input and takes a moment, so it is a
   * deliberate action instead of a box that fires during a send.
   */
  function updateAttachmentAvailability() {
    let button = root.querySelector('button[data-action="attach"]');
    if (!button) {
      return;
    }
    let items = scopeItems();
    let pageAccepts = !pane.pageInfo || (pane.pageInfo.fileInputs || []).length > 0;
    button.disabled = !items.length || !pageAccepts;
    button.title = !items.length
      ? "Include a paper first"
      : !pageAccepts
        ? "This page takes no PDF here"
        : "Attach the PDF of the included papers";
  }

  function updateInsertState() {
    let button = root.querySelector('button[data-action="insert"]');
    if (button) {
      button.disabled = !composed().text.trim();
    }
  }

  /**
   * The items the current options select. The three scope options are mutually
   * exclusive because they describe the same tab in three ways.
   *
   * @returns {Zotero.Item[]}
   */
  function scopeItems() {
    let { mode, items } = pane.scope;
    if (mode === "reader" && pane.options.includeItem) {
      return items;
    }
    if (mode === "selection" && pane.options.includeSelected) {
      return items;
    }
    if (mode === "list" && pane.options.includeList) {
      return items;
    }
    return [];
  }

  function composed() {
    let attachment = pane.selection?.readerItemID
      ? Zotero.Items.get(pane.selection.readerItemID)
      : null;
    let includeSelection = !!pane.options.includePDFText && !!pane.selection?.text;
    return {
      text: compose({
        items: scopeItems(),
        selection: pane.selection
          ? {
            text: pane.selection.text,
            pageLabel: pane.selection.pageLabel,
            pageIndex: pane.selection.pageIndex,
          }
          : null,
        includeSelection,
        attachmentItem: attachment,
        userText: ui.input.value.trim(),
      }),
      items: scopeItems(),
      selection: includeSelection ? pane.selection : null,
    };
  }

  function setStatus(text, isError = false) {
    if (!ui.status) {
      return;
    }
    ui.status.textContent = text || "";
    ui.status.classList.toggle("sb-error", !!isError);
  }

  // ---------------------------------------------------------------- actions

  /**
   * Put the context block in the page message box. The user then sends from the
   * page, so their own words and the site's own controls still apply.
   */
  async function onInsert() {
    let text = composed().text;
    if (!text) {
      setStatus("Turn on a context option, or open a paper", true);
      return;
    }
    try {
      let actor = await waitForActor();
      if (!actor) {
        await copy(text);
        setStatus("The page is not ready. The text is on the clipboard.", true);
        return;
      }
      let result = await actor.sendQuery("insert", { text });
      if (result?.ok) {
        setStatus("Context placed in the page. Send from the page when ready.");
        actor.sendQuery("set-context", { context: "" }).catch(() => {});
      } else {
        await copy(text);
        setStatus("Could not find the message box on the page. The text is on the clipboard.", true);
      }
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  }

  async function onCopy() {
    let text = composed().text;
    if (!text) {
      setStatus("There is nothing to copy yet", true);
      return;
    }
    await copy(text);
    setStatus("Prompt copied to the clipboard");
  }

  async function onAttach() {
    let items = scopeItems();
    if (!items.length) {
      setStatus("Include a paper first", true);
      return;
    }
    let button = root.querySelector('button[data-action="attach"]');
    button.disabled = true;
    setStatus("Attaching the PDF...");
    try {
      let { collectPDFs, readFiles } = Zotero.SideBrowser.loadModule("src/context.mjs");
      let collected = await collectPDFs(items);
      if (!collected.files.length) {
        let first = collected.skipped[0];
        let reason = first?.reason === "no-local-file" ? "no file on disk" : "no PDF attachment";
        setStatus(`No PDF to attach: ${truncate(first?.title || "the paper", 40)} (${reason})`, true);
        return;
      }
      let files = await readFiles(collected.files);
      let actor = await waitForActor();
      if (!actor) {
        setStatus("The page is not ready yet", true);
        return;
      }
      let result = await actor.sendQuery("attach", { files });
      if (result?.attached?.length) {
        setStatus(`Attached: ${result.attached.join(", ")}`);
      } else {
        setStatus("Could not attach the file to this page", true);
      }
    } catch (e) {
      setStatus(String(e.message || e), true);
    } finally {
      updateAttachmentAvailability();
    }
  }

  async function copy(text) {
    try {
      let helper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
      helper.copyString(text);
    } catch (e) {
      Zotero.debug(`[Side Browser] Clipboard failed: ${e}`);
    }
  }

  /**
   * Send text and optional files directly. The console API and the self test
   * use this. The normal path is a send from the page, which the actor catches.
   */
  async function ask(text, { items = [], send = true } = {}) {
    let actor = await waitForActor();
    if (!actor) {
      throw new Error("The AI page is not ready");
    }
    let files = [];
    if (items.length) {
      let { collectPDFs, readFiles } = Zotero.SideBrowser.loadModule("src/context.mjs");
      let collected = await collectPDFs(items);
      if (collected.files.length) {
        files = await readFiles(collected.files);
      }
    }
    return actor.sendQuery("compose", { text, files, send });
  }

  /**
   * A link was clicked in the page. Same-site links stay in the pane; other
   * links and shift-clicks go to the system browser.
   *
   * @param {{href: string, shiftKey: boolean, target: string|null}} data
   */
  function handleLinkClick({ href, shiftKey, target }) {
    if (!href) {
      return;
    }
    let providerHost = "";
    try {
      providerHost = new URL(pane.provider.url).hostname;
    } catch (e) {
      providerHost = "";
    }
    let linkHost = "";
    try {
      linkHost = new URL(href).hostname;
    } catch (e) {
      linkHost = "";
    }
    let sameSite = providerHost && linkHost === providerHost;
    if (shiftKey || target === "_blank" || !sameSite) {
      Zotero.launchURL(href);
      return;
    }
    navigate(href);
  }

  function on(target, type, handler, capture = false) {
    if (!target) {
      return;
    }
    target.addEventListener(type, handler, capture);
    listeners.push({ target, type, handler, capture });
  }

  /** Scroll the item pane to this section and pin it, so the browser is seen. */
  function reveal(target) {
    let details = doc.getElementById("zotero-item-details");
    if (!details) {
      return;
    }
    try {
      details.pinnedPane = sectionKey;
      details.scrollToPane?.(sectionKey, "smooth");
    } catch (e) {
      Zotero.debug(`[Side Browser] Could not reveal the pane: ${e}`);
    }
  }

  return Object.assign(api, { handleLinkClick, reveal, syncContext });
}

// ---------------------------------------------------------------------------
// Plugin-wide entry points
// ---------------------------------------------------------------------------

/** Refresh the Zotero context in every pane. */
export async function refreshAll() {
  for (let pane of panes.values()) {
    try {
      await pane.api.refreshScope();
    } catch (e) {
      Zotero.debug(`[Side Browser] ${e}`);
    }
  }
}

/** Re-read the settings and the provider list, then redraw. */
export function applySettings() {
  loadProviders();
  for (let pane of panes.values()) {
    pane.provider = providerFor(pane.providerID);
    pane.api.render();
  }
}

/**
 * The pane that owns a browser element, found through the page's embedder.
 *
 * @param {Element} embedder
 */
export function paneForBrowser(embedder) {
  if (!embedder) {
    return null;
  }
  for (let pane of panes.values()) {
    if (pane.browser === embedder) {
      return pane.api;
    }
  }
  return null;
}

/**
 * The pane in a window, preferring one that belongs to the selected tab.
 *
 * @param {Window} win
 */
export function paneForWindow(win) {
  if (!win?.document) {
    return null;
  }
  let candidates = Array.from(panes.values()).filter((pane) => pane.doc === win.document && pane.root.isConnected);
  if (!candidates.length) {
    return null;
  }
  // Prefer a pane that is on screen, which is the one of the selected tab.
  let visible = candidates.find((pane) => {
    let rect = pane.root.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  return (visible || candidates[0]).api;
}

/** The pane of the active window, if there is one. */
export function activePane() {
  let win = Zotero.getMainWindow();
  return win ? paneForWindow(win) : null;
}

/**
 * Show the pane in a window.
 *
 * @param {Window} win
 */
export function showInWindow(win) {
  setPref("open", true);
  if (multi.activate(win)) {
    return true;
  }
  let api = paneForWindow(win);
  if (api) {
    api.reveal();
    return true;
  }
  // The section may be hidden in this tab, so force a rebuild and try again.
  try {
    Zotero.Notifier.trigger("refresh", "itempane", [PANE_ID]);
  } catch (e) {
    Zotero.debug(`[Side Browser] ${e}`);
  }
  let details = win?.document?.getElementById("zotero-item-details");
  if (!details) {
    return false;
  }
  try {
    details.pinnedPane = sectionKey;
    details.scrollToPane?.(sectionKey, "smooth");
    return true;
  } catch (e) {
    Zotero.debug(`[Side Browser] Could not show the pane: ${e}`);
    return false;
  }
}

/** Capture a reader text selection and put it in the pane of that window. */
export function useSelection(annotation, reader, win) {
  if (!annotation) {
    return false;
  }
  let api = paneForWindow(win || Zotero.getMainWindow());
  if (!api) {
    return false;
  }
  let pane = api.pane;
  pane.selection = {
    text: annotation.text || "",
    pageLabel: annotation.pageLabel,
    pageIndex: annotation.pageIndex,
    readerItemID: reader?.itemID || null,
  };
  pane.options.includePDFText = true;
  pane.options.touched.includePDFText = true;
  api.refreshScope().then(() => {
    api.reveal();
    api.focus();
    api.syncContext();
  });
  return true;
}

/** Reload every pane's browser. */
export function reloadAll() {
  for (let pane of panes.values()) {
    pane.api.reload();
  }
}

/** A snapshot of every pane, for the console API and the self test. */
export function describePanes() {
  return Array.from(panes.values()).map((pane) => ({
    url: (() => {
      try {
        return pane.browser.currentURI?.spec || "";
      } catch (e) {
        return "";
      }
    })(),
    provider: pane.provider?.id || "",
    scope: pane.scope.mode,
    items: pane.scope.items.map((item) => item.id),
    selection: pane.selection?.text?.slice(0, 80) || null,
    hasComposer: !!pane.ui.input,
  }));
}

export function truncate(text, max) {
  let value = String(text || "");
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max - 1) + "\u2026";
}

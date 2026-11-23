/*
 * The sidebar panel.
 *
 * One instance per main window. The panel is a resizable column on the right
 * edge of Zotero, next to both the item list and the PDF reader, so the same
 * browser session (and therefore the same login cookies) serves every tab.
 *
 * Layout: a `<browser>` fills the top, a composer fills the bottom. The
 * composer offers checkboxes that depend on the current Zotero context.
 */

import { SIDEBAR_CSS, SIDEBAR_MARKUP } from "./ui/styles.mjs";
import { DEFAULT_PROVIDERS, findProvider, loadCustomProviders } from "./providers/registry.mjs";
import * as context from "./context.mjs";
import { getPref, setPref } from "./prefs.mjs";

// ES modules do not inherit the chrome `Cc`/`Ci` shortcuts; derive them from
// `Components`, which is available.
const { classes: Cc, interfaces: Ci } = Components;

/** Plugin ID, needed by the reader event API. */
const PLUGIN_ID = "sidebrowser@00sapo.dev";

const MIN_WIDTH = 300;
const MAX_WIDTH = 1200;
const ACTOR_TIMEOUT_MS = 20000;

const ELEMENT_ID = "sidebrowser-pane";
const STYLE_ID = "sidebrowser-styles";

/** Human-readable text, kept here so the plugin needs no locale setup. */
const STRINGS = {
  back: "Back",
  forward: "Forward",
  reload: "Reload",
  provider: "AI service",
  external: "Open the current page in the system browser",
  composer: "Show or hide the message composer",
  close: "Close the sidebar",
  includeItem: "Include this paper",
  includeList: "Include all papers in this list",
  includeSelected: "Include only the selected papers",
  attachPDF: "Attach the PDF file",
  includePDFText: "Include the selected text",
  copy: "Copy",
  send: "Send",
  placeholder: "Ask a question, or write a comment on the context",
  scopeReader: "Context: the paper open in the reader",
  scopeSelection: "Context: the selected papers",
  scopeList: "Context: the papers in this list",
  scopeNone: "No paper context available in this tab",
  loading: "Loading the AI page",
  notReady: "The page is not ready yet. Wait for it to finish loading.",
  noComposer: "Could not find the message box on the page. The text is on the clipboard, paste it with Ctrl+V.",
  noFileInput: "The page offers no file input that accepts a PDF here. Open the paper in the browser and attach it by hand.",
  ready: "Ready",
  copied: "Prompt copied to the clipboard",
  sending: "Sending",
  sent: "Sent",
  sentNoConfirm: "Text inserted and the send action fired. Check the page if nothing happened.",
  attached: "Attached",
  attachFailed: "Could not attach",
  noFileInputShort: "this page takes no PDF",
  pdfSkipped: "No local PDF for",
  noContext: "Turn on a context option, or type a message",
};

export class Sidebar {
  /**
   * @param {Window} win - The Zotero main window.
   */
  constructor(win) {
    this.win = win;
    this.doc = win.document;

    this.pane = null;
    this.browser = null;
    this.composerBox = null;

    this.providers = [];
    this.provider = null;

    this.visible = false;
    this._width = getPref("width");

    // Cached context, refreshed whenever the tab or the selection changes.
    this.scope = { mode: "none", items: [] };
    this.selection = null;

    this._notifierIDs = [];
    this._prefObserverIDs = [];
    this._domListeners = [];
    this._pageLoaded = false;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async init() {
    this._injectStyles();
    this._loadProviders();
    this._build();
    this._registerNotifier();
    this._registerPrefObservers();
    this._registerReaderEvents();
    await this._refreshScope();
    this._render();

    let shouldOpen = getPref("open");
    if (shouldOpen) {
      this.open();
    }
    this._setStatus("");
  }

  async destroy() {
    for (let id of this._notifierIDs) {
      try {
        Zotero.Notifier.unregisterObserver(id);
      } catch (e) {
        Zotero.debug(`[Side Browser] ${e}`);
      }
    }
    this._notifierIDs = [];

    for (let id of this._prefObserverIDs) {
      try {
        Zotero.Prefs.unregisterObserver(id);
      } catch (e) {
        Zotero.debug(`[Side Browser] ${e}`);
      }
    }
    this._prefObserverIDs = [];

    for (let { target, type, handler, capture } of this._domListeners) {
      target.removeEventListener(type, handler, capture);
    }
    this._domListeners = [];

    this._splitterCleanup?.();

    try {
      if (this._webProgress && this._progressListener) {
        this._webProgress.removeProgressListener(this._progressListener);
      }
    } catch (e) {
      Zotero.debug(`[Side Browser] could not remove the progress listener: ${e}`);
    }
    this._webProgress = null;
    this._progressListener = null;

    if (this._attachTimer) {
      clearInterval(this._attachTimer);
      this._attachTimer = null;
    }

    let handlers = this._itemsViewHandlers;
    if (handlers) {
      handlers.itemsView.onSelect?.removeListener(handlers.handler);
      handlers.itemsView.onRefresh?.removeListener(handlers.refreshHandler);
      this._itemsViewHandlers = null;
    }

    try {
      this.doc.getElementById(STYLE_ID)?.remove();
    } catch (e) {
      Zotero.debug(`[Side Browser] ${e}`);
    }

    this._unmount();
    this.pane?.remove();
    this.pane = null;
    this.browser = null;
  }

  // -------------------------------------------------------------------------
  // DOM construction
  // -------------------------------------------------------------------------

  _injectStyles() {
    if (this.doc.getElementById(STYLE_ID)) {
      return;
    }
    let style = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
    style.id = STYLE_ID;
    style.textContent = SIDEBAR_CSS;
    this.doc.documentElement.appendChild(style);
  }

  _build() {
    let html = SIDEBAR_MARKUP;
    // Fill the placeholder text before parsing, so no l10n system is needed.
    html = html.replace(/__(\w+)__/g, (_, key) => STRINGS[key] ?? key);

    let fragment = this.doc.defaultView.MozXULElement.parseXULToFragment(
      `<html:div xmlns:html="http://www.w3.org/1999/xhtml" id="${ELEMENT_ID}" hidden="true">${html}</html:div>`,
    );
    this.pane = fragment.firstElementChild;
    this._width = this._clampWidth(this._width);
    this.pane.style.width = `${this._width}px`;

    this._mount();

    this.browser = this.pane.querySelector("browser.sb-browser");
    this.composerBox = this.pane.querySelector('[data-role="composer"]');
    this.overlay = this.pane.querySelector('[data-role="overlay"]');
    this.providerSelect = this.pane.querySelector('[data-role="provider"]');
    this.input = this.pane.querySelector('[data-role="input"]');
    this.statusEl = this.pane.querySelector('[data-role="status"]');
    this.scopeEl = this.pane.querySelector('[data-role="scope"]');
    this.selectionEl = this.pane.querySelector('[data-role="selection"]');

    // Which options the user changed by hand. Until then the panel picks
    // sensible defaults for the current context.
    this._userTouched = {};

    this.checkboxes = {
      includeItem: this.pane.querySelector('[data-role="includeItem"]'),
      includeList: this.pane.querySelector('[data-role="includeList"]'),
      includeSelected: this.pane.querySelector('[data-role="includeSelected"]'),
      attachPDF: this.pane.querySelector('[data-role="attachPDF"]'),
      includePDFText: this.pane.querySelector('[data-role="includePDFText"]'),
    };

    for (let [key, box] of Object.entries(this.checkboxes)) {
      let handler = () => {
        this._userTouched[key] = box.checked;
        if (key === "attachPDF") {
          setPref("includePDF", box.checked);
        }
        this._render();
      };
      box.addEventListener("change", handler);
      this._domListeners.push({ target: box, type: "change", handler });
    }

    this._bindToolbar();
    this._bindSplitter();
    this._bindComposer();
    this._bindBrowser();
    this._fillProviders();
  }

  /**
   * Dock the panel beside the tab stack.
   *
   * Zotero's custom elements reset their contents when they are disconnected
   * and reconnected, so the stack must not be moved. Instead the panel becomes
   * a second child of `#appcontent`, and a class turns that column into a row.
   */
  _mount() {
    let appcontent = this.doc.getElementById("appcontent");
    if (!appcontent) {
      throw new Error("Could not find #appcontent");
    }
    appcontent.appendChild(this.pane);
    this.mountHost = appcontent;

    // Tag the row that holds the collections pane, the item list, and the item
    // pane, so the stylesheet can let it shrink.
    let deck = this.doc.getElementById("tabs-deck");
    let row = deck?.parentElement;
    while (row && row !== appcontent) {
      if ((row.localName || "").toLowerCase() === "hbox") {
        row.classList.add("sb-stack-row");
        this.mountRow = row;
        break;
      }
      row = row.parentElement;
    }
  }

  _unmount() {
    try {
      this.mountHost?.classList.remove("sb-row");
      this.mountRow?.classList.remove("sb-stack-row");
    } catch (e) {
      Zotero.debug(`[Side Browser] unmount failed: ${e}`);
    }
    this.mountHost = null;
    this.mountRow = null;
  }

  _bindToolbar() {
    this.pane.querySelector(".sb-toolbar").addEventListener("click", (event) => {
      let button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }
      this._onToolbar(button.dataset.action);
    });

    this.providerSelect.addEventListener("change", () => {
      let id = this.providerSelect.value;
      setPref("provider", id);
      this._selectProvider(id, true);
    });
  }

  async _onToolbar(action) {
    switch (action) {
      case "back":
        this._browserCommand("cmd_goBack");
        break;
      case "forward":
        this._browserCommand("cmd_goForward");
        break;
      case "reload":
        this.reload();
        break;
      case "external":
        this._openCurrentPageExternally();
        break;
      case "composer":
        this.composerBox.hidden = !this.composerBox.hidden;
        break;
      case "close":
        this.close();
        break;
      default:
        break;
    }
  }

  _browserCommand(cmd) {
    try {
      let command = this.doc.getElementById(cmd);
      if (command) {
        command.doCommand?.();
        return;
      }
    } catch (e) {
      Zotero.debug(`[Side Browser] browser command ${cmd} failed: ${e}`);
    }
    try {
      if (cmd === "cmd_goBack") {
        this.browser.goBack();
      } else if (cmd === "cmd_goForward") {
        this.browser.goForward();
      }
    } catch (e) {
      Zotero.debug(`[Side Browser] browser command ${cmd} failed: ${e}`);
    }
  }

  _openCurrentPageExternally() {
    let url = this._currentURL();
    if (url) {
      Zotero.launchURL(url);
    }
  }

  _bindSplitter() {
    let splitter = this.pane.querySelector(".sb-splitter");
    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    let onMove = (event) => {
      if (!dragging) {
        return;
      }
      // The panel sits on the right edge, so dragging left makes it wider.
      let delta = startX - event.clientX;
      let width = this._clampWidth(startWidth + delta);
      this.pane.style.width = `${width}px`;
    };

    let onUp = () => {
      if (!dragging) {
        return;
      }
      dragging = false;
      this.win.removeEventListener("mousemove", onMove, true);
      this.win.removeEventListener("mouseup", onUp, true);
      this._width = this._clampWidth(this.pane.getBoundingClientRect().width);
      setPref("width", Math.round(this._width));
      this.win.ZoteroPane?.updateLayoutConstraints?.();
    };

    let onDown = (event) => {
      if (event.button !== 0) {
        return;
      }
      dragging = true;
      startX = event.clientX;
      startWidth = this.pane.getBoundingClientRect().width;
      event.preventDefault();
      this.win.addEventListener("mousemove", onMove, true);
      this.win.addEventListener("mouseup", onUp, true);
    };

    splitter.addEventListener("mousedown", onDown);
    this._domListeners.push({ target: splitter, type: "mousedown", handler: onDown });

    // If the window is destroyed mid-drag, the window listeners would leak.
    this._splitterCleanup = () => {
      this.win.removeEventListener("mousemove", onMove, true);
      this.win.removeEventListener("mouseup", onUp, true);
    };
  }

  _bindComposer() {
    this.pane.querySelector(".sb-actions").addEventListener("click", (event) => {
      let button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }
      if (button.dataset.action === "send") {
        this._onSend();
      } else if (button.dataset.action === "copy") {
        this._onCopy();
      }
    });

    let onKeyDown = (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this._onSend();
      }
    };
    this.input.addEventListener("keydown", onKeyDown);
    this._domListeners.push({ target: this.input, type: "keydown", handler: onKeyDown });
  }

  _bindBrowser() {
    let updateNav = () => {
      let canBack = false;
      let canForward = false;
      try {
        canBack = this.browser.canGoBack;
        canForward = this.browser.canGoForward;
      } catch (e) {
        // The browser element is not ready yet.
      }
      this.pane.querySelector('button[data-action="back"]').disabled = !canBack;
      this.pane.querySelector('button[data-action="forward"]').disabled = !canForward;
    };

    // A XUL browser inside another chrome window does not reliably fire DOM
    // `load` events for remote content, so listen to the browsing context.
    let attachProgressListener = () => {
      let webProgress;
      try {
        webProgress = this.browser.browsingContext?.webProgress;
      } catch (e) {
        webProgress = null;
      }
      if (!webProgress) {
        return false;
      }
      this._progressListener = {
        onStateChange: (_progress, _request, stateFlags) => {
          let stop = stateFlags & Ci.nsIWebProgressListener.STATE_STOP;
          let isDocument = stateFlags & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT;
          let isNetwork = stateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK;
          if (stop && (isDocument || isNetwork)) {
            this._onPageLoad();
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
        webProgress.addProgressListener(
          this._progressListener,
          Ci.nsIWebProgress.NOTIFY_STATE_ALL | Ci.nsIWebProgress.NOTIFY_LOCATION,
        );
        this._webProgress = webProgress;
        return true;
      } catch (e) {
        Zotero.debug(`[Side Browser] could not attach progress listener: ${e}`);
        return false;
      }
    };

    // The browsing context exists only after the element is in the document.
    if (!attachProgressListener()) {
      let tries = 0;
      let timer = setInterval(() => {
        tries += 1;
        if (attachProgressListener() || tries > 40) {
          clearInterval(timer);
        }
      }, 100);
      this._attachTimer = timer;
    }

    for (let [type, handler] of [
      ["load", () => this._onPageLoad()],
      ["DOMContentLoaded", () => this._onPageLoad()],
    ]) {
      this.browser.addEventListener(type, handler, true);
      this._domListeners.push({ target: this.browser, type, handler, capture: true });
    }
  }

  /**
   * Called once a page finished loading. Hides the overlay, refreshes the
   * navigation buttons, and hands the provider selectors to the actor.
   */
  _onPageLoad() {
    if (this._pageLoaded) {
      // Still re-apply, because a redirect may have replaced the content window.
      this._applyAdapter();
      return;
    }
    this._pageLoaded = true;
    if (this.overlay) {
      this.overlay.hidden = true;
    }
    this._applyAdapter();
  }

  // -------------------------------------------------------------------------
  // Providers and navigation
  // -------------------------------------------------------------------------

  _loadProviders() {
    let custom = loadCustomProviders(getPref("customProviders"));
    this.providers = [...DEFAULT_PROVIDERS, ...custom];
    let savedId = getPref("provider");
    let customURL = getPref("customURL");
    if (savedId === "custom" && customURL) {
      this.providers.push({
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
    this.provider = findProvider(this.providers, savedId);
  }

  _fillProviders() {
    this.providerSelect.replaceChildren();
    for (let provider of this.providers) {
      let option = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "option");
      option.value = provider.id;
      option.textContent = provider.label;
      this.providerSelect.appendChild(option);
    }
    this.providerSelect.value = this.provider.id;
  }

  _selectProvider(id, navigate) {
    let provider = findProvider(this.providers, id);
    if (!provider) {
      return;
    }
    this.provider = provider;
    this.providerSelect.value = provider.id;
    if (navigate) {
      this._navigate(provider.url);
    }
    this._applyAdapter();
    this._render();
  }

  _navigate(url) {
    if (!url) {
      return;
    }
    this._pageLoaded = false;
    this._showOverlay(`${STRINGS.loading}...`);
    try {
      this.browser.loadURI(Services.io.newURI(url), {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
    } catch (e) {
      Zotero.logError(e);
      this._showOverlay(`Could not open ${url}`);
    }
  }

  reload() {
    this._navigate(this._currentURL() || this.provider?.url);
  }

  /**
   * The address the browser shows. A fresh browser reports `about:blank`
   * before the first load, which callers treat as "no page yet".
   *
   * @returns {string}
   */
  _currentURL() {
    try {
      let spec = this.browser?.currentURI?.spec || "";
      return spec === "about:blank" ? "" : spec;
    } catch (e) {
      return "";
    }
  }

  _showOverlay(text) {
    if (!this.overlay) {
      return;
    }
    this.overlay.textContent = text;
    this.overlay.hidden = false;
  }

  async _applyAdapter() {
    let actor = this._getActor();
    if (!actor) {
      actor = await this._waitForActor();
      if (!actor) {
        Zotero.debug("[Side Browser] no actor for the current page");
        return;
      }
    }
    try {
      await actor.sendQuery("set-adapter", { adapter: this._adapterForPage() });
      let info = await actor.sendQuery("prepare", {});
      this.pageInfo = info;
    } catch (e) {
      this.pageInfo = null;
      Zotero.debug(`[Side Browser] could not set the page adapter: ${e}`);
    }
    this._updateAttachmentAvailability();
  }

  _adapterForPage() {
    let url = this._currentURL();
    let provider = this.provider;
    // A login page or a redirect to another host keeps the selectors of the
    // configured provider, because the session will return there.
    return {
      composerSelectors: provider.composerSelectors,
      sendSelectors: provider.sendSelectors,
      sendMode: provider.sendMode,
      fileSelectors: provider.fileSelectors,
      url,
    };
  }

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  open() {
    if (!this.pane) {
      return false;
    }
    this.visible = true;
    this.pane.hidden = false;
    // The row class turns the vertical stack into a horizontal row. It must be
    // present only while the panel is visible, or Zotero lays out an empty gap.
    this.mountHost?.classList.add("sb-row");
    setPref("open", true);
    let url = this._currentURL();
    let hasPage = url && url !== "about:blank";
    if (!this._pageLoaded && !hasPage) {
      this._navigate(this.provider.url);
    }
    this.win.ZoteroPane?.updateLayoutConstraints?.();
    this._render();
    return true;
  }

  close() {
    if (!this.pane) {
      return false;
    }
    this.visible = false;
    this.pane.hidden = true;
    this.mountHost?.classList.remove("sb-row");
    setPref("open", false);
    this.win.ZoteroPane?.updateLayoutConstraints?.();
    return true;
  }

  toggle() {
    return this.visible ? this.close() : this.open();
  }

  /**
   * Keep the panel inside the space the window actually has. Zotero reserves
   * about 930 pixels for the collections pane, the item list, and the item
   * pane, so the panel must not push them out of the window.
   */
  _clampWidth(width) {
    let value = Number(width);
    if (!Number.isFinite(value)) {
      value = 460;
    }
    let available = Number.POSITIVE_INFINITY;
    try {
      let total = this.win.innerWidth || 0;
      if (total) {
        available = Math.max(MIN_WIDTH, Math.round(total * 0.6));
      }
    } catch (e) {
      available = Number.POSITIVE_INFINITY;
    }
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, available, Math.round(value)));
  }

  // -------------------------------------------------------------------------
  // Zotero context
  // -------------------------------------------------------------------------

  _registerNotifier() {
    let id = Zotero.Notifier.registerObserver({
      notify: async (action, type) => {
        if (type === "tab" && ["select", "close", "add"].includes(action)) {
          await this._refreshScope();
          this._render();
        }
        if (type === "item" && action === "modify") {
          await this._refreshScope();
          this._render();
        }
      },
    }, ["tab", "item"], "sidebrowser");
    this._notifierIDs.push(id);

    // The item tree reports selection changes through a listener binding, not
    // through the notifier, so listen there as well.
    let itemsView = this.win.ZoteroPane?.itemsView;
    if (itemsView?.onSelect) {
      let handler = async () => {
        await this._refreshScope();
        this._render();
      };
      itemsView.onSelect.addListener(handler);
      let refreshHandler = handler;
      itemsView.onRefresh?.addListener(refreshHandler);
      this._itemsViewHandlers = { itemsView, handler, refreshHandler };
    }
  }

  _registerPrefObservers() {
    let id = Zotero.Prefs.registerObserver("sidebrowser.enabled", (value) => {
      if (value === false) {
        this.close();
      }
    });
    this._prefObserverIDs.push(id);
  }

  /**
   * The reader offers a text-selection popup. A button there sends the
   * selection to the sidebar, which is faster than copying and pasting.
   */
  _registerReaderEvents() {
    if (!Zotero.Reader?.registerEventListener) {
      return;
    }
    Zotero.Reader.registerEventListener(
      "renderTextSelectionPopup",
      (event) => {
        let { doc, params, append } = event;
        let button = doc.createElement("button");
        button.className = "toolbar-button wide-button";
        button.textContent = "Ask in sidebar";
        button.addEventListener("click", () => {
          this._useSelection(params.annotation, params.reader || event.reader);
        });
        append(button);
      },
      PLUGIN_ID,
    );
  }

  _useSelection(annotation, reader) {
    if (!annotation) {
      return;
    }
    this.selection = {
      text: annotation.text || "",
      pageLabel: annotation.pageLabel,
      pageIndex: annotation.pageIndex,
      readerItemID: reader?.itemID || this._selectedReader()?.itemID,
    };
    this.open();
    this.composerBox.hidden = false;
    this.checkboxes.includePDFText.checked = true;
    this._render();
    this.input.focus();
  }

  /**
   * Work out what the current tab offers as context.
   *
   * Reader tab: the open paper, plus a text selection if one was captured.
   * Library tab: the highlighted items, or every item in the list.
   */
  async _refreshScope() {
    let mode = "none";
    let items = [];

    let tabs = this.win.Zotero_Tabs;
    let selectedTabType = tabs?.selectedType;
    if (selectedTabType === "reader") {
      let reader = this._selectedReader();
      let item = reader ? Zotero.Items.get(reader.itemID) : null;
      if (item) {
        items = [item];
        mode = "reader";
      }
    } else if (selectedTabType === "library") {
      let pane = this.win.ZoteroPane;
      let selected = [];
      let listed = [];
      try {
        selected = pane?.itemsView?.getSelectedObjects?.() || pane?.getSelectedItems?.() || [];
      } catch (e) {
        selected = [];
      }
      try {
        let max = Number(getPref("maxItems")) || 30;
        listed = (pane?.itemsView?.getSortedItems?.() || []).slice(0, max);
      } catch (e) {
        listed = [];
      }
      if (selected.length) {
        mode = "selection";
        items = selected;
      } else if (listed.length) {
        mode = "list";
        items = listed;
      }
      this.listedCount = listed.length;
      this.selectedCount = selected.length;
    }

    this.scope = { mode, items };
  }

  /**
   * The reader instance of the selected tab, if that tab is a reader.
   * `Zotero_Tabs` lives on the window, not on the ES module global.
   */
  _selectedReader() {
    let tabs = this.win.Zotero_Tabs;
    if (!tabs || tabs.selectedType !== "reader") {
      return null;
    }
    return Zotero.Reader.getByTabID(tabs.selectedID) || null;
  }

  /**
   * A plain snapshot of the current context, for the console API.
   */
  buildScopeSnapshot() {
    return {
      mode: this.scope.mode,
      items: this.scope.items.map((item) => ({
        id: item.id,
        title: item.getField("title"),
        type: item.itemType,
      })),
      selection: this.selection,
    };
  }

  // -------------------------------------------------------------------------
  // Rendering of the composer
  // -------------------------------------------------------------------------

  _render() {
    if (!this.pane) {
      return;
    }

    let mode = this.scope.mode;
    let count = this.scope.items.length;

    let scopeText = {
      reader: STRINGS.scopeReader,
      selection: `${STRINGS.scopeSelection} (${count})`,
      list: `${STRINGS.scopeList} (${count})`,
      none: STRINGS.scopeNone,
    }[mode];
    this.scopeEl.textContent = scopeText;

    let showItem = mode === "reader";
    let showList = mode === "list" || (mode === "selection" && this.listedCount > count);
    let showSelected = mode === "selection";
    let hasSelection = !!this.selection?.text;

    this.pane.querySelector('[data-option="itemContext"]').hidden = !showItem;
    this.pane.querySelector('[data-option="listContext"]').hidden = !showList;
    this.pane.querySelector('[data-option="selectionContext"]').hidden = !showSelected;
    this.pane.querySelector('[data-option="pdfAttachment"]').hidden = !(showItem || showSelected);
    this.pane.querySelector('[data-option="pdfText"]').hidden = !hasSelection;

    let listLabel = this.pane.querySelector('[data-role="includeListLabel"]');
    if (showList) {
      listLabel.textContent = `${STRINGS.includeList} (${this.listedCount})`;
    }
    let selectedLabel = this.pane.querySelector('[data-role="includeSelectedLabel"]');
    if (showSelected) {
      selectedLabel.textContent = `${STRINGS.includeSelected} (${count})`;
    }

    if (showItem) {
      let title = this.scope.items[0]?.getField("title") || "";
      this.checkboxes.includeItem.parentElement.querySelector("span").textContent =
        `${STRINGS.includeItem}: ${truncate(title, 60)}`;
    }

    if (hasSelection) {
      this.selectionEl.hidden = false;
      this.selectionEl.textContent = truncate(this.selection.text, 400);
    } else {
      this.selectionEl.hidden = true;
      this.selectionEl.textContent = "";
    }

    // A scope option starts checked when it becomes the only possible source of
    // context, so the common case needs no clicks. The user can always clear it.
    if (showItem && !this._userTouched.includeItem) {
      this.checkboxes.includeItem.checked = true;
    }
    if (showSelected && !this._userTouched.includeSelected) {
      this.checkboxes.includeSelected.checked = true;
    }
    if (showList && !this._userTouched.includeList) {
      this.checkboxes.includeList.checked = true;
    }
    if (!hasSelection) {
      this.checkboxes.includePDFText.checked = false;
    } else if (this._userTouched.includePDFText === false) {
      // Keep the user's choice.
    }

    if (this._userTouched.attachPDF === undefined) {
      this.checkboxes.attachPDF.checked = !!getPref("includePDF");
    }
    this._updateAttachmentAvailability();

    this._updateSendState();
  }

  /**
   * Enable the PDF option only when the current page can really take a file.
   *
   * Two cases block it: nothing is checked in, or the page offers no file input
   * that accepts a document. A signed-out ChatGPT page only offers image inputs,
   * which is why the second case matters.
   */
  _updateAttachmentAvailability() {
    let box = this.checkboxes.attachPDF;
    let label = this.pane.querySelector('[data-role="attachPDFLabel"]');
    let includeAnything = this.checkboxes.includeItem.checked
      || this.checkboxes.includeList.checked
      || this.checkboxes.includeSelected.checked;
    let pageAccepts = !this.pageInfo || (this.pageInfo.fileInputs || []).length > 0;

    box.disabled = !includeAnything || !pageAccepts;
    if (label) {
      label.textContent = includeAnything && !pageAccepts
        ? `${STRINGS.attachPDF}: ${STRINGS.noFileInputShort}`
        : STRINGS.attachPDF;
    }
    if (box.disabled) {
      box.checked = false;
      return;
    }
    // Coming back to a page that accepts files must restore the choice the user
    // expects, not leave the box off because another page disabled it.
    if (this._userTouched.attachPDF === undefined) {
      box.checked = !!getPref("includePDF");
    }
  }

  _updateSendState() {
    let button = this.pane.querySelector('button[data-action="send"]');
    if (!button) {
      return;
    }
    let hasContext = this.checkboxes.includeItem.checked
      || this.checkboxes.includeList.checked
      || this.checkboxes.includeSelected.checked
      || (this.checkboxes.includePDFText.checked && this.selection?.text);
    let hasText = !!this.input.value.trim();
    button.disabled = !(hasContext || hasText);
  }

  _setStatus(text, isError = false) {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.textContent = text || "";
    this.statusEl.classList.toggle("sb-error", !!isError);
  }

  // -------------------------------------------------------------------------
  // Prompt assembly
  // -------------------------------------------------------------------------

  /**
   * Build the text prompt and the list of items whose PDFs to attach.
   *
   * @returns {{text: string, items: Zotero.Item[], selection: object|null}}
   */
  _compose() {
    let parts = [];

    let scopeItems = [];
    if (this.checkboxes.includeItem.checked && this.scope.mode === "reader") {
      scopeItems = this.scope.items;
    } else if (this.checkboxes.includeSelected.checked && this.scope.mode === "selection") {
      scopeItems = this.scope.items;
    } else if (this.checkboxes.includeList.checked && this.scope.mode === "list") {
      scopeItems = this.scope.items;
    }

    if (scopeItems.length) {
      parts.push(context.describeItems(scopeItems));
    }

    let selection = null;
    if (this.checkboxes.includePDFText.checked && this.selection?.text) {
      let attachment = this.selection.readerItemID
        ? Zotero.Items.get(this.selection.readerItemID)
        : null;
      parts.push(context.describeSelection({
        text: this.selection.text,
        pageLabel: this.selection.pageLabel,
        pageIndex: this.selection.pageIndex,
      }, attachment));
      selection = this.selection;
    }

    let userText = this.input.value.trim();
    if (userText) {
      parts.push(userText);
    }

    let attachItems = this.checkboxes.attachPDF.checked ? scopeItems : [];

    return {
      text: parts.join("\n\n"),
      items: attachItems,
      selection,
    };
  }

  async _onCopy() {
    let composed = this._compose();
    let text = composed.text;
    if (!text) {
      this._setStatus(STRINGS.noContext, true);
      return;
    }
    await this._copyToClipboard(text);
    this._setStatus(STRINGS.copied);
  }

  async _onSend() {
    let composed = this._compose();
    if (!composed.text && !composed.items.length) {
      this._setStatus(STRINGS.noContext, true);
      return;
    }
    try {
      await this.ask(composed.text, {
        items: composed.items,
        copyOnFailure: true,
      });
    } catch (e) {
      this._setStatus(`${e.message || e}`, true);
    }
  }

  // -------------------------------------------------------------------------
  // Sending to the page
  // -------------------------------------------------------------------------

  /**
   * Send text, and optionally the PDFs of some items, to the active provider.
   *
   * The actor does the page work. If it cannot find the composer, the text goes
   * to the clipboard and a notice explains what to do.
   *
   * @param {string} text
   * @param {object} [options]
   * @param {Zotero.Item[]} [options.items] - Items whose PDFs to attach.
   * @param {boolean} [options.copyOnFailure]
   * @param {boolean} [options.send] - Set false to only insert the text.
   */
  async ask(text, { items = [], copyOnFailure = true, send = true } = {}) {
    items = [...items];
    if (!this.visible) {
      this.open();
    }
    if (!this.provider) {
      throw new Error("No AI provider is configured");
    }

    this._setStatus(`${STRINGS.sending}...`);
    let button = this.pane.querySelector('button[data-action="send"]');
    if (button) {
      button.disabled = true;
    }

    try {
      let files = [];
      let skipped = [];
      // The page decides whether a file can be attached; do not send bytes to a
      // page whose inputs refuse documents.
      let pageAccepts = !this.pageInfo || (this.pageInfo.fileInputs || []).length > 0;
      if (items.length && !pageAccepts) {
        for (let item of items) {
          skipped.push({
            itemID: item.id,
            title: item.getField("title"),
            reason: "page-refuses",
          });
        }
        items = [];
      }
      if (items.length) {
        let collected = await context.collectPDFs(items);
        skipped = collected.skipped;
        if (collected.files.length) {
          files = await context.readFiles(collected.files);
        }
      }

      let actor = await this._waitForActor();
      if (!actor) {
        if (copyOnFailure) {
          await this._copyToClipboard(text);
        }
        this._setStatus(
          `${STRINGS.notReady}${copyOnFailure ? ` ${STRINGS.copied}.` : ""}`,
          true,
        );
        return { ok: false, stage: "actor" };
      }

      let result = await actor.sendQuery("compose", {
        text,
        files,
        send,
      });

      this._reportResult(result, skipped);
      return result;
    } catch (e) {
      Zotero.logError(e);
      if (copyOnFailure) {
        await this._copyToClipboard(text);
      }
      this._setStatus(`${e.message || e}`, true);
      return { ok: false, stage: "exception", error: String(e) };
    } finally {
      if (button) {
        button.disabled = false;
      }
      this._updateSendState();
    }
  }

  _reportResult(result, skipped = []) {
    if (!result || !result.ok) {
      let message = result?.error || STRINGS.noComposer;
      let stage = result?.stage;
      if (stage === "composer") {
        this._setStatus(STRINGS.noComposer, true);
      } else {
        this._setStatus(message, true);
      }
      return;
    }

    let notes = [];
    if (result.attached?.length) {
      notes.push(`${STRINGS.attached}: ${result.attached.join(", ")}`);
    }
    for (let miss of result.attachErrors || []) {
      notes.push(`${STRINGS.attachFailed} ${miss.name}`);
    }
    for (let miss of skipped) {
      let reason = {
        "no-local-file": "no file on disk",
        "no-pdf": "no PDF attachment",
        "page-refuses": "the page takes no PDF",
      }[miss.reason] || "not attached";
      notes.push(`${STRINGS.pdfSkipped} "${truncate(miss.title || "", 40)}" (${reason})`);
    }
    if (result.sent) {
      notes.unshift(STRINGS.sent);
    } else if (result.ok) {
      notes.unshift(STRINGS.sentNoConfirm);
    }
    this._setStatus(notes.join(". "));
  }

  async _copyToClipboard(text) {
    try {
      let clipboard = Cc["@mozilla.org/widget/clipboardhelper;1"]
        .getService(Ci.nsIClipboardHelper);
      clipboard.copyString(text);
    } catch (e) {
      Zotero.debug(`[Side Browser] clipboard failed: ${e}`);
    }
  }

  _getActor() {
    try {
      let bc = this.browser?.browsingContext;
      if (!bc) {
        return null;
      }
      let windowGlobal = bc.currentWindowGlobal;
      if (!windowGlobal) {
        return null;
      }
      return windowGlobal.getActor("SideBrowser") || null;
    } catch (e) {
      Zotero.debug(`[Side Browser] _getActor failed: ${e}`);
      return null;
    }
  }

  async _waitForActor() {
    let start = Date.now();
    while (Date.now() - start < ACTOR_TIMEOUT_MS) {
      let actor = this._getActor();
      if (actor) {
        return actor;
      }
      await Zotero.Promise.delay(250);
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Link routing
  // -------------------------------------------------------------------------

  /**
   * Links clicked inside the page normally stay in the sidebar. Shift-click and
   * target="_blank" go to the system browser, and cross-origin links keep the
   * sidebar on the AI service instead of turning it into a general browser.
   *
   * Called from the actor parent.
   *
   * @param {{href: string, shiftKey: boolean, target: string|null}} data
   */
  handleLinkClick({ href, shiftKey, target }) {
    if (!href) {
      return;
    }
    let providerHost = "";
    try {
      providerHost = new URL(this.provider.url).hostname;
    } catch (e) {
      providerHost = "";
    }
    let linkHost = "";
    try {
      linkHost = new URL(href).hostname;
    } catch (e) {
      linkHost = "";
    }

    let isSameSite = providerHost && (
      linkHost === providerHost
      || linkHost.endsWith(`.${providerHost}`)
      || providerHost.endsWith(linkHost)
    );

    if (shiftKey || target === "_blank" || !isSameSite) {
      Zotero.launchURL(href);
      return;
    }
    this._navigate(href);
  }

}

function truncate(text, max) {
  let value = String(text || "");
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max - 1) + "\u2026";
}

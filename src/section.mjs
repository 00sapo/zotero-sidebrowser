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
 *
 * What the pane sends is always a set of files. The check boxes choose the kinds
 * (see `package.mjs`), the page script attaches them when the user sends, and
 * every message to the user is a Zotero notification.
 */

import { PaneCSS, paneMarkup } from "./ui/styles.mjs";
import { buildScope, loadOptions, saveOption } from "./scope.mjs";
import { KINDS, buildPackage, contextText, describeOptions } from "./package.mjs";
import { DEFAULT_PROVIDERS, findProvider, loadCustomProviders } from "./providers/registry.mjs";
import { getPref, setPref } from "./prefs.mjs";
import * as multi from "./multi.mjs";

const PLUGIN_ID = "sidebrowser@00sapo.dev";
const PANE_ID = "sidebrowser-pane";
const ACTOR_TIMEOUT_MS = 20000;

/** The pane never gets shorter than this when it fills the visible area. */
const MIN_PANE_HEIGHT = 480;

/** Limits for a height the user drags to. */
const MIN_DRAG_HEIGHT = 320;
const MAX_DRAG_HEIGHT = 4000;

/** Page zoom levels in percent, the same steps that Firefox uses. */
const ZOOM_STEPS = [30, 50, 67, 80, 90, 100, 110, 120, 133, 150, 170, 200, 240, 300];

/** Kinds that are text, as opposed to files from disk. */
const TEXT_KINDS = ["metadata", "selection"];

/** Every live pane, keyed by the body element Zotero handed over. */
const panes = new Map();

let sectionKey = null;
let providers = [];

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Tell the user something through Zotero's own progress notification, which
 * shows in a corner of the window and closes by itself.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.error]
 */
export function notify(text, { error = false } = {}) {
  try {
    let popup = new Zotero.ProgressWindow({ window: Zotero.getMainWindow(), closeOnClick: true });
    popup.changeHeadline(error ? "AI sidebar: problem" : "AI sidebar");
    popup.addDescription(text);
    popup.show();
    popup.startCloseTimer(error ? 7000 : 4000);
  } catch (e) {
    Zotero.debug(`[Side Browser] Could not show a notification: ${e}`);
  }
}

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
      header: { l10nID: "sidebrowser-section-header", icon },
      sidenav: { l10nID: "sidebrowser-section-sidenav", icon },
      // On in every tab: the browser is useful beside the item list too.
      onItemChange: ({ setEnabled }) => {
        setEnabled(!!getPref("open"));
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
 * Fill a body that this plugin made itself, such as the multi-item panel.
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

/**
 * Fill one body with the browser and the controls.
 *
 * `onRender` can run more than once for the same body, so a second call reuses
 * the existing pane instead of building a second browser.
 *
 * @param {Document} doc
 * @param {HTMLElement} body
 */
function renderPane(doc, body) {
  let existing = panes.get(body);
  if (existing) {
    return existing.api;
  }

  injectPaneStyles(doc);
  applyLabelFallback(doc, body);
  let root = parseMarkup(doc, paneMarkup());
  body.replaceChildren(root);

  let pane = {
    doc,
    root,
    body,
    browser: root.querySelector("browser.sb-browser"),
    ui: {},
    provider: null,
    providerID: getPref("provider"),
    scope: { mode: "none", items: [] },
    selection: null,
    options: loadOptions(),
    // True after "Insert context to edit": the text is in the message box, so
    // the text files must not travel a second time.
    textInserted: false,
    // Height the user dragged to, or 0 to fill the visible area.
    manualHeight: Number(getPref("paneHeight")) || 0,
    pageInfo: null,
    pageLoaded: false,
  };

  for (let role of ["provider", "overlay", "resizer", "hint", ...KINDS]) {
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
 * Parse the pane markup. The wrapper declares the XHTML namespace, so HTML tags
 * carry the `html:` prefix, while `<browser>` stays a XUL element.
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
 * @param {object} pane
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
  let fitObserver = null;
  let fitTarget = null;

  let api = {
    get pane() {
      return pane;
    },

    /** Called once for a fresh pane. */
    start() {
      bindToolbar();
      bindOptions();
      bindActions();
      bindResizer();
      bindBrowser();
      fillProviders();
      render();
      navigate(getPref("lastURL") || pane.provider.url);
      refreshScope();
      startActorWatch();
      watchSize();
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
      for (let timer of [attachTimer, actorWatch]) {
        if (timer) {
          win.clearInterval(timer);
        }
      }
      attachTimer = null;
      actorWatch = null;
      if (fitObserver) {
        fitObserver.disconnect();
        fitObserver = null;
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

    /** Send the package key to the page, so it knows files are waiting. */
    async syncPackage() {
      return syncPackage();
    },

    /** The key that names the package for the current papers and options. */
    packageKey,

    selectProvider(id) {
      setPref("provider", id);
      pane.providerID = id;
      pane.provider = providerFor(id);
      ui.provider.value = pane.provider.id;
      navigate(pane.provider.url);
      applyAdapter();
      render();
    },

    /** The text of the checked text options. */
    async contextText() {
      return contextText(packageInput());
    },

    /**
     * Called by the page script when the user sends: build the files it asks for.
     *
     * @returns {Promise<{files: object[], skipped: object[]}>}
     */
    async packageForPage() {
      let built = await buildPackage({ ...packageInput(), skipText: pane.textInserted });
      return built;
    },

    /** Called by the page script after it sent a message with files. */
    reportSent(report) {
      reportSent(report);
    },

    async ask(text, options = {}) {
      return ask(text, options);
    },

    /** Scroll to this section and pin it, so the browser is seen. */
    reveal() {
      let details = doc.getElementById("zotero-item-details");
      if (!details || !sectionKey) {
        return;
      }
      try {
        details.pinnedPane = sectionKey;
        details.scrollToPane?.(sectionKey, "smooth");
      } catch (e) {
        Zotero.debug(`[Side Browser] Could not reveal the pane: ${e}`);
      }
    },

    /**
     * A link was clicked in the page. Same-site links stay in the pane; other
     * links and shift-clicks go to the system browser.
     *
     * @param {{href: string, shiftKey: boolean, target: string|null}} data
     */
    handleLinkClick({ href, shiftKey, target }) {
      if (!href) {
        return;
      }
      let providerHost = "";
      let linkHost = "";
      try {
        providerHost = new URL(pane.provider.url).hostname;
      } catch (e) {
        providerHost = "";
      }
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
    },

    /** Used by the self test to reach the resize and zoom logic. */
    get resizer() {
      return { fit, setManualHeight };
    },

    zoomBy: stepZoom,
    applyZoom,
  };

  // ------------------------------------------------------------------- size

  /**
   * Make the pane as tall as the visible area, and keep it so, unless the user
   * dragged the handle. The scroll area of the item pane is the only thing that
   * knows the visible height, so its size drives the pane. In the multi-item
   * panel the panel itself is the area and CSS does the work.
   */
  function watchSize() {
    let area = root.closest("#zotero-view-item");
    if (!area) {
      // The multi-item panel sizes the pane in CSS, and a dragged height would
      // fight that, so the handle has no job there.
      ui.resizer.hidden = true;
      return;
    }
    fitTarget = area;
    if (win.ResizeObserver) {
      fitObserver = new win.ResizeObserver(() => fit());
      fitObserver.observe(area);
    }
    fit();
  }

  function fit() {
    if (!fitTarget || !root.isConnected) {
      return;
    }
    if (pane.manualHeight) {
      root.style.height = `${pane.manualHeight}px`;
      return;
    }
    let areaHeight = fitTarget.clientHeight;
    if (!areaHeight) {
      return;
    }
    // The section header sits above the body and is part of the visible area.
    let head = pane.body?.closest("collapsible-section")?.querySelector(".head");
    let used = (head?.getBoundingClientRect().height || 36) + 12;
    root.style.height = `${Math.max(MIN_PANE_HEIGHT, Math.floor(areaHeight - used))}px`;
  }

  /** @param {number} height - Pixels, or 0 to fill the visible area again. */
  function setManualHeight(height) {
    pane.manualHeight = height
      ? Math.min(MAX_DRAG_HEIGHT, Math.max(MIN_DRAG_HEIGHT, Math.round(height)))
      : 0;
    setPref("paneHeight", pane.manualHeight);
    fit();
  }

  /**
   * The handle under the page. A pointer capture keeps the move events coming
   * while the pointer is over the browser, which would swallow plain mouse
   * events.
   */
  function bindResizer() {
    let handle = ui.resizer;
    let drag = null;

    on(handle, "pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      try {
        handle.setPointerCapture(event.pointerId);
      } catch (e) {
        // A synthetic pointer has no capture. The move events still reach us.
      }
      drag = { startY: event.clientY, startHeight: root.getBoundingClientRect().height };
      handle.classList.add("sb-dragging");
      event.preventDefault();
    });

    on(handle, "pointermove", (event) => {
      if (!drag) {
        return;
      }
      let height = drag.startHeight + (event.clientY - drag.startY);
      pane.manualHeight = Math.min(MAX_DRAG_HEIGHT, Math.max(MIN_DRAG_HEIGHT, Math.round(height)));
      root.style.height = `${pane.manualHeight}px`;
    });

    let finish = () => {
      if (!drag) {
        return;
      }
      drag = null;
      handle.classList.remove("sb-dragging");
      setPref("paneHeight", pane.manualHeight);
    };
    on(handle, "pointerup", finish);
    on(handle, "pointercancel", finish);

    on(handle, "dblclick", () => setManualHeight(0));
  }

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
      case "zoomin":
        stepZoom(1);
        break;
      case "zoomout":
        stepZoom(-1);
        break;
      case "external":
        if (currentURL()) {
          Zotero.launchURL(currentURL());
        }
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------- zoom

  /** Move to the next zoom level up or down, and remember it. */
  function stepZoom(direction) {
    let current = Number(getPref("zoomPercent")) || 100;
    let index = ZOOM_STEPS.findIndex((step) => step >= current);
    if (index === -1) {
      index = ZOOM_STEPS.length - 1;
    }
    // A level between two steps moves to the nearer step in that direction.
    if (ZOOM_STEPS[index] !== current && direction < 0) {
      index = Math.max(0, index - 1);
    } else {
      index = Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction));
    }
    setZoom(ZOOM_STEPS[index]);
  }

  /** @param {number} percent */
  function setZoom(percent) {
    setPref("zoomPercent", percent);
    applyZoom();
  }

  /**
   * Apply the saved zoom to the page. A new document can arrive in a new
   * browsing context, which starts at 100%, so this runs after every load.
   */
  function applyZoom() {
    let percent = Number(getPref("zoomPercent")) || 100;
    try {
      browser.browsingContext.fullZoom = percent / 100;
    } catch (e) {
      try {
        browser.fullZoom = percent / 100;
      } catch (e2) {
        Zotero.debug(`[Side Browser] Could not set the zoom: ${e2}`);
      }
    }
    for (let [action, label] of [["zoomin", "Zoom in"], ["zoomout", "Zoom out"]]) {
      let button = root.querySelector(`button[data-action="${action}"]`);
      if (button) {
        button.title = `${label} (now ${percent}%)`;
        button.disabled = action === "zoomin"
          ? percent >= ZOOM_STEPS[ZOOM_STEPS.length - 1]
          : percent <= ZOOM_STEPS[0];
      }
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

  // ------------------------------------------------------------ check boxes

  function bindOptions() {
    for (let kind of KINDS) {
      on(ui[kind], "change", () => {
        pane.options[kind] = ui[kind].checked;
        saveOption(kind, ui[kind].checked);
        if (TEXT_KINDS.includes(kind) || kind === "annotations") {
          pane.textInserted = false;
        }
        render();
        syncPackage();
      });
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
    applyZoom();
    applyAdapter().then(() => {
      syncPackage();
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
    let actor = getActor() || (await waitForActor());
    if (!actor) {
      return;
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
   * The actor only exists once the page has a window global. Poll until one
   * appears, then tell it which package is waiting.
   */
  function startActorWatch() {
    let pushed = false;
    actorWatch = win.setInterval(() => {
      let actor = getActor();
      if (!actor) {
        pushed = false;
        return;
      }
      if (!pushed) {
        pushed = true;
        syncPackage();
      }
    }, 700);
  }

  // ---------------------------------------------------------------- package

  /** What the five check boxes can act on, given the current tab. */
  function available(kind) {
    if (kind === "selection") {
      return !!pane.selection?.text;
    }
    return pane.scope.items.length > 0;
  }

  /** The kinds that are checked and have something to send. */
  function activeKinds() {
    return KINDS.filter((kind) => pane.options[kind] && available(kind));
  }

  /**
   * A short name for the package, so the page can tell a new package from one it
   * already sent. Empty means there is nothing to send.
   */
  function packageKey() {
    let kinds = activeKinds();
    if (pane.textInserted) {
      kinds = kinds.filter((kind) => !TEXT_KINDS.includes(kind));
    }
    if (!kinds.length) {
      return "";
    }
    let ids = pane.scope.items.map((item) => item.id).join(",");
    let selection = pane.selection?.text ? `${pane.selection.text.length}:${pane.selection.text.slice(0, 24)}` : "";
    return `${ids}|${kinds.join("+")}|${selection}`;
  }

  function packageInput() {
    let attachment = pane.selection?.readerItemID ? Zotero.Items.get(pane.selection.readerItemID) : null;
    return {
      items: pane.scope.items,
      selection: pane.selection,
      attachmentItem: attachment,
      options: Object.fromEntries(KINDS.map((kind) => [kind, !!pane.options[kind] && available(kind)])),
    };
  }

  async function syncPackage() {
    let actor = getActor();
    if (!actor) {
      return false;
    }
    try {
      await actor.sendQuery("set-package", { key: packageKey() });
      return true;
    } catch (e) {
      Zotero.debug(`[Side Browser] Could not tell the page about the files: ${e}`);
      return false;
    }
  }

  /** Tell the user what happened to a message the page sent with files. */
  function reportSent(report) {
    let lines = [];
    if (report.attached?.length) {
      lines.push(`Sent with ${report.attached.length} file${report.attached.length === 1 ? "" : "s"}: ${report.attached.join(", ")}`);
    } else if (report.sent) {
      lines.push("Message sent. No files went with it.");
    }
    for (let miss of report.errors || []) {
      lines.push(`Could not attach ${miss.name}: ${miss.error}`);
    }
    for (let miss of report.skipped || []) {
      lines.push(`Skipped ${truncate(miss.title || "", 40)}: ${miss.reason}`);
    }
    if (report.error) {
      lines.push(report.error);
    }
    if (!report.sent) {
      lines.push("The page may not have sent the message. Check it.");
    }
    notify(lines.join("\n"), { error: !report.sent || !!report.errors?.length || !!report.error });
  }

  // ---------------------------------------------------------------- Zotero

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
    let before = pane.scope.items.map((item) => item.id).join(",");
    pane.scope = await buildScope({ doc });
    if (pane.scope.items.map((item) => item.id).join(",") !== before) {
      pane.textInserted = false;
    }
    render();
    syncPackage();
    return pane.scope;
  }

  // ---------------------------------------------------------------- drawing

  function render() {
    if (!root.isConnected) {
      return;
    }
    let items = pane.scope.items;
    let hasItems = items.length > 0;
    let hasSelection = !!pane.selection?.text;

    ui.hint.hidden = hasItems || hasSelection;

    for (let kind of KINDS) {
      let label = root.querySelector(`[data-kind="${kind}"]`);
      if (label) {
        label.hidden = !available(kind);
      }
      ui[kind].checked = !!pane.options[kind];
    }

    let metadataLabel = root.querySelector('[data-role="metadataLabel"]');
    if (metadataLabel) {
      metadataLabel.textContent = items.length > 1 ? `Paper metadata (${items.length} papers)` : "Paper metadata";
    }
    let selectionLabel = root.querySelector('[data-role="selectionLabel"]');
    if (selectionLabel) {
      selectionLabel.textContent = hasSelection
        ? `Selected text: "${truncate(pane.selection.text.replace(/\s+/g, " "), 34)}"`
        : "Selected text";
    }

    let anyFile = activeKinds().length > 0;
    let anyText = activeKinds().some((kind) => TEXT_KINDS.includes(kind) || kind === "annotations");
    setDisabled("attach", !anyFile);
    setDisabled("insert", !anyText);
    setDisabled("copy", !anyText);
  }

  function setDisabled(action, disabled) {
    let button = root.querySelector(`button[data-action="${action}"]`);
    if (button) {
      button.disabled = disabled;
    }
  }

  // ---------------------------------------------------------------- actions

  function bindActions() {
    on(root.querySelector(".sb-actions"), "click", (event) => {
      let button = event.target.closest("button[data-action]");
      if (!button || button.disabled) {
        return;
      }
      let action = button.dataset.action;
      if (action === "attach") {
        onAttach();
      } else if (action === "insert") {
        onInsert();
      } else if (action === "copy") {
        onCopy();
      }
    });
  }

  /** Attach the checked files to the page now, and keep them from going twice. */
  async function onAttach() {
    if (!activeKinds().length) {
      notify("Check at least one option to attach.", { error: true });
      return;
    }
    setDisabled("attach", true);
    try {
      let built = await buildPackage(packageInput());
      let actor = await waitForActor();
      if (!actor) {
        notify("The page is not ready yet. Wait for it to load.", { error: true });
        return;
      }
      let lines = [];
      if (built.files.length) {
        let result = await actor.sendQuery("attach", { files: built.files, key: packageKey() });
        if (result?.attached?.length) {
          lines.push(`Attached: ${result.attached.join(", ")}`);
        }
        for (let miss of result?.attachErrors || []) {
          lines.push(`Could not attach ${miss.name}: ${miss.error}`);
        }
      }
      for (let miss of built.skipped) {
        lines.push(`Skipped ${truncate(miss.title || "", 40)}: ${miss.reason}`);
      }
      if (!lines.length) {
        lines.push("There was nothing to attach.");
      }
      notify(lines.join("\n"), { error: !built.files.length || lines.length > 1 });
    } catch (e) {
      notify(String(e.message || e), { error: true });
    } finally {
      render();
    }
  }

  /** Put the checked text in the page message box, so the user can edit it. */
  async function onInsert() {
    try {
      let text = await contextText(packageInput());
      if (!text) {
        notify("The checked options have no text to insert.", { error: true });
        return;
      }
      let actor = await waitForActor();
      if (!actor) {
        await copy(text);
        notify("The page is not ready. The text is on the clipboard.", { error: true });
        return;
      }
      let result = await actor.sendQuery("insert", { text });
      if (result?.ok) {
        // The text is in the box now, so its files must not go out as well.
        pane.textInserted = true;
        syncPackage();
        notify("Context placed in the message box. Edit it, then send.");
      } else {
        await copy(text);
        notify("No message box found on the page. The text is on the clipboard.", { error: true });
      }
    } catch (e) {
      notify(String(e.message || e), { error: true });
    }
  }

  async function onCopy() {
    try {
      let text = await contextText(packageInput());
      if (!text) {
        notify("The checked options have no text to copy.", { error: true });
        return;
      }
      await copy(text);
      notify("Context copied to the clipboard.");
    } catch (e) {
      notify(String(e.message || e), { error: true });
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
   * Send text and optional files directly. The console API and the self test use
   * this. The normal path is a send from the page, which the page script takes
   * over.
   */
  async function ask(text, { files = [], send = true } = {}) {
    let actor = await waitForActor();
    if (!actor) {
      throw new Error("The AI page is not ready");
    }
    return actor.sendQuery("compose", { text, files, send });
  }

  function on(target, type, handler, capture = false) {
    if (!target) {
      return;
    }
    target.addEventListener(type, handler, capture);
    listeners.push({ target, type, handler, capture });
  }

  return api;
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
 * The pane in a window, preferring one that is on screen, which is the pane of
 * the selected tab.
 *
 * @param {Window} win
 */
export function paneForWindow(win) {
  if (!win?.document) {
    return null;
  }
  let candidates = Array.from(panes.values()).filter(
    (pane) => pane.doc === win.document && pane.root.isConnected,
  );
  if (!candidates.length) {
    return null;
  }
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
  // The section may be hidden in this tab, so ask Zotero to rebuild and retry.
  try {
    Zotero.Notifier.trigger("refresh", "itempane", [PANE_ID]);
  } catch (e) {
    Zotero.debug(`[Side Browser] ${e}`);
  }
  let details = win?.document?.getElementById("zotero-item-details");
  if (!details || !sectionKey) {
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
  pane.options.selection = true;
  saveOption("selection", true);
  pane.textInserted = false;
  api.refreshScope().then(() => api.reveal());
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
    options: describeOptions(pane.options),
    selection: pane.selection?.text?.slice(0, 80) || null,
  }));
}

export function truncate(text, max) {
  let value = String(text || "");
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max - 1) + "\u2026";
}

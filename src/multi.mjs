/*
 * The AI pane when no single item is selected.
 *
 * With several items selected, or none, Zotero switches the item pane to its
 * message view ("3 items selected") and hides every custom section, so the
 * section from `section.mjs` cannot show. This module adds its own icon to the
 * sidenav in that view. A click shows the same pane in place of the message,
 * with the selected papers as the context.
 *
 * The pane lives in an extra child of the item pane deck. Zotero picks the deck
 * page itself when the view changes, so a MutationObserver puts the pane back
 * in front when the view returns to the message page and the user left it on.
 */

import { mountPane, unmountPane } from "./section.mjs";

const HTML = "http://www.w3.org/1999/xhtml";
const BUTTON_ID = "sidebrowser-multi-button";
const PANEL_ID = "sidebrowser-multi";
const LABEL = "AI sidebar";

/**
 * Item pane views that replace the item details, with the deck page Zotero
 * shows for each. Several selected items give the batch edit prompt. No
 * selection gives the message page.
 */
const OWN_VIEWS = { "message": 0, "batch-edit-prompt": 5 };

/** @type {Map<Window, object>} One state object per main window. */
const states = new Map();

/**
 * Add the icon and the hidden panel to a window. Safe to call twice.
 *
 * @param {Window} win
 * @param {string} rootURI
 */
export function install(win, rootURI) {
  if (!win?.document || states.has(win)) {
    return;
  }
  let doc = win.document;
  let itemPane = doc.getElementById("zotero-item-pane");
  let deck = doc.getElementById("zotero-item-pane-content");
  let sidenav = doc.getElementById("zotero-view-item-sidenav");
  if (!itemPane || !deck || !sidenav) {
    return;
  }

  let state = {
    win,
    doc,
    rootURI,
    itemPane,
    deck,
    sidenav,
    wanted: false,
    panel: null,
    body: null,
    wrapper: null,
    observers: [],
  };
  states.set(win, state);

  state.wrapper = buildButton(state);
  attachButton(state);

  // Zotero resets the view type attribute on the item pane when the selection
  // changes. Follow it.
  let viewObserver = new win.MutationObserver(() => sync(state));
  viewObserver.observe(itemPane, { attributes: true, attributeFilter: ["view-type"] });
  state.observers.push(viewObserver);

  // The sidenav empties itself when it reconnects, which drops the button.
  let navObserver = new win.MutationObserver(() => {
    if (!state.wrapper.isConnected) {
      attachButton(state);
      sync(state);
    }
  });
  navObserver.observe(sidenav, { childList: true });
  state.observers.push(navObserver);

  sync(state);
}

/** Remove the icon and the panel from one window. */
export function remove(win) {
  let state = states.get(win);
  if (!state) {
    return;
  }
  states.delete(win);
  for (let observer of state.observers) {
    observer.disconnect();
  }
  if (state.body) {
    unmountPane(state.body);
  }
  state.wrapper?.remove();
  state.panel?.remove();
  try {
    if (state.deck.selectedPanel === state.panel) {
      state.deck.selectedIndex = 0;
    }
  } catch (e) {
    // The deck is already gone with its window.
  }
}

export function removeAll() {
  for (let win of Array.from(states.keys())) {
    remove(win);
  }
}

/**
 * Show the pane in this window if the item pane shows a message or prompt.
 *
 * @param {Window} win
 * @returns {boolean} True when the multi-item pane handled the request.
 */
export function activate(win) {
  let state = states.get(win);
  if (!state || !isMessageView(state)) {
    return false;
  }
  state.wanted = true;
  sync(state);
  return true;
}

function viewType(state) {
  return state.itemPane.getAttribute("view-type");
}

function isMessageView(state) {
  return viewType(state) in OWN_VIEWS;
}

function buildButton(state) {
  let { doc, rootURI } = state;
  let wrapper = doc.createElementNS(HTML, "div");
  wrapper.id = BUTTON_ID;
  wrapper.className = "pin-wrapper";
  wrapper.hidden = true;

  let button = doc.createElementNS(HTML, "div");
  button.className = "btn";
  button.setAttribute("custom", "true");
  button.setAttribute("role", "tab");
  button.setAttribute("tabindex", "0");
  button.setAttribute("title", LABEL);
  button.setAttribute("aria-label", LABEL);
  let icon = `url('${rootURI}content/icons/sidebar.svg')`;
  button.style.setProperty("--custom-sidenav-icon-light", icon);
  button.style.setProperty("--custom-sidenav-icon-dark", icon);
  wrapper.appendChild(button);

  button.addEventListener("click", (event) => {
    if (event.button === 0) {
      toggle(state);
    }
  });
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle(state);
    }
  });
  return wrapper;
}

/** Put the button after the group of section buttons. */
function attachButton(state) {
  let group = state.sidenav.querySelector(".inherit-flex");
  if (group) {
    group.after(state.wrapper);
  }
}

function toggle(state) {
  state.wanted = !state.wanted;
  sync(state);
}

/** Build the panel the first time it is needed, so no browser starts early. */
function ensurePanel(state) {
  if (state.panel) {
    return;
  }
  let { doc } = state;
  let panel = doc.createXULElement("vbox");
  panel.id = PANEL_ID;
  panel.setAttribute("flex", "1");
  panel.style.minWidth = "0";
  panel.style.minHeight = "0";
  panel.style.overflow = "auto";

  let body = doc.createElementNS(HTML, "div");
  body.className = "sb-multi-body";
  body.style.cssText = "display:flex;flex-direction:column;flex:1 1 auto;min-height:0;padding:6px 8px;";
  panel.appendChild(body);
  state.deck.appendChild(panel);

  state.panel = panel;
  state.body = body;
  mountPane(doc, body);
}

/**
 * Bring button and panel in line with the item pane view.
 *
 * The button shows only when the item details are replaced. In the item view the registered
 * section has its own icon, so a second one would only confuse.
 *
 * @param {object} state
 */
function sync(state) {
  let message = isMessageView(state);
  state.wrapper.hidden = !message;
  let button = state.wrapper.querySelector(".btn");
  let show = message && state.wanted;
  button.classList.toggle("sb-active", show);
  button.style.backgroundColor = show ? "var(--fill-quinary)" : "";
  button.setAttribute("aria-selected", show ? "true" : "false");

  if (show) {
    ensurePanel(state);
    let index = Array.from(state.deck.children).indexOf(state.panel);
    if (state.deck.selectedIndex !== index) {
      state.deck.selectedIndex = index;
    }
    return;
  }
  if (state.panel && state.deck.selectedPanel === state.panel) {
    // Back to the message page that Zotero wants for this view.
    state.deck.selectedIndex = message ? OWN_VIEWS[viewType(state)] : 1;
  }
}

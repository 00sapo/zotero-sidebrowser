/*
 * Which papers are the context.
 *
 * `buildScope` reads the current Zotero tab and decides which items the pane
 * works on. The options that say what to send for them live here too.
 *
 * Nothing here touches the page DOM.
 */

import { getPref, setPref } from "./prefs.mjs";
import { KINDS } from "./package.mjs";

/** Defaults for a pane that has no saved choice. */
const KIND_DEFAULTS = {
  metadata: true,
  selection: true,
  annotations: false,
  pdf: false,
  others: false,
};

/**
 * The check box state a fresh pane starts with. Each choice is saved in a
 * preference, so a new tab or a restart keeps what the user picked.
 *
 * @returns {object}
 */
export function loadOptions() {
  let options = {};
  for (let kind of KINDS) {
    let saved = getPref(`send.${kind}`);
    options[kind] = typeof saved === "boolean" ? saved : KIND_DEFAULTS[kind];
  }
  return options;
}

export function saveOption(kind, value) {
  setPref(`send.${kind}`, !!value);
}

/**
 * Decide the context for the tab the pane belongs to.
 *
 * Reader tab: the paper open in the reader.
 * Library tab: the selected papers. With nothing selected there is no context.
 *
 * @param {object} params
 * @param {Document} params.doc - The main window document.
 * @returns {Promise<{mode: string, items: Zotero.Item[]}>}
 */
export async function buildScope({ doc }) {
  let win = doc.defaultView;
  let empty = { mode: "none", items: [] };

  let tabs = win?.Zotero_Tabs;
  if (!tabs) {
    return empty;
  }

  if (tabs.selectedType === "reader") {
    let reader = Zotero.Reader.getByTabID(tabs.selectedID);
    let item = reader ? Zotero.Items.get(reader.itemID) : null;
    return item ? { mode: "reader", items: [item] } : empty;
  }

  if (tabs.selectedType !== "library") {
    return empty;
  }

  let selected = [];
  try {
    let pane = win.ZoteroPane;
    selected = pane?.itemsView?.getSelectedObjects?.() || pane?.getSelectedItems?.() || [];
  } catch (e) {
    selected = [];
  }
  let max = Number(getPref("maxItems")) || 30;
  selected = selected.filter((item) => item.isRegularItem() || item.isAttachment()).slice(0, max);
  return selected.length ? { mode: "selection", items: selected } : empty;
}

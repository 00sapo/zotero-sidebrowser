/*
 * Which paper is the context, and what text goes with it.
 *
 * Two things live here. `buildScope` reads the current Zotero tab and decides
 * which items the pane should offer. `compose` turns the chosen items and a
 * text selection into the block that goes to the AI page.
 *
 * Nothing here touches the page DOM, so the code is easy to test from the
 * error console with `Zotero.SideBrowser.context`.
 */

import { describeItems, describeSelection } from "./context.mjs";
import { getPref } from "./prefs.mjs";

/**
 * The option state a fresh pane starts with. Every context option starts on;
 * the pane hides the ones that do not apply to the current tab.
 *
 * `touched` records the options the user changed by hand, so the automatic
 * choices stop overriding that choice.
 *
 * @returns {object}
 */
export function defaultOptions() {
  return {
    includeItem: true,
    includeList: true,
    includeSelected: true,
    attachPDF: false,
    includePDFText: true,
    touched: {},
  };
}

/**
 * Decide the context for the tab the pane belongs to.
 *
 * Reader tab: the paper open in the reader.
 * Library tab: the selected items, or every item in the list, up to the limit.
 *
 * @param {object} params
 * @param {Document} params.doc - The main window document.
 * @param {object} [params.browser] - The pane browser, unused today.
 * @returns {Promise<{mode: string, items: Zotero.Item[], listedCount: number, selectedCount: number}>}
 */
export async function buildScope({ doc }) {
  let win = doc.defaultView;
  let empty = { mode: "none", items: [], listedCount: 0, selectedCount: 0 };

  let tabs = win?.Zotero_Tabs;
  if (!tabs) {
    return empty;
  }

  if (tabs.selectedType === "reader") {
    let reader = Zotero.Reader.getByTabID(tabs.selectedID);
    let item = reader ? Zotero.Items.get(reader.itemID) : null;
    if (!item) {
      return empty;
    }
    return { mode: "reader", items: [item], listedCount: 1, selectedCount: 1 };
  }

  if (tabs.selectedType !== "library") {
    return empty;
  }

  let pane = win.ZoteroPane;
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
    return { mode: "selection", items: selected, listedCount: listed.length, selectedCount: selected.length };
  }
  if (listed.length) {
    return { mode: "list", items: listed, listedCount: listed.length, selectedCount: 0 };
  }
  return empty;
}

/**
 * Build the message text.
 *
 * The context block comes first and the reader's own words come last, so a
 * question reads as a question about the material above it.
 *
 * @param {object} params
 * @param {Zotero.Item[]} [params.items] - Papers whose metadata to include.
 * @param {object|null} [params.selection] - A captured reader selection.
 * @param {boolean} [params.includeSelection] - Whether to send that selection.
 * @param {Zotero.Item|null} [params.attachmentItem] - Item that owns the PDF.
 * @param {string} [params.userText] - Text typed in the pane, or empty.
 * @returns {string}
 */
export function compose({
  items = [],
  selection = null,
  includeSelection = false,
  attachmentItem = null,
  userText = "",
} = {}) {
  let parts = [];

  if (items.length) {
    parts.push(describeItems(items));
  }
  if (includeSelection && selection?.text) {
    parts.push(describeSelection(selection, attachmentItem));
  }
  let text = String(userText || "").trim();
  if (text) {
    parts.push(text);
  }
  return parts.join("\n\n");
}

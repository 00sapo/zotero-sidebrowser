/*
 * Preference access for the plugin.
 *
 * `Zotero.Prefs` adds the `extensions.zotero.` branch itself, so callers pass
 * keys such as `sidebrowser.provider`.
 */

export const DEFAULTS = {
  open: true,
  provider: "chatgpt",
  customURL: "",
  lastURL: "",
  // Height in pixels that the user dragged the pane to. 0 means: fill the
  // visible height of the item pane and follow the window.
  paneHeight: 0,
  // Zoom of the page in percent. 100 is the normal size.
  zoomPercent: 100,
  maxItems: 30,
  customProviders: "[]",
};

export function getPref(key) {
  try {
    let value = Zotero.Prefs.get(`sidebrowser.${key}`);
    return value === undefined ? DEFAULTS[key] : value;
  } catch (e) {
    return DEFAULTS[key];
  }
}

export function setPref(key, value) {
  try {
    Zotero.Prefs.set(`sidebrowser.${key}`, value);
  } catch (e) {
    Zotero.logError(e);
  }
}

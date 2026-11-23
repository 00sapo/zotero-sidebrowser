/*
 * Preference access for the plugin.
 *
 * `Zotero.Prefs` adds the `extensions.zotero.` branch itself, so callers pass
 * keys such as `sidebrowser.width`.
 */

export const DEFAULTS = {
  width: 460,
  open: false,
  provider: "chatgpt",
  customURL: "",
  includePDF: true,
  autoSend: false,
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

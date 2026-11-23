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
  autoContext: true,
  showComposer: false,
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

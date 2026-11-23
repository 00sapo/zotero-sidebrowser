/*
 * URI registration.
 *
 * A plugin cannot ship a chrome.manifest, so register a `resource://` alias for
 * the XPI root by hand. Actors must be loaded as ES modules from a real URI,
 * and relative imports inside those modules resolve against it.
 */

export const RESOURCE_NAME = "sidebrowser-x";

/**
 * Point `resource://sidebrowser/` at the plugin root.
 *
 * @param {string} pluginRootURI - The `rootURI` bootstrap receives.
 */
export function registerResourceSubstitution(pluginRootURI) {
  if (!pluginRootURI) {
    throw new Error("Missing plugin root URI");
  }
  let handler = Services.io
    .getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler);
  handler.setSubstitution(
    RESOURCE_NAME,
    Services.io.newURI(pluginRootURI),
  );
}

export function unregisterResourceSubstitution() {
  try {
    let handler = Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler);
    handler.setSubstitution(RESOURCE_NAME, null);
  } catch (e) {
    Zotero.debug(`[Side Browser] Could not remove resource alias: ${e}`);
  }
}

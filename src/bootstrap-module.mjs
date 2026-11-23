/*
 * Bridge between the classic bootstrap scope and the ES module code.
 *
 * `loadSubScript` runs this file in the plugin sandbox, inside a plain script
 * scope where a bare `import()` fails with "No ScriptLoader found". This file
 * therefore registers the `resource://` alias with plain privileged APIs first,
 * then loads the real core module through `ChromeUtils.importESModule`, which
 * does work and caches by URI.
 *
 * The core module is published on `Zotero` so the bootstrap can reach it.
 */

const RESOURCE_NAME = "sidebrowser-x";

{
  let handler = Services.io
    .getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler);
  handler.setSubstitution(RESOURCE_NAME, Services.io.newURI(rootURI));
}

Zotero.SideBrowserCore = ChromeUtils.importESModule(
  `resource://${RESOURCE_NAME}/src/core.mjs`,
);

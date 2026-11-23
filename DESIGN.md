# Design and measured constraints

Notes taken while building the plugin. Every claim below was checked against the
installed Zotero 10.0.8 (Gecko 140) or against a probe plugin run under Xvfb.

## Environment

- Zotero 10.0.8, Gecko 140.17.0, Fission on (`fission.autostart` true).

## Loading a plugin

- The XPI must carry `applications.zotero.update_url`. Without it, Zotero writes
  a UUID for the add-on and then drops it: the add-on never appears in
  `extensions.json` and no bootstrap method is called. An empty string fails the
  same way.
- `strict_min_version` must be `6.999` or lower for this build. `7.0` and
  `11.*` are rejected, `10.*` is accepted for the maximum.
- The file name in `profile/extensions/` must match the manifest ID exactly.
- A `locale/<lang>/` directory with no `.ftl` file inside makes Zotero reject the
  whole plugin. Ship at least one real file, or no locale directory at all.
- Unpacked extension directories were not scanned in testing. An XPI in
  `profile/extensions/` works.

## Running ES modules from a plugin

- A bare `import()` in the bootstrap sandbox fails with "No ScriptLoader found
  for the current context".
- `ChromeUtils.importESModule` works, caches per URI, and resolves relative
  specifiers inside the loaded modules. That is the only supported path.
- Modules see `Zotero`, `Services`, `ChromeUtils`, `Components`, `IOUtils`, and
  `PathUtils`, but not the sandbox's own variables.
- ES modules do not inherit the `Cc` and `Ci` shortcuts. Derive them from
  `Components`.
- `Zotero_Tabs`, `ZoteroPane`, and `ZoteroContextPane` live on the main window,
  not on the module global. Reach them through `window`.

## Window actors

- A plugin can call `ChromeUtils.registerWindowActor` and it works.
- The actor's `esModuleURI` must be a working URI. Point it at the same
  `resource://` alias the rest of the plugin uses, and include the full path
  under the plugin root (`src/actors/...`, not `actors/...`).
- Registering the actor before the `resource://` substitution exists does not
  fail at registration time; it fails later, when the actor is created, with
  "Failed to load resource://...". Register the alias first.
- From the parent side, `actor.sendAsyncMessage()` returns undefined, not a
  promise. Use `actor.sendQuery()` when a result is needed.

## Chrome cannot touch the page

- Setting `remote="false"` on a `<browser>` is ignored under Fission: the content
  still gets a `webIsolated` process, and `contentDocument` is null from chrome.
- All page work therefore goes through a window actor.
- Inside `JSWindowActorChild` there is no `setTimeout`, `btoa`, `File`,
  `DataTransfer`, `Event`, or `InputEvent` in scope. Take them from
  `this.contentWindow`.
- A cached `contentWindow` can point at the previous document after a
  navigation. Read `this.browsingContext.window` when freshness matters.

## Page interaction

- `chatgpt.com`, `claude.ai`, `chat.deepseek.com`, and `chat.mistral.ai` all load
  in a `<browser>` without stripping `X-Frame-Options` or CSP
  `frame-ancestors`. No HTTP observer is needed.
- Text insertion needs the framework's own path: the native value setter plus an
  input event for a textarea, and `execCommand("insertText")` for a rich text
  box. Assigning `textContent` alone is ignored by React and ProseMirror.
- A file can be attached by building a `DataTransfer`, adding a `File`, and
  assigning `input.files`. This is what makes sending the real PDF possible.
- File inputs are almost always hidden, so they must not be filtered for
  visibility when looking them up. Filter on `accept` instead.
- A signed-out ChatGPT page offers only image file inputs, so a PDF cannot be
  attached there. Mistral exposes no file input at all on the free chat page.

## Layout

- `Zotero.ItemPaneManager.registerSection` adds a section to the right column and
  an icon to the strip. The section body is a plain `div` that the plugin fills.
- Zotero namespaces the pane ID with the plugin ID, so the registered ID differs
  from the one passed in. Use the value that `registerSection` returns.
- Moving a `<browser>` to another parent creates a new browsing context and the
  page returns to `about:blank`. Tested with a sibling, a nested holder, and an
  item pane section. A pane that Zotero rebuilds therefore needs a new browser.
- The section header text and the strip tooltip come from a Fluent file named
  `locale/<lang>/<name>-mainWindow.ftl`. If the locale did not load, the header is
  empty, so the plugin writes the text by hand after a short delay.
- Modules have no `setInterval`. Take timers from the window.

## Menus and preferences

- `Zotero.MenuManager.registerMenu` only fills a popup that Zotero rebuilds on
  open. The View menu is not one of those, so a registered entry never appears.
  Insert a plain `menuitem` into `#menu_viewPopup` instead, and remove it on
  shutdown.
- `Zotero.PreferencePanes.register` works and removes the pane automatically when
  the plugin is disabled.
- `Zotero.Prefs` adds the `extensions.zotero.` branch itself. A `prefs.js` in the
  plugin must spell the full key (`extensions.zotero.sidebrowser.width`), while
  `Zotero.Prefs.get("sidebrowser.width")` adds the branch.

## Reader

- Reader tabs are tabs in the main window, so one panel serves both library and
  reader tabs.
- `Zotero.Reader.getByTabID(id)` returns the instance, with `_iframeWindow` and
  `_internalReader`.
- `Zotero.Reader.registerEventListener("renderTextSelectionPopup", ...)` runs in
  the reader frame and can append a button. `params.annotation` carries the
  selected text, the page label, and the page index.

## Lifecycle

- `onMainWindowLoad` does not fire for the first window when the plugin starts
  after that window loaded. Enumerate `Services.wm` in `startup` as well.

## Decisions from the user

- The pane is an item pane section, like Zotero Skimming. No custom column.
- The context is added when the message is sent from the page. The PDF is attached
  by a button, not during the send.
- Per-site selectors in the page, driven by a window actor.
- The real PDF file is attached, not extracted text.
- Default providers: ChatGPT, Claude, DeepSeek, Mistral, plus a custom URL.

## Verified end to end

The self test (`Zotero.SideBrowser.selfTest()`) seeds one paper with a real PDF,
then checks 32 things, including:

- the panel toggles, docks, has a real size, and does not overlap the tab stack;
- the sample paper is selected and becomes the context;
- the PDF is found, read, and its bytes are non-trivial;
- the prompt is composed from metadata plus the selection;
- a local mock page receives the composed text and a real PDF through its own
  file input;
- the reader opens the PDF, text is selected, and the selection reaches the
  composed prompt.

The same run also reports, per provider, the final URL, whether a composer was
found, and which file inputs the page accepts.

## Send intercept

- The actor listens for `click` and `keydown` in the capture phase of the page.
  A listener in the system group runs after the page's own handlers, so the site
  has already read and cleared the message box. Use the plain capture phase.
- In the actor, use `this._log`, which forwards to the parent. `Zotero` and `dump`
  give no output there.

## Many items selected

- With several items selected the item pane `view-type` is `batch-edit-prompt`.
  With none it is `message`. The sidenav then shows only the default panes, so a
  registered section has no icon.
- The plugin adds its own button next to the section buttons, outside the button
  group that Zotero reorders, and one extra page to the item pane deck.
- Zotero selects the deck page itself on a view change. A `MutationObserver` on
  the `view-type` attribute puts the plugin page back in front.
- The sidenav empties itself on reconnect, so another observer adds the button
  again.

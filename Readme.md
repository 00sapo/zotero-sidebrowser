# Side Browser

A web browser in Zotero's right sidebar. Open ChatGPT, Claude, DeepSeek, Mistral,
or any other chat page next to your library, and send paper context to it with
one click.

## What it does

- Shows a browser in a resizable column on the right edge of Zotero. The column
  is visible in library tabs and in reader tabs, so the same session follows you.
- Keeps session cookies. Log in once and the session survives restarts, because
  the side browser uses the normal Zotero profile.
- Keeps links inside the sidebar. Shift-click, `target="_blank"`, and links to
  other sites open in your system browser instead.
- Offers context options that follow the tab you are in.

## Context options

Next to a paper in the reader, the composer offers:

- Include this paper: sends the title, authors, date, venue, DOI, and abstract.
- Attach the PDF file: hands the real PDF to the chat page through its own file
  input.
- Include the selected text: when you select text in the PDF, the selection is
  shown and sent, with room for your own question or comment below it.

In a library tab with a paper selected, the composer offers the same options for
the selected papers. With several papers selected, the selection wins. With
nothing selected, every paper in the current list becomes the context, capped by
the paper limit in the preferences.

## Install

1. Build the XPI: `scripts/build.sh`. Add `--with-tests` to keep the self-test
   modules.
2. In Zotero, open Tools, then Plugins, then the gear menu, and choose Install
   Plugin From File.
3. Pick `dist/sidebrowser.xpi`.

Zotero accepts the plugin without signature only when
`xpinstall.signatures.required` is `false`, which is the default in Zotero's own
build. A distributed copy would need signing.

## Use

- Toggle the sidebar from View, then Side Browser, or from the pencil button in
  the sidebar toolbar.
- Choose the AI service from the list in the sidebar toolbar. The pencil button
  shows or hides the message composer.
- Type a question and press Send, or press Ctrl+Enter in the message box.
- Copy puts the whole prompt, context included, on the clipboard.

## How sending works

The plugin does not call a model API. It types into the chat page you chose, and
the site's own session and limits apply.

Text insertion uses the native value setter plus an input event for a textarea,
and `execCommand("insertText")` for a rich text box, because React and ProseMirror
pages ignore a plain `textContent` change. Files are attached by building a
`DataTransfer` and assigning it to the page's `input[type=file]`.

If a site changes its markup, the composer finds no message box, and the plugin
copies the prompt to the clipboard instead of failing silently. Selectors live in
`src/providers/registry.mjs` and are easy to update.

## Known limits

- A signed-out ChatGPT page only accepts image attachments, so the PDF option is
  disabled there. Sign in first.
- Some sites change their composer markup and need a selector update.
- A PDF must exist as a local file. A linked file that is missing on disk is
  reported in the status line instead of being attached.
- The sidebar width competes with the collections pane, the item list, and the
  item pane. On a narrow window it is capped so the other panes stay usable.

## Preferences

Tools, then Settings, then Side Browser:

- Enable the sidebar.
- Default AI service, and a custom URL.
- Attach the PDF by default.
- Sidebar width and the maximum number of papers taken from a list.
- Extra providers as JSON, each with a `label` and a `url`, with optional
  `composerSelectors`, `sendSelectors`, `sendMode`, and `fileSelectors`.

## Releases and auto-update

Tag a commit as `v0.1.0` and push the tag. The workflow in
`.github/workflows/release.yml` checks that `manifest.json` matches the tag,
builds the XPI, writes `update.json` with the XPI hash, and publishes both to a
GitHub release. It also refreshes the rolling `release` release, which holds only
the newest `update.json`. Zotero polls the URL in the plugin manifest, so that
rolling release is what delivers updates.

To check the pieces by hand:

```sh
./scripts/build.sh
node scripts/update-manifest.mjs --tag v0.1.0 --repo 00sapo/zotero-sidebrowser --out dist/update.json
```

## Development

- `src/core.mjs` wires the plugin: resource alias, window actor, per-window
  sidebar, and the console API.
- `src/sidebar.mjs` builds and drives the panel.
- `src/actors/ai-child.mjs` is the only file that runs inside the chat page.
- `src/context.mjs` turns Zotero items into prompts and file lists.
- `src/providers/registry.mjs` holds the per-site selectors.
- `DESIGN.md` records the measured Zotero behaviour the code depends on.

`Zotero.SideBrowser` in the error console offers `open()`, `close()`, `toggle()`,
`ask(text)`, `reload()`, `describeContext()`, and `selfTest()`. The self test
seeds one sample paper, checks the context helpers, drives a local mock page
through a full send with a PDF attached, and opens the reader to check the
selection path.

# Side Browser

A web browser in Zotero's right sidebar. Open ChatGPT, Claude, DeepSeek, Mistral,
or any other chat page next to your library, and send paper context to it with
one click.

## What it does

- Adds an AI section to Zotero's right column, with an icon in the strip at the
  far right, next to the Info, Abstract, and Tags sections.
- Shows a chat page (ChatGPT, Claude, DeepSeek, Mistral, or a custom URL) in that
  section. Login cookies stay, because the browser uses the Zotero profile.
- Adds the paper context to your message when you send it from the chat page.
  There is no separate prompt box to fill.
- Keeps links inside the pane. Shift-click, `target="_blank"`, and links to other
  sites open in your system browser.

## Several papers selected

With several papers selected, or none, Zotero hides its item sections, so the
normal pane icon is gone. The plugin adds its own icon to the right strip in that
case. Click it and the pane replaces the batch edit message. The selected papers
are the context, or the papers in the list when nothing is selected. Click the
icon again to go back to the message.

## How the context works

The pane holds a context block: the title, authors, date, venue, DOI, and abstract
of the paper in the reader, the selected papers, or the papers in the list. When
you click the chat page's send button or press Enter, the plugin puts the block in
front of your text, then lets the site send it. The block goes out once for each
paper. Pick another paper and the next message carries the new block.

Controls under the page:

- Check boxes choose what the block holds. In the reader, "Include the selected
  text" adds the text you selected through the "Ask about this" button.
- Attach PDF hands the real PDF to the page's own file input. You click it before
  you send, because an upload takes a moment.
- Insert context puts the block in the page's message box, so you can read it.
- Copy puts the block on the clipboard.
- The pencil button in the toolbar shows a text box for notes that join the block.
  It is hidden by default. The preference "Show the message box in the pane" keeps
  it open.

Turn off "Add the paper context to every message" in the preferences to send
messages without the block.

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

- Open the pane from View, then AI sidebar, or click its icon in the right strip.
- Choose the AI service from the list in the pane toolbar.

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
- Each tab has its own pane and its own browser. Zotero rebuilds a pane when you
  change tabs, and a browser that moves loses its page. A new pane opens the last
  address you visited, which is usually your last chat.

## Preferences

Tools, then Settings, then Side Browser:

- Show the pane.
- Default AI service, and a custom URL.
- Add the paper context to every message, and show the message box.
- The maximum number of papers taken from a list.
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
- `src/section.mjs` registers the item pane section and drives each pane.
- `src/multi.mjs` adds the icon and the pane for the no-item and many-item views.
- `src/scope.mjs` decides which papers are the context and builds the block.
- `src/actors/ai-child.mjs` is the only file that runs inside the chat page.
- `src/context.mjs` turns Zotero items into prompts and file lists.
- `src/providers/registry.mjs` holds the per-site selectors.
- `DESIGN.md` records the measured Zotero behaviour the code depends on.

`Zotero.SideBrowser` in the error console offers `open()`, `reload()`, `panes()`,
`ask(text)`, and `selfTest()`. The self test
seeds one sample paper, checks the context helpers, drives a local mock page
through a full send with a PDF attached, and opens the reader to check the
selection path.

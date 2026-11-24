# Side Browser

Existing AI chatting addons for Zotero reequire an API key or a subscription. Not this.

With this addon, you can use any web chat, perfectly integrated with zotero items, metadata,
annotations, selections, and file attachments.

Open any chat page next to your library, and send paper context to it with
one click.

_*Why?*_

As of now, you don't really need to spend money to chat with your PDF and Zotero library. Stop
paying the Big Techs.

### Free services powered by climate-aware energy

- Euria
- Ecosia AI
- Mistral Le Chat

### Free services with privacy-respecting policies

- Lumo
- Euria
- Duck.ai
- Brave Leo
- Venice
- Ecosia AI

### Free services with opt-out from data re-use for training

- ChatGPT
- DeepSeek
- Mistral Le Chat
- Claude
- Gemini
- Perplexity

## Features

- No API key and no subscription. You use the free web chats that you already
  have an account for, and the site's own limits apply.
- A real pane in Zotero's right column, with its own icon in the strip next to
  Info, Abstract, and Tags. It follows the light and dark theme.
- Your papers go with your message. You type in the chat page as usual, and when
  you press send the plugin attaches the files you chose.
- Five choices of what to attach: paper metadata, the text you selected, your
  annotations, the PDF, and other attachments such as an EPUB.
- Real files, not pasted text. The chat sees the real PDF with its figures, and
  your message box stays clean.
- Works in the library and in the reader. Select text in a PDF, click "Ask about
  this", and the selection travels with your next message.
- Works on many papers at once. Select several, click the icon in the strip, and
  ask about all of them.
- Edit before you send. "Insert context to edit" puts the text in the message box,
  and "Copy context" puts it on the clipboard.
- Tall by default and resizable. The pane fills the window height, follows the
  window, and has a drag bar and zoom buttons.
- Remembers where you were. Your login stays, and a new tab reopens the last chat
  address you visited, which is usually your last conversation.
- Your choice of service: ChatGPT, Claude, DeepSeek, Mistral, or any chat page
  with a custom URL and your own selectors.
- Clear messages. What was attached, and what went wrong, shows as a Zotero
  notification instead of text hidden at the bottom of the pane.
- Private by design. Files go only to the chat page that you chose. The plugin
  has no server of its own.

## Install

1. Build the XPI: `scripts/build.sh`. Add `--with-tests` to keep the self-test
   modules.
2. In Zotero, open Tools, then Plugins, then the gear menu, and choose Install
   Plugin From File.
3. Pick `dist/sidebrowser.xpi`.

Zotero accepts the plugin without signature only when
`xpinstall.signatures.required` is `false`, which is the default in Zotero's own
build. A distributed copy would need signing.

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

### Releases and auto-update

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


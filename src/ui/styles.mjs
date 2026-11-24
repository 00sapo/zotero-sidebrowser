/*
 * Styles and markup for the AI pane.
 *
 * The pane lives inside Zotero's item pane, so it uses Zotero's own CSS
 * variables, which resolve in both light and dark mode, with neutral colors as a
 * fallback.
 */

export const PaneCSS = `
.sb-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  /* section.mjs sets the real height from the item pane scroll area, or from
     the height the user dragged to. This is the value before that runs. */
  height: max(640px, calc(100vh - 150px));
  font: message-box;
  color: var(--fill-primary, #000);
}

.sb-root .sb-toolbar {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 0 4px;
  flex: 0 0 auto;
}

.sb-root .sb-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 3px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.sb-root .sb-toolbar button:hover:not(:disabled) {
  background: var(--fill-quinary, rgba(0, 0, 0, 0.08));
}

.sb-root .sb-toolbar button:disabled {
  opacity: 0.4;
  cursor: default;
}

.sb-root .sb-picker {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.sb-root .sb-picker-button {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-width: 0;
  height: 22px;
  padding: 0 4px;
  border: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.2));
  border-radius: 4px;
  background: var(--material-background, #fff);
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.sb-root .sb-picker-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-root .sb-picker-badges {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 3px;
  opacity: 0.85;
}

.sb-root .sb-picker-mark {
  flex: 0 0 auto;
  margin-left: auto;
  opacity: 0.6;
  font-size: 10px;
}

.sb-root .sb-picker-list {
  position: absolute;
  z-index: 20;
  top: 24px;
  left: 0;
  right: 0;
  max-height: 260px;
  overflow: auto;
  padding: 3px;
  border: 1px solid var(--fill-tertiary, rgba(0, 0, 0, 0.25));
  border-radius: 5px;
  /* Opaque: Zotero's --material-menu is a translucent colour, and the page
     behind would show through the list. */
  background-color: var(--material-background, #fff);
  background-image: none;
  opacity: 1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
}

.sb-root .sb-picker-list[hidden] {
  display: none;
}

.sb-root .sb-picker-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 5px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.sb-root .sb-picker-row:hover,
.sb-root .sb-picker-row.sb-current {
  background: var(--fill-quinary, rgba(0, 0, 0, 0.08));
}

.sb-root .sb-picker-row .sb-picker-name {
  flex: 0 1 auto;
}

/* The marks. Every glyph draws with currentColor, so it follows the theme. */
.sb-root .sb-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.sb-root .sb-badge svg {
  width: 14px;
  height: 14px;
  display: block;
}

/* The marks are icons. The words are there for a screen reader, and the meaning
   is in the tooltip, so the service names keep their room. */
.sb-root .sb-badge-text {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.sb-root .sb-picker-row .sb-picker-badges {
  margin-left: auto;
}

/* The page gets all the space that is left, and keeps a usable height on a
   short window. */
.sb-root .sb-page {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 300px;
  border: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.15));
  border-radius: 5px;
  overflow: hidden;
  background: var(--material-background, #fff);
}

.sb-root .sb-browser {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  border: 0;
  display: block;
}

.sb-root .sb-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  text-align: center;
  font-size: 12px;
  line-height: 1.4;
  background: var(--material-background, #fff);
  color: var(--fill-secondary, rgba(0, 0, 0, 0.6));
}

.sb-root .sb-overlay[hidden] {
  display: none;
}

/* The handle under the page. Dragging it changes the height of the pane. */
.sb-root .sb-resizer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 10px;
  margin: 1px 0;
  cursor: row-resize;
  touch-action: none;
}

.sb-root .sb-resizer .sb-grip {
  width: 36px;
  height: 3px;
  border-radius: 2px;
  background: var(--fill-tertiary, rgba(0, 0, 0, 0.25));
}

.sb-root .sb-resizer:hover .sb-grip,
.sb-root .sb-resizer.sb-dragging .sb-grip {
  background: var(--accent-blue, #4072e5);
}

.sb-root .sb-send {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 1.4;
  color: var(--fill-secondary, rgba(0, 0, 0, 0.62));
}

.sb-root .sb-send .sb-send-title {
  font-weight: 600;
}

.sb-root .sb-send .sb-send-hint {
  font-style: italic;
}

.sb-root .sb-send label {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.sb-root .sb-send label[hidden],
.sb-root .sb-send .sb-send-hint[hidden] {
  display: none;
}

.sb-root .sb-send input[type="checkbox"] {
  margin: 0;
}

.sb-root .sb-send .sb-label-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-root .sb-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  padding-top: 6px;
  flex: 0 0 auto;
}

.sb-root .sb-actions button {
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.2));
  border-radius: 4px;
  background: var(--material-button, rgba(0, 0, 0, 0.04));
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.sb-root .sb-actions button[draggable="true"] {
  cursor: grab;
}

.sb-root .sb-editor {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 6px;
  flex: 0 0 auto;
}

.sb-root .sb-editor[hidden] {
  display: none;
}

.sb-root textarea.sb-context-text {
  width: 100%;
  box-sizing: border-box;
  min-height: 90px;
  max-height: 320px;
  resize: vertical;
  padding: 4px 5px;
  border: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.2));
  border-radius: 4px;
  background: var(--material-background, #fff);
  color: inherit;
  font: inherit;
  font-size: 11px;
  line-height: 1.45;
}

.sb-root .sb-editor-hint {
  font-size: 10px;
  font-style: italic;
  color: var(--fill-secondary, rgba(0, 0, 0, 0.62));
}

.sb-root .sb-actions button.sb-primary {
  background: var(--accent-blue, #4072e5);
  border-color: transparent;
  color: #fff;
}

.sb-root .sb-actions button:hover:not(:disabled) {
  filter: brightness(1.07);
}

.sb-root .sb-actions button:disabled {
  opacity: 0.45;
  filter: grayscale(1);
  cursor: default;
}

/* In the multi-item panel the pane fills the panel instead of using a fixed
   height. */
.sb-multi-body > .sb-root {
  height: 100%;
  min-height: 0;
}

/* A custom item pane section draws its body inside a collapsible section, and
   that body must not add its own scrollbar around the browser. */
item-pane-custom-section [data-type="body"] > .sb-root {
  overflow: hidden;
}
`;

/**
 * The pane skeleton.
 *
 * The wrapper in `section.mjs` declares the `html` namespace, so HTML tags carry
 * the `html:` prefix, while `<browser>` stays a XUL element. Only a XUL browser
 * can load remote content.
 */
export function paneMarkup() {
  let kinds = [
    ["metadata", "Paper metadata"],
    ["selection", "Selected text"],
    ["annotations", "Annotations"],
    ["pdf", "PDF file"],
    ["others", "Other attachments"],
  ];
  let checks = kinds.map(([kind, label]) => `
    <html:label data-kind="${kind}">
      <html:input type="checkbox" data-role="${kind}"/>
      <html:span class="sb-label-text" data-role="${kind}Label">${label}</html:span>
    </html:label>`).join("");

  return `
<html:div class="sb-toolbar">
  <html:button type="button" data-action="back" title="Back" aria-label="Back">&#8592;</html:button>
  <html:button type="button" data-action="forward" title="Forward" aria-label="Forward">&#8594;</html:button>
  <html:button type="button" data-action="reload" title="Reload" aria-label="Reload">&#8635;</html:button>
  <html:div class="sb-picker" data-role="picker">
    <html:button type="button" class="sb-picker-button" data-role="provider" data-action="provider-list"
                 title="AI service" aria-haspopup="listbox" aria-expanded="false">
      <html:span class="sb-picker-name" data-role="providerName"></html:span>
      <html:span class="sb-picker-badges" data-role="providerBadges"></html:span>
      <html:span class="sb-picker-mark" aria-hidden="true">&#9662;</html:span>
    </html:button>
    <html:div class="sb-picker-list" data-role="providerList" role="listbox" hidden="true"></html:div>
  </html:div>
  <html:button type="button" data-action="zoomout" title="Zoom out" aria-label="Zoom out">&#8722;</html:button>
  <html:button type="button" data-action="zoomin" title="Zoom in" aria-label="Zoom in">&#43;</html:button>
  <html:button type="button" data-action="external" title="Open in the system browser" aria-label="Open in the system browser">&#8599;</html:button>
</html:div>

<html:div class="sb-page">
  <browser class="sb-browser" type="content" remote="true" maychangeremoteness="true"
           disableglobalhistory="true" nodefaultsrc="true" autoscroll="false"></browser>
  <html:div class="sb-overlay" data-role="overlay">Loading the AI page...</html:div>
</html:div>

<html:div class="sb-resizer" data-role="resizer" role="separator" aria-orientation="horizontal"
          title="Drag to change the height. Double-click to fill the window.">
  <html:div class="sb-grip"></html:div>
</html:div>

<html:div class="sb-send" data-role="send">
  <html:div class="sb-send-title">Attach on send:</html:div>
  <html:div class="sb-send-hint" data-role="hint">Select a paper, or open one, to attach it.</html:div>
  ${checks}
</html:div>

<html:div class="sb-editor" data-role="editor" hidden="true">
  <html:textarea class="sb-context-text" data-role="editbox" rows="6"
                 placeholder="The context text goes here."></html:textarea>
  <html:div class="sb-editor-hint">This text goes in front of your message when you send.</html:div>
</html:div>

<html:div class="sb-actions">
  <html:button type="button" data-action="drag" draggable="false" title="Prepare the selected files, then drag them into the chat">Prepare drag files</html:button>
  <html:button type="button" class="sb-primary" data-action="edit" title="Show the context text, to read and change it">Edit context</html:button>
  <html:button type="button" data-action="copy" title="Copy the checked text to the clipboard">Copy context</html:button>
</html:div>
`;
}

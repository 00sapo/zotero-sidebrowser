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

.sb-root .sb-provider {
  flex: 1 1 auto;
  min-width: 0;
  height: 22px;
  padding: 0 3px;
  border: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.2));
  border-radius: 4px;
  background: var(--material-background, #fff);
  color: inherit;
  font: inherit;
  font-size: 12px;
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
  <html:select class="sb-provider" data-role="provider" title="AI service"></html:select>
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

<html:div class="sb-actions">
  <html:button type="button" data-action="attach" title="Attach the checked files to the page now">Attach files</html:button>
  <html:button type="button" class="sb-primary" data-action="insert" title="Put the checked text in the page message box so you can edit it">Insert context to edit</html:button>
  <html:button type="button" data-action="copy" title="Copy the checked text to the clipboard">Copy context</html:button>
</html:div>
`;
}

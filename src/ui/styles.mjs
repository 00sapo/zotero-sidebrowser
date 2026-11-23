/*
 * Styles and markup for the AI pane.
 *
 * The pane lives inside Zotero's item pane, so it inherits the item pane theme.
 * The stylesheet uses Zotero's own CSS variables, which resolve in both light
 * and dark mode, and falls back to neutral colors when a variable is missing.
 */

export const PaneCSS = `
.sb-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  /* A tall, vertical page: most of the window height, never less than 640px.
     The item pane scrolls if the window is shorter. */
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
  min-height: 440px;
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

.sb-root .sb-context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 6px 0 0;
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 1.4;
  color: var(--fill-secondary, rgba(0, 0, 0, 0.62));
}

.sb-root .sb-context .sb-scope {
  flex: 1 1 100%;
}

.sb-root .sb-context label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.sb-root .sb-context label[hidden] {
  display: none;
}

.sb-root .sb-context input[type="checkbox"] {
  margin: 0;
}

.sb-root .sb-selection {
  margin-top: 4px;
  padding: 3px 5px;
  border: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.15));
  border-radius: 4px;
  max-height: 54px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 11px;
  color: var(--fill-secondary, rgba(0, 0, 0, 0.7));
}

.sb-root .sb-selection[hidden] {
  display: none;
}

.sb-root .sb-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 0 0;
  flex: 0 0 auto;
}

.sb-root .sb-actions .sb-spacer {
  flex: 1 1 auto;
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

/* The composer is off by default: the chat page is where people type. A
   toolbar button brings it back for reading or editing the composed text. */
.sb-root .sb-composer {
  flex: 0 0 auto;
  padding-top: 6px;
}

.sb-root .sb-composer[hidden] {
  display: none;
}

.sb-root textarea.sb-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 44px;
  max-height: 140px;
  resize: vertical;
  padding: 4px 5px;
  border: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.2));
  border-radius: 4px;
  background: var(--material-background, #fff);
  color: inherit;
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
}

.sb-root .sb-status {
  padding-top: 4px;
  min-height: 15px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--fill-secondary, rgba(0, 0, 0, 0.62));
  flex: 0 0 auto;
}

.sb-root .sb-status.sb-error {
  color: var(--tag-red, #b3261e);
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
 * The wrapper in `section.mjs` declares the `html` namespace, so plain HTML
 * tags need no prefix, while `<browser>` stays a XUL element. Only a XUL
 * browser can load remote content.
 */
export function paneMarkup() {
  return `
<html:div class="sb-toolbar">
  <html:button type="button" data-action="back" title="Back" aria-label="Back">&#8592;</html:button>
  <html:button type="button" data-action="forward" title="Forward" aria-label="Forward">&#8594;</html:button>
  <html:button type="button" data-action="reload" title="Reload" aria-label="Reload">&#8635;</html:button>
  <html:select class="sb-provider" data-role="provider" title="AI service"></html:select>
  <html:button type="button" data-action="external" title="Open in the system browser" aria-label="Open in the system browser">&#8599;</html:button>
  <html:button type="button" data-action="composer" title="Show or hide the message box" aria-label="Show or hide the message box">&#9998;</html:button>
</html:div>

<html:div class="sb-page">
  <browser class="sb-browser" type="content" remote="true" maychangeremoteness="true"
           disableglobalhistory="true" nodefaultsrc="true" autoscroll="false"></browser>
  <html:div class="sb-overlay" data-role="overlay">Loading the AI page...</html:div>
</html:div>

<html:div class="sb-context">
  <html:div class="sb-scope" data-role="scope"></html:div>
  <html:label data-option="itemContext" hidden="true">
    <html:input type="checkbox" data-role="includeItem" checked="checked"/>
    <html:span data-role="includeItemLabel">Include this paper</html:span>
  </html:label>
  <html:label data-option="listContext" hidden="true">
    <html:input type="checkbox" data-role="includeList" checked="checked"/>
    <html:span data-role="includeListLabel">Include all papers in this list</html:span>
  </html:label>
  <html:label data-option="selectionContext" hidden="true">
    <html:input type="checkbox" data-role="includeSelected" checked="checked"/>
    <html:span data-role="includeSelectedLabel">Include the selected papers</html:span>
  </html:label>
  <html:label data-option="pdfText" hidden="true">
    <html:input type="checkbox" data-role="includePDFText" checked="checked"/>
    <html:span data-role="includePDFTextLabel">Include the selected text</html:span>
  </html:label>
  <html:div class="sb-selection" data-role="selection" hidden="true"></html:div>
</html:div>

<html:div class="sb-actions">
  <html:button type="button" data-action="attach" title="Attach the PDF">Attach PDF</html:button>
  <html:button type="button" data-action="copy" title="Copy the prompt and its context">Copy</html:button>
  <html:span class="sb-spacer"></html:span>
  <html:button type="button" class="sb-primary" data-action="insert"
          title="Place the context in the page message box">Insert context</html:button>
</html:div>

<html:div class="sb-composer" data-role="composer" hidden="true">
  <html:textarea class="sb-input" data-role="input" rows="2"
            placeholder="Your question, or a comment on the context"></html:textarea>
</html:div>

<html:div class="sb-status" data-role="status"></html:div>
`;
}

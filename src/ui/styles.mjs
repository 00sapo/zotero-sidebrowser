/*
 * Styles for the sidebar. Injected as a <style> element into the main window so
 * the panel matches Zotero's theme in both light and dark mode.
 */

export const SIDEBAR_CSS = `
/* #appcontent is a column by default. When the panel is docked it becomes a
   row, so the tab stack keeps its flex and the panel takes its own column. */
#appcontent.sb-row {
  flex-direction: row;
}

#appcontent.sb-row > #zotero-pane-stack {
  flex: 1 1 auto;
  min-width: 0;
}

/* The tab stack holds the collections pane, the item list, and the item pane in
   one horizontal box. When the sidebar is docked, every step of that chain must
   be allowed to shrink, otherwise the panel is pushed past the window edge. */
#appcontent.sb-row > #zotero-pane-stack,
#appcontent.sb-row #tabs-deck,
#appcontent.sb-row tab-content,
#appcontent.sb-row #zotero-trees,
#appcontent.sb-row #zotero-items-pane-container,
#appcontent.sb-row #zotero-item-pane {
  min-width: 0;
}

#sidebrowser-pane {
  display: flex;
  flex-direction: row;
  flex: 0 0 auto;
  align-self: stretch;
  min-width: 260px;
  /* Never take more than the free space Zotero leaves, so the other panes stay
     usable on a narrow window. */
  max-width: 60vw;
  height: 100%;
  border-left: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.15));
  background: var(--material-background, #fff);
  color: var(--fill-primary, #000);
  font: message-box;
}

#sidebrowser-pane[hidden] {
  display: none;
}

#sidebrowser-pane .sb-splitter {
  flex: 0 0 5px;
  cursor: col-resize;
  background: transparent;
}

#sidebrowser-pane .sb-splitter:hover {
  background: var(--fill-quinary, rgba(0, 0, 0, 0.12));
}

#sidebrowser-pane .sb-inner {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

#sidebrowser-pane .sb-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.12));
  flex: 0 0 auto;
}

#sidebrowser-pane .sb-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

#sidebrowser-pane .sb-toolbar button:hover:not(:disabled) {
  background: var(--fill-quinary, rgba(0, 0, 0, 0.08));
}

#sidebrowser-pane .sb-toolbar button:disabled {
  opacity: 0.4;
  cursor: default;
}

#sidebrowser-pane .sb-toolbar button.sb-active {
  background: var(--fill-quaternary, rgba(0, 0, 0, 0.12));
}

#sidebrowser-pane .sb-provider {
  flex: 1 1 auto;
  min-width: 0;
  height: 24px;
  border: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.2));
  border-radius: 4px;
  background: var(--material-background, #fff);
  color: inherit;
  font: inherit;
  padding: 0 4px;
}

#sidebrowser-pane .sb-browser-wrap {
  flex: 1 1 auto;
  min-height: 120px;
  position: relative;
  display: flex;
  flex-direction: column;
}

#sidebrowser-pane .sb-browser {
  flex: 1 1 auto;
  min-height: 0;
  border: 0;
  width: 100%;
  height: 100%;
  display: block;
}

#sidebrowser-pane .sb-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  text-align: center;
  background: var(--material-background, #fff);
  color: inherit;
  font-size: 13px;
  line-height: 1.4;
}

#sidebrowser-pane .sb-overlay[hidden] {
  display: none;
}

#sidebrowser-pane .sb-composer {
  flex: 0 0 auto;
  max-height: 65%;
  overflow: auto;
  border-top: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.12));
  padding: 6px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

#sidebrowser-pane .sb-composer[hidden] {
  display: none;
}

#sidebrowser-pane .sb-scope,
#sidebrowser-pane .sb-hint,
#sidebrowser-pane .sb-status {
  font-size: 11px;
  line-height: 1.45;
  color: var(--fill-secondary, rgba(0, 0, 0, 0.62));
}

#sidebrowser-pane .sb-status.sb-error {
  color: var(--tag-red, #b3261e);
}

#sidebrowser-pane .sb-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

#sidebrowser-pane .sb-options label {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}

#sidebrowser-pane .sb-options label[hidden] {
  display: none;
}

#sidebrowser-pane .sb-options input[type="checkbox"] {
  margin: 1px 0 0;
  flex: 0 0 auto;
}

#sidebrowser-pane .sb-selection {
  border: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.15));
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 11px;
  max-height: 60px;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--fill-secondary, rgba(0, 0, 0, 0.7));
}

#sidebrowser-pane .sb-selection[hidden] {
  display: none;
}

#sidebrowser-pane textarea.sb-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 54px;
  max-height: 160px;
  resize: vertical;
  padding: 5px 6px;
  border: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.2));
  border-radius: 4px;
  background: var(--material-background, #fff);
  color: inherit;
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
}

#sidebrowser-pane .sb-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

#sidebrowser-pane .sb-actions .sb-spacer {
  flex: 1 1 auto;
}

#sidebrowser-pane .sb-actions button {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--fill-quinary, rgba(0, 0, 0, 0.2));
  border-radius: 4px;
  background: var(--material-button, rgba(0, 0, 0, 0.04));
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

#sidebrowser-pane .sb-actions button.sb-primary {
  background: var(--accent-blue10, #2b6cb0);
  border-color: transparent;
  color: #fff;
}

#sidebrowser-pane .sb-actions button:hover:not(:disabled) {
  filter: brightness(1.06);
}

#sidebrowser-pane .sb-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}

#sidebrowser-toggle {
  list-style-image: url("chrome://zotero/skin/16/universal/tab.svg");
}

@media (prefers-color-scheme: dark) {
  #sidebrowser-pane {
    border-left-color: rgba(255, 255, 255, 0.15);
  }
}
`;

/**
 * The panel skeleton.
 *
 * The wrapper in `sidebar.mjs` declares the `html` namespace, so every HTML
 * element must carry the `html:` prefix. The `<browser>` stays a XUL element on
 * purpose: only a XUL browser can load remote content.
 *
 * Placeholders of the form `__name__` are replaced with `STRINGS[name]` before
 * parsing, so the panel needs no localization runtime.
 */
export const SIDEBAR_MARKUP = `
<html:div class="sb-splitter" role="separator" aria-orientation="vertical"></html:div>
<html:div class="sb-inner">
  <html:div class="sb-toolbar">
    <html:button type="button" data-action="back" title="__back__" aria-label="__back__">&#8592;</html:button>
    <html:button type="button" data-action="forward" title="__forward__" aria-label="__forward__">&#8594;</html:button>
    <html:button type="button" data-action="reload" title="__reload__" aria-label="__reload__">&#8635;</html:button>
    <html:select class="sb-provider" data-role="provider" title="__provider__"></html:select>
    <html:button type="button" data-action="external" title="__external__" aria-label="__external__">&#8599;</html:button>
    <html:button type="button" data-action="composer" title="__composer__" aria-label="__composer__">&#9998;</html:button>
    <html:button type="button" data-action="close" title="__close__" aria-label="__close__">&#10005;</html:button>
  </html:div>
  <html:div class="sb-browser-wrap">
    <browser class="sb-browser" type="content" remote="true" maychangeremoteness="true"
             disableglobalhistory="true" nodefaultsrc="true" autoscroll="false"></browser>
    <html:div class="sb-overlay" data-role="overlay" hidden="true"></html:div>
  </html:div>
  <html:div class="sb-composer" data-role="composer">
    <html:div class="sb-scope" data-role="scope"></html:div>
    <html:div class="sb-options" data-role="options">
      <html:label data-option="itemContext">
        <html:input type="checkbox" data-role="includeItem"/>
        <html:span data-role="includeItemLabel">__includeItem__</html:span>
      </html:label>
      <html:label data-option="listContext" hidden="true">
        <html:input type="checkbox" data-role="includeList"/>
        <html:span data-role="includeListLabel">__includeList__</html:span>
      </html:label>
      <html:label data-option="selectionContext" hidden="true">
        <html:input type="checkbox" data-role="includeSelected"/>
        <html:span data-role="includeSelectedLabel">__includeSelected__</html:span>
      </html:label>
      <html:label data-option="pdfAttachment">
        <html:input type="checkbox" data-role="attachPDF"/>
        <html:span data-role="attachPDFLabel">__attachPDF__</html:span>
      </html:label>
      <html:label data-option="pdfText" hidden="true">
        <html:input type="checkbox" data-role="includePDFText" checked="checked"/>
        <html:span data-role="includePDFTextLabel">__includePDFText__</html:span>
      </html:label>
    </html:div>
    <html:div class="sb-selection" data-role="selection" hidden="true"></html:div>
    <html:textarea class="sb-input" data-role="input" rows="3" placeholder="__placeholder__"></html:textarea>
    <html:div class="sb-actions">
      <html:button type="button" data-action="copy" title="__copy__">__copy__</html:button>
      <html:span class="sb-spacer"></html:span>
      <html:button type="button" class="sb-primary" data-action="send" title="__send__">__send__</html:button>
    </html:div>
    <html:div class="sb-status" data-role="status"></html:div>
  </html:div>
</html:div>
`;

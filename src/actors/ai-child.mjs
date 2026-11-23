/*
 * Window actor child for the sidebar browser.
 *
 * This is the only file that runs inside the AI page. Zotero uses Fission, so a
 * `<browser>` always gets its own content process and chrome code cannot touch
 * the page DOM. The parent side sends messages here and this actor does the
 * page work: find the composer, insert text, attach files, click send, and
 * observe link clicks.
 *
 * Sandbox note: inside a JSWindowActorChild there is no `setTimeout`, `File`,
 * `DataTransfer`, `Event`, `InputEvent`, or `atob` in scope. Take every one of
 * them from `this.contentWindow`.
 */

export class SideBrowserChild extends JSWindowActorChild {
  /** @type {object|null} */
  _adapter = null;

  // Events the actor system forwards to handleEvent, from the parent's
  // registration. A capture listener that runs in the system group sees clicks
  // that page scripts would otherwise swallow.
  handleEvent(event) {
    if (event.type === "click") {
      this._handleClick(event);
    }
  }

  _handleClick(event) {
    if (event.button !== 0 || !event.target) {
      return;
    }
    let anchor = event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor) {
      return;
    }
    let href = anchor.href;
    if (!href || !/^https?:/i.test(href)) {
      return;
    }
    // A click with a modifier belongs to the page or to the system browser.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    let sameDocument = false;
    try {
      let target = new URL(href);
      let current = new URL(this.contentWindow.location.href);
      sameDocument = target.origin === current.origin
        && target.pathname === current.pathname
        && target.search === current.search;
    } catch (e) {
      sameDocument = false;
    }
    if (sameDocument && href.includes("#")) {
      return;
    }

    // Decide in the parent side whether to keep the link in the sidebar, to
    // open it in the system browser, or to let the page handle it.
    this.sendAsyncMessage("link-click", {
      href,
      shiftKey: event.shiftKey,
      target: anchor.getAttribute("target"),
    });
  }

  receiveMessage({ name, data }) {
    switch (name) {
      case "set-adapter":
        this._adapter = data.adapter;
        return { ok: true };
      case "ping":
        return { ok: true, url: this.contentWindow.location.href };
      case "compose":
        return this._compose(data);
      case "current-url":
        return { url: this.contentWindow.location.href, title: this.document.title };
      case "prepare":
        return this._prepare();
      case "read-mock-state":
        return this._readMockState();
      case "select-all-text":
        return this._selectAllText();
      default:
        return { ok: false, error: `Unknown message: ${name}` };
    }
  }

  /**
   * Report what the page offers, so the composer can enable the PDF checkbox
   * only when the site accepts a document.
   */
  _prepare() {
    let doc = this.document;
    let composer = this._find(this._adapter?.composerSelectors || []);
    let fileInputs = this._findFileInputs();
    return {
      url: this.contentWindow.location.href,
      title: doc.title,
      readyState: doc.readyState,
      hasComposer: !!composer,
      fileInputs: fileInputs.map((el) => ({
        accept: el.getAttribute("accept") || "",
        multiple: el.hasAttribute("multiple"),
      })),
    };
  }

  async _compose({ text, files = [], send = true, submitOnly = false }) {
    let doc = this.document;
    if (doc.readyState !== "complete") {
      await new Promise((resolve) => {
        this.contentWindow.addEventListener("load", resolve, { once: true });
      });
    }

    let composer = this._find(this._adapter?.composerSelectors || []);
    if (!composer) {
      return { ok: false, stage: "composer", error: "No composer found on the page" };
    }

    let attached = [];
    let attachErrors = [];
    if (files.length) {
      for (let file of files) {
        try {
          await this._attachFile(file);
          attached.push(file.name);
        } catch (e) {
          attachErrors.push({ name: file.name, error: String(e) });
        }
      }
      // Sites read the file input asynchronously and often disable the send
      // button until the upload finishes. Give them a moment.
      if (attached.length) {
        await this._delay(1500);
      }
    }

    if (!submitOnly) {
      try {
        this._insertText(composer, text);
      } catch (e) {
        return {
          ok: false,
          stage: "insert",
          error: String(e),
          attached,
          attachErrors,
          text,
        };
      }
      await this._delay(250);
    }

    if (!send) {
      return { ok: true, sent: false, attached, attachErrors };
    }

    let sent = await this._send();
    return { ok: true, sent, attached, attachErrors };
  }

  _delay(ms) {
    return new Promise((resolve) => this.contentWindow.setTimeout(resolve, ms));
  }

  /**
   * Insert text the way a paste would. Sites built on React, Vue, or ProseMirror
   * keep their own copy of the value, so assigning `value` is not enough: the
   * native setter plus an input event is what those frameworks listen for.
   */
  _insertText(el, text) {
    let win = this.contentWindow;
    el.focus();

    if (el.localName === "textarea" || el.localName === "input") {
      let proto = el.localName === "textarea"
        ? win.HTMLTextAreaElement.prototype
        : win.HTMLInputElement.prototype;
      let setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) {
        setter.call(el, text);
      } else {
        el.value = text;
      }
      el.dispatchEvent(new win.InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }));
      el.dispatchEvent(new win.Event("change", { bubbles: true }));
      return;
    }

    // contenteditable: select everything first so the new text replaces it, then
    // use execCommand so the site's undo stack and input handling stay intact.
    let selection = win.getSelection();
    let range = this.document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = false;
    try {
      inserted = this.document.execCommand("insertText", false, text);
    } catch (e) {
      inserted = false;
    }

    if (!inserted) {
      // Fallback for pages that block execCommand: write the nodes directly and
      // announce a plain input event.
      el.textContent = text;
      el.dispatchEvent(new win.InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }));
    }
  }

  async _send() {
    let mode = this._adapter?.sendMode || "button-then-enter";
    let selectors = this._adapter?.sendSelectors || [];

    if (mode !== "enter") {
      let button = this._findSendButton(selectors);
      if (button) {
        button.click();
        await this._delay(400);
        if (this._looksSent()) {
          return true;
        }
      }
    }

    if (mode === "enter" || mode === "button-then-enter") {
      return this._pressEnter();
    }
    return false;
  }

  _findSendButton(selectors) {
    for (let selector of selectors) {
      let candidates;
      try {
        candidates = this.document.querySelectorAll(selector);
      } catch (e) {
        continue;
      }
      for (let el of candidates) {
        if (this._isClickable(el)) {
          return el;
        }
      }
    }
    return null;
  }

  _isClickable(el) {
    if (el.disabled) {
      return false;
    }
    if (el.getAttribute("aria-disabled") === "true") {
      return false;
    }
    let rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * A cheap check that the message left the composer. Sites clear the composer
   * on submit, so a composer that is now empty is a good sign of success.
   */
  _looksSent() {
    let composer = this._find(this._adapter?.composerSelectors || []);
    if (!composer) {
      return true;
    }
    let text = composer.localName === "textarea" ? composer.value : composer.textContent;
    return !text || !text.trim();
  }

  async _pressEnter() {
    let composer = this._find(this._adapter?.composerSelectors || []);
    let target = composer || this.document.activeElement || this.document.body;
    let win = this.contentWindow;
    let init = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    target.dispatchEvent(new win.KeyboardEvent("keydown", init));
    target.dispatchEvent(new win.KeyboardEvent("keypress", init));
    target.dispatchEvent(new win.KeyboardEvent("keyup", init));
    await this._delay(300);
    return true;
  }

  /**
   * Attach a file through the site's own file input. Building a DataTransfer
   * and assigning `input.files` is the only cross-site way to hand a real file
   * to a page, because the input cannot be filled with a path.
   */
  async _attachFile({ name, type, data }) {
    let input = this._findFileInputs()[0];
    if (!input) {
      throw new Error("No file input on the page");
    }
    let win = this.contentWindow;
    let bytes = this._toBytes(data);
    let file = new win.File([bytes], name, { type });
    let dt = new win.DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
  }

  /**
   * The parent side sends file bytes as a binary string, because structured
   * cloning of a large array over the actor boundary is slower and the string
   * form keeps the message small.
   */
  _toBytes(data) {
    let bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      bytes[i] = data.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  /**
   * Test helper. Reads the counters a mock page keeps, so the self test can
   * prove that a message and its attachment really arrived.
   */
  /**
   * Test helper. Selects every word in the document, so a test can open the
   * reader selection popup without a mouse.
   */
  _selectAllText() {
    let win = this.contentWindow;
    let target = this.document.body;
    let range = this.document.createRange();
    range.selectNodeContents(target);
    let selection = win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let text = selection.toString();
    this.sendAsyncMessage("selection-made", { text: text.slice(0, 200), length: text.length });
    return { length: text.length, preview: text.slice(0, 80) };
  }

  _readMockState() {
    // Read the live window through the browsing context: a cached reference can
    // point at the previous document after a navigation.
    let win = this.browsingContext?.window;
    let received = [];
    try {
      received = win?.wrappedJSObject?.__received || win?.__received || [];
    } catch (e) {
      received = [];
    }
    return {
      messages: received.length,
      received,
      log: this.document.getElementById("log")?.textContent || "",
    };
  }

  /**
   * File inputs are almost always hidden: the page opens them from a button.
   * They must not be filtered for visibility, only for being connected.
   *
   * @returns {HTMLInputElement[]}
   */
  _findFileInputs() {
    let out = [];
    for (let selector of this._adapter?.fileSelectors || []) {
      let nodes;
      try {
        nodes = this.document.querySelectorAll(selector);
      } catch (e) {
        continue;
      }
      for (let el of nodes) {
        if (!el.isConnected || el.disabled) {
          continue;
        }
        if (!this._acceptsDocuments(el)) {
          continue;
        }
        if (!out.includes(el)) {
          out.push(el);
        }
      }
    }
    return out;
  }

  /**
   * Whether a file input will take a PDF. ChatGPT, when signed out, only offers
   * image inputs, so handing it a PDF would silently do nothing.
   */
  _acceptsDocuments(el) {
    let accept = (el.getAttribute("accept") || "").toLowerCase();
    if (!accept) {
      return true;
    }
    return accept.split(",").some((token) => {
      let value = token.trim();
      return value === "application/pdf"
        || value === "application/*"
        || value === "*/*"
        || value === ""
        || value.includes("pdf");
    });
  }

  _find(selectors) {
    for (let selector of selectors) {
      let el;
      try {
        el = this.document.querySelector(selector);
      } catch (e) {
        continue;
      }
      if (el && this._isUsable(el)) {
        return el;
      }
    }
    return null;
  }

  _findAll(selectors) {
    let out = [];
    for (let selector of selectors) {
      try {
        for (let el of this.document.querySelectorAll(selector)) {
          if (this._isUsable(el) && !out.includes(el)) {
            out.push(el);
          }
        }
      } catch (e) {
        // A bad selector must not break the whole lookup.
        continue;
      }
    }
    return out;
  }

  _isUsable(el) {
    if (!el || !el.isConnected) {
      return false;
    }
    if (el.disabled || el.getAttribute("aria-hidden") === "true") {
      return false;
    }
    let rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }
    let style = this.contentWindow.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }
}

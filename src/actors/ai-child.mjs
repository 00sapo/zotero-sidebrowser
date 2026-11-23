/*
 * Window actor child for the AI page.
 *
 * This is the only file that runs inside the chat page. Zotero uses Fission, so
 * a `<browser>` gets its own content process and chrome code cannot touch the
 * page DOM. The parent side sends messages here and this actor does the page
 * work: keep the context block, insert text, attach files, and catch the send
 * action before the site handles it.
 *
 * Sandbox note: inside a JSWindowActorChild there is no `setTimeout`, `File`,
 * `DataTransfer`, `Event`, or `InputEvent` in scope. Take every one of them from
 * `this.contentWindow`.
 */

/**
 * Input types that count as "typing a message". Catching Enter on a search box
 * or a rename field would be wrong, so only these are watched.
 */
const MESSAGE_INPUT_TYPES = new Set(["insertText", "insertLineBreak", "insertParagraph"]);

export class SideBrowserChild extends JSWindowActorChild {
  /** @type {object|null} */
  _adapter = null;

  /** The context block for the next message. @type {string} */
  _context = "";

  /** Context block that was just injected, to recognise it coming back. */
  _injected = "";

  /** Files waiting to be attached on the next send. @type {object[]} */
  _pendingFiles = [];

  /** Set while the actor is inserting text, so it does not catch itself. */
  _busy = false;

  /** True once the current context went out with a message. */
  _contextSent = false;

  /** Last message sent, so a double intercept cannot duplicate it. */
  _lastSent = null;

  didDestroy() {
    this._context = "";
    this._pendingFiles = [];
    this._busy = false;
  }

  /**
   * The capture listeners registered in `core.mjs` land here.
   *
   * The `click` and `keydown` cases are the send intercept. They run in the
   * system event group, so they see the event before the site's own handlers.
   */
  handleEvent(event) {
    if (this._busy) {
      return;
    }
    switch (event.type) {
      case "click":
        this._onClick(event);
        break;
      case "keydown":
        this._onKeyDown(event);
        break;
      case "input":
        this._onInput(event);
        break;
      default:
        break;
    }
  }

  /** Forward a debug line to the parent, which can reach Zotero.debug. */
  _log(message) {
    try {
      this.sendAsyncMessage("debug", { message });
    } catch (e) {
      // The actor is gone, so there is nothing to log to.
    }
  }

  receiveMessage({ name, data }) {
    switch (name) {
      case "set-adapter":
        this._adapter = data.adapter;
        return { ok: true };
      case "set-context": {
        let next = String(data.context || "");
        // The same text again keeps its "already sent" state. A new paper
        // resets it, so the next message carries the new context.
        if (next !== this._context) {
          this._contextSent = false;
        }
        this._context = next;
        return { ok: true, length: this._context.length };
      }
      case "set-context-old":
        this._context = String(data.context || "");
        return { ok: true, length: this._context.length };
      case "set-files":
        this._pendingFiles = Array.isArray(data.files) ? data.files : [];
        return { ok: true, count: this._pendingFiles.length };
      case "insert":
        return this._insertOnly(data.text);
      case "attach":
        return this._attachOnly(data.files || []);
      case "compose":
        return this._compose(data);
      case "prepare":
        return this._prepare();
      case "get-context":
        return { ok: true, context: this._context };
      case "click-send":
        return this._clickSendForTest();
      case "read-mock-state":
        return this._readMockState();
      case "select-all-text":
        return this._selectAllText();
      default:
        return { ok: false, error: `Unknown message: ${name}` };
    }
  }

  // -------------------------------------------------------------------------
  // Send intercept
  // -------------------------------------------------------------------------

  /**
   * A click on a send control. The message is put in the composer first, and if
   * that works the site sees a composer that is already full.
   *
   * A click on a link is forwarded to the parent, which decides whether the
   * link stays in the pane or goes to the system browser.
   */
  _onClick(event) {
    if (event.button !== 0 || !event.target) {
      return;
    }
    let sendControl = event.target.closest ? event.target.closest(this._sendSelector()) : null;
    if (sendControl && this._isUsable(sendControl)) {
      this._prepareSend();
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
    this.sendAsyncMessage("link-click", {
      href,
      shiftKey: event.shiftKey,
      target: anchor.getAttribute("target"),
    });
  }

  /**
   * Enter in the message box is a send on most sites. The site's own handler
   * runs in the default group, so preparing here means it sees full content.
   */
  _onKeyDown(event) {
    if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    let composer = this._findComposer();
    if (!composer || !composer.contains(event.target)) {
      return;
    }
    if (event.isComposing) {
      return;
    }
    this._prepareSend();
  }

  /** Remember what the actor itself typed, so it is not counted as user text. */
  _onInput(event) {
    if (!MESSAGE_INPUT_TYPES.has(event.inputType)) {
      return;
    }
    if (!this._context) {
      return;
    }
    let composer = this._findComposer();
    if (composer && composer.contains(event.target)) {
      this._lastUserInput = event.timeStamp;
    }
  }

  /**
   * Fill the composer with the context block plus whatever the user already
   * typed in the page, and handle the PDF that is waiting.
   */
  async _prepareSend() {
    if (this._busy) {
      return;
    }
    this._busy = true;
    try {
      let composer = this._findComposer();
      if (!composer) {
        return;
      }
      let userText = this._composerText(composer);
      let text = this._withContext(userText);
      if (!text) {
        return;
      }
      this._insertText(composer, text);
      if (this._pendingFiles.length) {
        await this._attachFiles(this._pendingFiles);
        this._pendingFiles = [];
      }
      await this._delay(60);
    } catch (e) {
      this._log(`could not prepare the message: ${e}`);
    } finally {
      this._busy = false;
    }
  }

  /**
   * The context block, followed by the user's own words. A composer that
   * already holds the block is left alone, so this is safe to run twice.
   *
   * @param {string} userText
   * @returns {string}
   */
  _withContext(userText) {
    let context = this._context.trim();
    let text = (userText || "").trim();
    if (!context || this._contextSent) {
      return text;
    }
    if (text.startsWith(context) || this._alreadyHasContext(text)) {
      return text;
    }
    this._injected = context;
    this._contextSent = true;
    return text ? `${context}\n\n${text}` : context;
  }

  _alreadyHasContext(text) {
    if (!text || text.length < 40) {
      return false;
    }
    // A prefix match on the first line is enough: the block always starts with
    // the same sentence, so a message that already carries it is not doubled.
    let firstLine = text.split("\n")[0].slice(0, 60);
    let contextFirstLine = this._context.trim().split("\n")[0].slice(0, 60);
    return !!firstLine && firstLine === contextFirstLine;
  }

  _hasComposerText() {
    let composer = this._findComposer();
    return !!composer && !!this._composerText(composer).trim();
  }

  _composerText(composer) {
    if (!composer) {
      return "";
    }
    if (composer.localName === "textarea" || composer.localName === "input") {
      return composer.value || "";
    }
    return composer.innerText || composer.textContent || "";
  }

  _sendSelector() {
    let selectors = this._adapter?.sendSelectors || [];
    return selectors.length ? selectors.join(",") : "[data-sidebrowser-no-send-control]";
  }

  // -------------------------------------------------------------------------
  // Page questions
  // -------------------------------------------------------------------------

  _prepare() {
    let doc = this.document;
    let composer = this._findComposer();
    return {
      url: this.contentWindow.location.href,
      title: doc.title,
      readyState: doc.readyState,
      hasComposer: !!composer,
      fileInputs: this._findFileInputs().map((el) => ({
        accept: el.getAttribute("accept") || "",
        multiple: el.hasAttribute("multiple"),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Insertion
  // -------------------------------------------------------------------------

  async _insertOnly(text) {
    let composer = this._findComposer();
    if (!composer) {
      return { ok: false, stage: "composer", error: "No composer found on the page" };
    }
    this._busy = true;
    try {
      this._insertText(composer, String(text || ""));
      return { ok: true };
    } catch (e) {
      return { ok: false, stage: "insert", error: String(e) };
    } finally {
      this._busy = false;
    }
  }

  async _compose({ text, files = [], send = true, submitOnly = false }) {
    let doc = this.document;
    if (doc.readyState !== "complete") {
      await new Promise((resolve) => {
        this.contentWindow.addEventListener("load", resolve, { once: true });
      });
    }

    let composer = this._findComposer();
    if (!composer) {
      return { ok: false, stage: "composer", error: "No composer found on the page" };
    }

    this._busy = true;
    let attached = [];
    let attachErrors = [];
    try {
      if (files.length) {
        let outcome = await this._attachFiles(files);
        attached = outcome.attached;
        attachErrors = outcome.attachErrors;
        if (attached.length) {
          await this._delay(1500);
        }
      }
      if (!submitOnly) {
        try {
          this._insertText(composer, String(text || ""));
        } catch (e) {
          return { ok: false, stage: "insert", error: String(e), attached, attachErrors };
        }
        await this._delay(250);
      }
    } finally {
      this._busy = false;
    }

    if (!send) {
      return { ok: true, sent: false, attached, attachErrors };
    }
    let sent = await this._send();
    return { ok: true, sent, attached, attachErrors };
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

    // contenteditable: select everything so the new text replaces it, then use
    // execCommand so the site's undo stack and input handling stay intact.
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
      el.textContent = text;
      el.dispatchEvent(new win.InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }));
    }
  }

  _delay(ms) {
    return new Promise((resolve) => this.contentWindow.setTimeout(resolve, ms));
  }

  // -------------------------------------------------------------------------
  // Files
  // -------------------------------------------------------------------------

  async _attachOnly(files) {
    let outcome = await this._attachFiles(files);
    return { ok: outcome.attached.length > 0, ...outcome };
  }

  async _attachFiles(files) {
    let attached = [];
    let attachErrors = [];
    for (let file of files) {
      try {
        this._attachFile(file);
        attached.push(file.name);
      } catch (e) {
        attachErrors.push({ name: file.name, error: String(e) });
      }
    }
    if (attached.length) {
      await this._delay(1500);
    }
    return { attached, attachErrors };
  }

  /**
   * Attach a file through the site's own file input. Building a DataTransfer
   * and assigning `input.files` is the only cross-site way to hand a real file
   * to a page, because the input cannot be filled with a path.
   */
  _attachFile({ name, type, data }) {
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
   * The parent sends file bytes as a binary string, because structured cloning
   * of a large array over the actor boundary is slower.
   */
  _toBytes(data) {
    let bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      bytes[i] = data.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  async _send() {
    let mode = this._adapter?.sendMode || "button-then-enter";
    let selectors = this._adapter?.sendSelectors || [];

    if (mode !== "enter") {
      let button = this._findSendButton(selectors);
      if (button) {
        this._busy = true;
        try {
          button.click();
        } finally {
          this._busy = false;
        }
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
    let composer = this._findComposer();
    if (!composer) {
      return true;
    }
    return !this._composerText(composer).trim();
  }

  async _pressEnter() {
    let composer = this._findComposer();
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
    this._busy = true;
    try {
      target.dispatchEvent(new win.KeyboardEvent("keydown", init));
      target.dispatchEvent(new win.KeyboardEvent("keypress", init));
      target.dispatchEvent(new win.KeyboardEvent("keyup", init));
    } finally {
      this._busy = false;
    }
    await this._delay(300);
    return true;
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  _findComposer() {
    for (let selector of this._adapter?.composerSelectors || []) {
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

  /**
   * File inputs are almost always hidden: the page opens them from a button.
   * They must not be filtered for visibility, only for being connected.
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

  // -------------------------------------------------------------------------
  // Test helpers
  // -------------------------------------------------------------------------

  /**
   * Test helper: click the page's own send control the way a mouse would. The
   * send intercept is what makes the message carry the context.
   */
  _clickSendForTest() {
    let button = this._findSendButton(this._adapter?.sendSelectors || []);
    if (!button) {
      return { ok: false, error: "No send control found" };
    }
    button.click();
    return { ok: true };
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
      context: this._context,
      log: this.document.getElementById("log")?.textContent || "",
    };
  }

  _selectAllText() {
    let win = this.contentWindow;
    let range = this.document.createRange();
    range.selectNodeContents(this.document.body);
    let selection = win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let text = selection.toString();
    return { length: text.length, preview: text.slice(0, 80) };
  }
}

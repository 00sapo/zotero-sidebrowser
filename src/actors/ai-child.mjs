/*
 * Window actor child for the AI page.
 *
 * This is the only file that runs inside the chat page. Zotero uses Fission, so
 * a `<browser>` gets its own content process and chrome code cannot touch the
 * page DOM. The parent side sends messages here and this actor does the page
 * work: attach files, insert text, and take over the send action.
 *
 * Send takeover: when the user clicks the page's send button, or presses Enter in
 * its message box, and the pane has files waiting, this actor stops that event,
 * asks the parent for the files, attaches them, waits for the upload, and then
 * sends the message itself. Files go out once for each package. A new package key
 * (another paper, other check boxes) arms the next message again.
 *
 * Sandbox note: inside a JSWindowActorChild there is no `setTimeout`, `File`,
 * `DataTransfer`, `Event`, or `InputEvent` in scope. Take every one of them from
 * `this.contentWindow`. `Zotero` and `dump` print nothing here, so use `_log`.
 */

/** How long to wait for a site to finish an upload before sending anyway. */
const UPLOAD_WAIT_MS = 12000;
const UPLOAD_MIN_WAIT_MS = 1500;

export class SideBrowserChild extends JSWindowActorChild {
  /** @type {object|null} */
  _adapter = null;

  /** Key of the package the pane wants sent, or "" for none. */
  _pkgKey = "";

  /** Key of the package that already went out with a message. */
  _sentKey = "";

  /** Set while the actor acts on the page, so it does not catch itself. */
  _busy = false;

  didDestroy() {
    this._pkgKey = "";
    this._busy = false;
  }

  /** Forward a debug line to the parent, which can reach Zotero.debug. */
  _log(message) {
    try {
      this.sendAsyncMessage("debug", { message });
    } catch (e) {
      // The actor is gone, so there is nothing to log to.
    }
  }

  /**
   * The capture listeners registered in `core.mjs` land here. A plain capture
   * listener runs before the page's own handlers, which is what the takeover
   * needs. A system-group listener would run after them.
   */
  handleEvent(event) {
    if (this._busy) {
      return;
    }
    if (event.type === "click") {
      this._onClick(event);
    } else if (event.type === "keydown") {
      this._onKeyDown(event);
    }
  }

  receiveMessage({ name, data }) {
    switch (name) {
      case "set-adapter":
        this._adapter = data.adapter;
        return { ok: true };
      case "set-package": {
        let key = String(data.key || "");
        this._pkgKey = key;
        return { ok: true, pending: this._pending() };
      }
      case "insert":
        return this._insertOnly(data.text);
      case "attach":
        return this._attachOnly(data.files || [], data.key);
      case "compose":
        return this._compose(data);
      case "prepare":
        return this._prepare();
      case "read-mock-state":
        return this._readMockState();
      case "click-send":
        return this._clickSendForTest();
      case "select-all-text":
        return this._selectAllText();
      default:
        return { ok: false, error: `Unknown message: ${name}` };
    }
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  _pending() {
    return !!this._pkgKey && this._pkgKey !== this._sentKey;
  }

  _onClick(event) {
    if (event.button !== 0 || !event.target?.closest) {
      return;
    }

    let selector = this._sendSelector();
    let control = selector ? event.target.closest(selector) : null;
    if (control && this._pending() && this._isUsable(control) && this._hasComposerText()) {
      this._takeOver(event);
      return;
    }

    let anchor = event.target.closest("a[href]");
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
    // The parent decides whether the link stays in the pane.
    this.sendAsyncMessage("link-click", {
      href,
      shiftKey: event.shiftKey,
      target: anchor.getAttribute("target"),
    });
  }

  _onKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.isComposing || !this._pending()) {
      return;
    }
    let composer = this._findComposer();
    if (!composer || !composer.contains(event.target) || !this._composerText(composer).trim()) {
      return;
    }
    this._takeOver(event);
  }

  /**
   * Stop the send, attach the files, and send again. Stopping the event first is
   * what gives the upload time to finish: the site never sees the first send.
   */
  _takeOver(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    this._sendWithPackage();
  }

  async _sendWithPackage() {
    if (this._busy) {
      return;
    }
    this._busy = true;
    let key = this._pkgKey;
    let report = { key, attached: [], errors: [], skipped: [], sent: false };
    try {
      let pkg = null;
      try {
        pkg = await this.sendQuery("get-package", { key });
      } catch (e) {
        report.error = `Could not read the files: ${e}`;
      }
      let files = pkg?.files || [];
      report.skipped = pkg?.skipped || [];
      if (files.length) {
        let outcome = await this._attachFiles(files);
        report.attached = outcome.attached;
        report.errors = outcome.attachErrors;
        if (outcome.attached.length) {
          await this._waitForUpload();
        }
      }
      // Mark before sending, so a second click cannot attach the same files.
      this._sentKey = key;
      report.sent = await this._send();
    } catch (e) {
      report.error = String(e);
    } finally {
      this._busy = false;
    }
    this.sendAsyncMessage("package-sent", report);
  }

  /**
   * Sites disable the send button while a file uploads. Wait for it to come
   * back, with a limit so a stuck upload does not block the message.
   */
  async _waitForUpload() {
    await this._delay(UPLOAD_MIN_WAIT_MS);
    let mode = this._adapter?.sendMode || "button-then-enter";
    if (mode === "enter") {
      await this._delay(1500);
      return;
    }
    let selectors = this._adapter?.sendSelectors || [];
    let waited = UPLOAD_MIN_WAIT_MS;
    while (waited < UPLOAD_WAIT_MS) {
      if (this._findSendButton(selectors)) {
        return;
      }
      await this._delay(400);
      waited += 400;
    }
  }

  _sendSelector() {
    let selectors = this._adapter?.sendSelectors || [];
    return selectors.length ? selectors.join(",") : "";
  }

  // -------------------------------------------------------------------------
  // Page questions
  // -------------------------------------------------------------------------

  _prepare() {
    let doc = this.document;
    return {
      url: this.contentWindow.location.href,
      title: doc.title,
      readyState: doc.readyState,
      hasComposer: !!this._findComposer(),
      fileInputs: this._allFileInputs().map((el) => ({
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
      return { ok: false, stage: "composer", error: "No message box found on the page" };
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

  /** Test and console path: attach files, insert text, and send in one call. */
  async _compose({ text, files = [], send = true }) {
    let doc = this.document;
    if (doc.readyState !== "complete") {
      await new Promise((resolve) => {
        this.contentWindow.addEventListener("load", resolve, { once: true });
      });
    }
    let composer = this._findComposer();
    if (!composer) {
      return { ok: false, stage: "composer", error: "No message box found on the page" };
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
          await this._waitForUpload();
        }
      }
      try {
        this._insertText(composer, String(text || ""));
      } catch (e) {
        return { ok: false, stage: "insert", error: String(e), attached, attachErrors };
      }
      await this._delay(250);
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

  async _attachOnly(files, key) {
    this._busy = true;
    try {
      let outcome = await this._attachFiles(files);
      // Files attached by hand must not go out a second time with the message.
      if (key && outcome.attached.length) {
        this._sentKey = String(key);
      }
      return { ok: outcome.attached.length > 0, ...outcome };
    } finally {
      this._busy = false;
    }
  }

  /**
   * Attach every file in as few steps as the page allows. A file input that
   * takes several files gets one assignment with all of them, because a second
   * assignment would replace the first.
   *
   * @param {object[]} files - `{name, type, text}` or `{name, type, data}`.
   * @returns {Promise<{attached: string[], attachErrors: object[]}>}
   */
  async _attachFiles(files) {
    let attached = [];
    let attachErrors = [];
    let groups = new Map();

    for (let spec of files) {
      let picked = this._pickInput(spec);
      if (!picked) {
        attachErrors.push({ name: spec.name, error: "no file input on the page accepts it" });
        continue;
      }
      let list = groups.get(picked.input) || [];
      list.push(picked.file);
      groups.set(picked.input, list);
    }

    for (let [input, list] of groups) {
      let batches = input.hasAttribute("multiple") ? [list] : list.map((file) => [file]);
      for (let i = 0; i < batches.length; i++) {
        try {
          this._assignFiles(input, batches[i]);
          attached.push(...batches[i].map((file) => file.name));
        } catch (e) {
          for (let file of batches[i]) {
            attachErrors.push({ name: file.name, error: String(e) });
          }
        }
        if (i < batches.length - 1) {
          await this._delay(1200);
        }
      }
    }
    return { attached, attachErrors };
  }

  _assignFiles(input, fileObjects) {
    let win = this.contentWindow;
    let dt = new win.DataTransfer();
    for (let file of fileObjects) {
      dt.items.add(file);
    }
    input.files = dt.files;
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
  }

  /**
   * The first file input that accepts this file. A text file that no input takes
   * as Markdown gets a second try as plain text.
   */
  _pickInput(spec) {
    let variants = [spec];
    if (typeof spec.text === "string" && spec.type !== "text/plain") {
      variants.push({
        ...spec,
        name: spec.name.replace(/\.[^.]+$/, "") + ".txt",
        type: "text/plain",
      });
    }
    let inputs = this._allFileInputs();
    for (let variant of variants) {
      for (let input of inputs) {
        if (this._accepts(input, variant.name, variant.type)) {
          return { input, file: this._makeFile(variant) };
        }
      }
    }
    return null;
  }

  _makeFile(spec) {
    let win = this.contentWindow;
    if (typeof spec.text === "string") {
      return new win.File([spec.text], spec.name, { type: spec.type });
    }
    return new win.File([this._toBytes(spec.data)], spec.name, { type: spec.type });
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

  /**
   * Whether an input's `accept` list takes a file. No list means anything goes.
   * A list holds extensions (".pdf"), exact types, and wildcards ("image/*").
   */
  _accepts(input, name, type) {
    let accept = (input.getAttribute("accept") || "").toLowerCase().trim();
    if (!accept) {
      return true;
    }
    let lowerName = name.toLowerCase();
    let lowerType = (type || "").toLowerCase();
    return accept.split(",").some((token) => {
      let value = token.trim();
      if (!value || value === "*/*") {
        return true;
      }
      if (value.startsWith(".")) {
        return lowerName.endsWith(value);
      }
      if (value.endsWith("/*")) {
        return lowerType.startsWith(value.slice(0, -1));
      }
      return value === lowerType;
    });
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
    if (el.disabled || el.getAttribute("aria-disabled") === "true") {
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
    return !composer || !this._composerText(composer).trim();
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
    target.dispatchEvent(new win.KeyboardEvent("keydown", init));
    target.dispatchEvent(new win.KeyboardEvent("keypress", init));
    target.dispatchEvent(new win.KeyboardEvent("keyup", init));
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

  _hasComposerText() {
    let composer = this._findComposer();
    return !!composer && !!this._composerText(composer).trim();
  }

  _composerText(composer) {
    if (composer.localName === "textarea" || composer.localName === "input") {
      return composer.value || "";
    }
    return composer.innerText || composer.textContent || "";
  }

  /**
   * File inputs are almost always hidden: the page opens them from a button, so
   * they must not be filtered for visibility. The adapter's selectors come first
   * because they name the input the site really uses, then every other one.
   *
   * @returns {HTMLInputElement[]}
   */
  _allFileInputs() {
    let out = [];
    let selectors = [...(this._adapter?.fileSelectors || []), "input[type='file']"];
    for (let selector of selectors) {
      let nodes;
      try {
        nodes = this.document.querySelectorAll(selector);
      } catch (e) {
        continue;
      }
      for (let el of nodes) {
        if (el.isConnected && !el.disabled && !out.includes(el)) {
          out.push(el);
        }
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

  // -------------------------------------------------------------------------
  // Test helpers
  // -------------------------------------------------------------------------

  /** Click the page's own send control the way a mouse would. */
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
      pending: this._pending(),
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

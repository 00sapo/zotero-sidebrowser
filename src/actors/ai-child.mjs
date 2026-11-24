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

  /**
   * The window that owns the current document. A cached `contentWindow` can
   * point at the previous page after a navigation, and events made there never
   * reach the new page.
   *
   * @returns {Window}
   */
  get win() {
    return this.document?.defaultView || this.contentWindow;
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
      case "attach-now":
        return this._attachFiles(data.files || []);
      case "compose":
        return this._compose(data);
      case "prepare":
        return this._prepare();
      case "probe":
        return this._probe(data);
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
      let current = new URL(this.win.location.href);
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

      // Text edited in the pane goes in front of what the user typed in the page.
      let composer = this._findComposer();
      let edited = String(pkg?.text || "").trim();
      if (edited && composer) {
        let typed = this._composerText(composer).trim();
        this._insertText(composer, typed ? `${edited}\n\n${typed}` : edited);
        await this._delay(200);
      }
      if (files.length) {
        let outcome = await this._attachFiles(files);
        report.attached = outcome.attached;
        report.errors = outcome.attachErrors;
        // Every page needs time after the last file, even one that shows no
        // upload progress. Sending too early loses the file and the message.
        await this._delay(UPLOAD_MIN_WAIT_MS);
        if (outcome.attached.length) {
          await this._waitForUpload();
        }
      }
      // Mark before sending, so a second click cannot attach the same files, and
      // so a package that was just attached is not attached again on the next
      // message.
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
    // An upload starts a moment after the file is handed over. Without this wait
    // the page sends the message before the site has taken the file.
    await this._delay(UPLOAD_MIN_WAIT_MS);
    await this._delay(2000);
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
      url: this.win.location.href,
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
        this.win.addEventListener("load", resolve, { once: true });
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
    return new Promise((resolve) => this.win.setTimeout(resolve, ms));
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

    // Order of attempts, best first:
    //   1. Click the site's own attach button, then fill the file input it
    //      creates. This is what the site's own code runs, so it sticks.
    //   2. Fill a file input that is already on the page.
    //   3. Paste the files, for a site with neither.
    // A synthetic drop is deliberately last, because most sites ignore one.
    let inputsBefore = this._allFileInputs();

    if (!inputsBefore.length) {
      this._clickAttachButton();
      await this._delay(700);
    }

    let inputs = this._allFileInputs();
    let remaining = files;

    if (inputs.length) {
      // One entry per file, in order, so two files for the same input are both
      // kept. A map keyed by the input would hold only the last one.
      let plan = [];
      let leftovers = [];
      for (let spec of files) {
        let picked = this._pickInput(spec, inputs);
        if (!picked) {
          leftovers.push(spec);
          continue;
        }
        plan.push({ ...picked, spec });
      }
      // One file per change. A page reads `input.files` when the change event
      // fires, so several files in one go can be lost, and the next change needs a
      // moment for the page to notice the upload.
      {
        let first = true;
        for (let { file, spec } of plan) {
          if (!first) {
            // A site that creates its input from a menu closes that menu after one
            // file, so open it again for the next one.
            this._clickAttachButton();
            await this._delay(600);
          }
          first = false;
          // The input may be a new element, so look it up again for each file.
          let live = this._pickInput(spec, this._allFileInputs());
          let target = live?.input || null;
          if (!target) {
            attachErrors.push({ name: file.name, error: "the page closed its file input" });
            continue;
          }
          try {
            this._assignFiles(target, [file]);
            attached.push(file.name);
            // Keep the files in the input. Clearing it would make a page that
            // reads the input at send time copy the files out twice.

          } catch (e) {
            attachErrors.push({ name: file.name, error: String(e) });
          }
          await this._delay(2500);
        }
      }
      remaining = leftovers;
    }

    if (remaining.length) {
      let pasted = this._attachByPaste(remaining);
      attached.push(...pasted.attached);
      remaining = remaining.filter((spec) => !pasted.attached.includes(spec.name));
    }

    if (remaining.length) {
      let dropped = await this._attachByDrop(remaining);
      attached.push(...dropped.attached);
      for (let spec of dropped.failed) {
        attachErrors.push({ name: spec.name, error: "the page did not take the file" });
      }
    }
    return { attached, attachErrors };
  }

  /**
   * Click the site's attach button, so it builds or unlocks its file input. The
   * event is a real click, which is the only kind these sites act on.
   */
  _clickAttachButton() {
    for (let selector of this._adapter?.attachSelectors || []) {
      let candidates;
      try {
        candidates = this.document.querySelectorAll(selector);
      } catch (e) {
        continue;
      }
      for (let el of candidates) {
        if (this._isClickable(el)) {
          el.click();
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Paste the files into the message box. A site that takes pasted files calls
   * `preventDefault`, which tells us the paste was used.
   *
   * @param {object[]} specs
   * @returns {{attached: string[]}}
   */
  _attachByPaste(specs) {
    let win = this.contentWindow;
    let composer = this._findComposer();
    if (!composer) {
      return { attached: [] };
    }
    try {
      let dt = new win.DataTransfer();
      for (let spec of specs) {
        dt.items.add(this._makeFile(this._forThisPage(spec)));
      }
      composer.focus();
      let paste = new win.ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
      composer.dispatchEvent(paste);
      return { attached: paste.defaultPrevented ? specs.map((spec) => spec.name) : [] };
    } catch (e) {
      return { attached: [] };
    }
  }

  /**
   * Drag the files onto the message box. Most sites ignore a synthetic drop, so
   * this runs only when the page offers no file input and no paste handler.
   *
   * @param {object[]} specs
   * @returns {Promise<{attached: string[], failed: object[]}>}
   */
  async _attachByDrop(specs) {
    let win = this.contentWindow;
    let composer = this._findComposer();
    if (!composer) {
      return { attached: [], failed: specs };
    }
    let target = composer.closest("form") || composer;
    let names = specs.map((spec) => spec.name);
    let files = [];
    let failed = [];
    for (let spec of specs) {
      try {
        files.push(this._makeFile(this._forThisPage(spec)));
      } catch (e) {
        failed.push(spec);
      }
    }
    if (!files.length) {
      return { attached: [], failed };
    }

    let dt = new win.DataTransfer();
    for (let file of files) {
      dt.items.add(file);
    }
    // A drop must report at least one file on the drag, so the site knows that
    // files are coming and not a piece of text.
    dt.effectAllowed = "all";

    let fire = (type, extra = {}) => {
      let event = new win.DragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt,
        ...extra,
      });
      target.dispatchEvent(event);
      return event;
    };

    fire("dragenter", { button: 0, buttons: 1 });
    await this._delay(120);
    fire("dragover", { button: 0, buttons: 1 });
    await this._delay(120);
    fire("drop", { button: 0 });
    // Some pages listen on the page itself, not on the box.
    if (target !== this.document.body) {
      this.document.body.dispatchEvent(new win.DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      }));
    }
    await this._delay(120);
    fire("dragend");
    return { attached: names.filter((name) => !failed.some((spec) => spec.name === name)), failed };
  }

  /**
   * Text travels as a PDF when the page has a file input that takes documents but
   * no text. Sites that check the `accept` list, such as Gemini for its hidden
   * input, then accept the words as a small document.
   *
   * @param {object} spec
   * @returns {object}
   */
  _forThisPage(spec) {
    if (!spec.twinPDF || typeof spec.text !== "string") {
      return spec;
    }
    let inputs = this._allFileInputs();
    if (!inputs.length) {
      return spec;
    }
    let takesText = inputs.some((input) => this._accepts(input, spec.name, "text/markdown"));
    let takesPdf = inputs.some((input) => this._accepts(input, "x.pdf", "application/pdf"));
    return takesPdf && !takesText ? { ...spec, asPdf: true } : spec;
  }

  /**
   * Turn plain text into a small PDF with Helvetica text on letter pages. Only
   * Latin-1 characters survive, and the rest become "?".
   *
   * @param {string} text
   * @returns {string} The PDF as a binary string.
   */
  _textToPdf(text) {
    const WIDTH = 92;
    const PER_PAGE = 58;

    let lines = [];
    for (let raw of String(text).split("\n")) {
      let line = raw.replace(/\t/g, "    ");
      while (line.length > WIDTH) {
        let cut = line.lastIndexOf(" ", WIDTH);
        if (cut < WIDTH / 2) {
          cut = WIDTH;
        }
        lines.push(line.slice(0, cut));
        line = line.slice(cut).replace(/^ +/, "");
      }
      lines.push(line);
    }
    let pages = [];
    for (let i = 0; i < lines.length; i += PER_PAGE) {
      pages.push(lines.slice(i, i + PER_PAGE));
    }
    if (!pages.length) {
      pages.push([""]);
    }

    let escape = (line) => Array.from(line).map((ch) => {
      let code = ch.charCodeAt(0);
      if (ch === "\\" || ch === "(" || ch === ")") {
        return `\\${ch}`;
      }
      if (code < 32) {
        return " ";
      }
      if (code < 127) {
        return ch;
      }
      return code < 256 ? `\\${code.toString(8).padStart(3, "0")}` : "?";
    }).join("");

    let objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ")}] /Count ${pages.length} >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ];
    pages.forEach((pageLines, i) => {
      let stream = `BT /F1 10 Tf 12 TL 40 760 Td\n${pageLines.map((l) => `(${escape(l)}) Tj T*`).join("\n")}\nET`;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + 2 * i} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      );
    });

    let out = "%PDF-1.4\n";
    let offsets = [];
    objects.forEach((body, index) => {
      offsets.push(out.length);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    let xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let offset of offsets) {
      out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return out;
  }

  /**
   * Hand files to an input the way a file dialog does.
   *
   * The change event must be fired through the input's own constructor from the
   * page's realm, because a page that wraps `addEventListener` or compares
   * `event.target` created in another compartment can miss it.
   */
  _assignFiles(input, fileObjects) {
    let win = this.contentWindow;
    let dt = new win.DataTransfer();
    for (let file of fileObjects) {
      dt.items.add(file);
    }
    input.files = dt.files;

    let fire = (type) => {
      let event;
      try {
        event = new win.Event(type, { bubbles: true, cancelable: true, composed: true });
      } catch (e) {
        event = this.document.createEvent("Event");
        event.initEvent(type, true, true);
      }
      input.dispatchEvent(event);
    };
    fire("input");
    fire("change");
  }

  /**
   * The first file input that accepts this file. A text file that no input takes
   * as Markdown gets a second try as plain text.
   */
  _pickInput(spec, inputs = this._allFileInputs()) {
    let isText = typeof spec.text === "string";
    let variants = [spec];
    if (isText && spec.type !== "text/plain") {
      variants.push({
        ...spec,
        name: spec.name.replace(/\.[^.]+$/, "") + ".txt",
        type: "text/plain",
      });
    }
    for (let variant of variants) {
      for (let input of inputs) {
        if (this._accepts(input, variant.name, variant.type)) {
          try {
            return { input, file: this._makeFile(variant) };
          } catch (e) {
          }
        }
      }
    }
    return null;
  }

  _makeFile(spec) {
    // The File must come from the page's own window, or the page cannot read it.
    let win = this.contentWindow;
    if (spec.asPdf && typeof spec.text === "string") {
      // A page that takes documents only gets the same words as a PDF.
      return new win.File([this._toBytes(this._textToPdf(spec.text))], spec.name.replace(/\.[^.]+$/, "") + ".pdf", {
        type: "application/pdf",
      });
    }
    if (typeof spec.text === "string") {
      return new win.File([spec.text], spec.name, { type: spec.type });
    }
    let data = spec.data;
    if (typeof data !== "string") {
      data = "";
    }
    try {
      let bytes = this._toBytes(data);
      return new win.File([bytes], spec.name, { type: spec.type });
    } catch (e) {
      throw e;
    }
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
    let win = this.win;
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
    let style = this.win.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  /**
   * Describe what the page offers, so a person can write selectors for a new
   * site. It lists the message boxes, types a word into the first one so that the
   * send button appears, lists the buttons around the box, and lists the file
   * inputs. The word is removed again.
   *
   * @param {object} [options]
   * @param {boolean} [options.type] - Set false to skip typing.
   */
  async _probe({ type = true } = {}) {
    let doc = this.document;
    let describe = (el) => ({
      tag: el.localName,
      id: el.id || "",
      class: String(el.getAttribute("class") || "").slice(0, 90),
      aria: el.getAttribute("aria-label") || "",
      title: el.getAttribute("title") || "",
      testid: el.getAttribute("data-testid") || "",
      placeholder: el.getAttribute("placeholder") || "",
      role: el.getAttribute("role") || "",
      type: el.getAttribute("type") || "",
      name: el.getAttribute("name") || "",
      text: String(el.textContent || "").trim().slice(0, 30),
      usable: this._isUsable(el),
      selector: this._suggestSelector(el),
    });

    let boxes = Array.from(doc.querySelectorAll(
      "textarea, [contenteditable='true'], [contenteditable=''], [role='textbox'], input[type='text'], input[type='search']",
    )).filter((el) => this._isUsable(el));

    let result = {
      url: this.win.location.href,
      title: doc.title,
      composers: boxes.slice(0, 6).map(describe),
      sendButtons: [],
      fileInputs: [],
    };

    // Prefer the box the provider's own selectors find, so that the report also
    // tells whether those selectors work.
    let adapterBox = this._findComposer();
    let box = adapterBox || boxes[0] || null;
    result.adapter = {
      composer: !!adapterBox,
      send: false,
      files: this._allFileInputs().length,
    };
    if (box && type) {
      this._busy = true;
      try {
        this._insertText(box, "hello");
        await this._delay(900);
      } finally {
        this._busy = false;
      }
    }

    result.adapter.send = !!this._findSendButton(this._adapter?.sendSelectors || []);

    if (box) {
      // Buttons near the box: climb a few levels so the send button, which sits
      // beside the box and not inside it, is included.
      let scope = box;
      for (let i = 0; i < 6 && scope.parentElement; i++) {
        scope = scope.parentElement;
      }
      let seen = new Set();
      for (let level = box; level && level !== doc.body; level = level.parentElement) {
        for (let el of level.querySelectorAll("button, [role='button'], input[type='submit']")) {
          if (!seen.has(el) && this._isUsable(el)) {
            seen.add(el);
            result.sendButtons.push(describe(el));
          }
        }
        if (level === scope) {
          break;
        }
      }
      result.sendButtons = result.sendButtons.slice(0, 14);
    }

    result.fileInputs = Array.from(doc.querySelectorAll("input[type='file']")).map((el) => ({
      ...describe(el),
      accept: el.getAttribute("accept") || "",
      multiple: el.hasAttribute("multiple"),
    }));

    if (box && type) {
      this._busy = true;
      try {
        this._insertText(box, "");
      } finally {
        this._busy = false;
      }
    }
    return result;
  }

  /** A selector that is short and likely to survive a site update. */
  _suggestSelector(el) {
    let tag = el.localName;
    if (el.id && !/\d{3,}/.test(el.id)) {
      return `#${CSS.escape(el.id)}`;
    }
    let testid = el.getAttribute("data-testid");
    if (testid) {
      return `${tag}[data-testid='${testid}']`;
    }
    let aria = el.getAttribute("aria-label");
    if (aria) {
      return `${tag}[aria-label='${aria}']`;
    }
    let name = el.getAttribute("name");
    if (name) {
      return `${tag}[name='${name}']`;
    }
    let placeholder = el.getAttribute("placeholder");
    if (placeholder) {
      return `${tag}[placeholder='${placeholder}']`;
    }
    let cls = Array.from(el.classList).find((c) => c.length > 3 && !/\d/.test(c) && !/^[a-z]{1,3}-/.test(c));
    return cls ? `${tag}.${CSS.escape(cls)}` : tag;
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
    let dropped = [];
    let picked = [];
    try {
      dropped = win?.wrappedJSObject?.__dropped || [];
      picked = win?.wrappedJSObject?.__picked || [];
    } catch (e) {
      dropped = [];
    }
    return {
      messages: received.length,
      received,
      dropped,
      busy: this._busy,
      picked: picked.map((f) => f.name),
      directSaw: (() => {
        try {
          return win?.wrappedJSObject?.__directSaw ?? null;
        } catch (e) {
          return "unreadable";
        }
      })(),
      pending: this._pending(),
      log: this.document.getElementById("log")?.textContent || "",
    };
  }

  _selectAllText() {
    let win = this.win;
    let range = this.document.createRange();
    range.selectNodeContents(this.document.body);
    let selection = win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let text = selection.toString();
    return { length: text.length, preview: text.slice(0, 80) };
  }
}

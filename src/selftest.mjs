/*
 * Self-test entry point, reachable from the error console as
 * `Zotero.SideBrowser.selfTest()`.
 *
 * It seeds one sample paper, checks the scope and compose helpers, then drives
 * a local mock page through the real send path when `sidebrowser.testURL` is
 * set. It never sends anything to a real AI service.
 */

const PAGE_WAIT_MS = 20000;

export async function selfTest() {
  let results = [];
  let record = (name, ok, extra = {}) => {
    results.push({ name, ok: !!ok, ...extra });
  };

  // Seed a paper, so a fresh profile has something to work with.
  try {
    let { seedSamplePaper } = Zotero.SideBrowser.loadModule("src/testseed.mjs");
    let seeded = await seedSamplePaper();
    record("sample paper", !!seeded, { value: seeded?.id });
  } catch (e) {
    record("sample paper", false, { error: String(e) });
  }

  // Select it, so the scope is not empty.
  try {
    await Zotero.Promise.delay(800);
    let win = Zotero.getMainWindow();
    let pane = win?.ZoteroPane;
    let ids = pane?.itemsView?.getSortedItems?.(true) || [];
    if (pane?.itemsView && ids.length && !pane.itemsView.getSelectedObjects?.().length) {
      await pane.itemsView.selectItem(ids[0]);
      await Zotero.Promise.delay(800);
    }
    record("items in view", ids.length > 0, { value: ids.length });
  } catch (e) {
    record("select item", false, { error: String(e) });
  }

  let section = Zotero.SideBrowser.loadModule("src/section.mjs");

  // Probe-only mode: visit the live services and stop. Used to measure a new
  // service without waiting for the whole self test.
  if (Zotero.Prefs.get("sidebrowser.testProbeOnly")) {
    await Zotero.Promise.delay(2000);
    let first = section.activePane();
    if (first) {
      let { testLiveProviders } = Zotero.SideBrowser.loadModule("src/selftest-live.mjs");
      await testLiveProviders(record, first);
    }
    Zotero.debug("[Side Browser] PROBE DONE");
    return results;
  }

  record("section registered", !!section.getSectionKey(), { value: section.getSectionKey() });
  record("providers", section.getProviders().length >= 4, {
    value: section.getProviders().map((p) => p.id).join(","),
  });

  let api = section.activePane();
  record("pane open", !!api);

  if (api) {
    let pane = api.pane;
    record("pane has a browser", !!pane.browser);
    let rect = pane.root.getBoundingClientRect();
    record("pane has real size", rect.width > 100 && rect.height > 100, {
      value: { width: Math.round(rect.width), height: Math.round(rect.height) },
    });

    // The pane must sit inside the item pane, not float over the tab stack.
    let itemPane = pane.doc.getElementById("zotero-item-pane");
    let insideItemPane = !!itemPane && itemPane.contains(pane.root);
    record("pane is inside the item pane", insideItemPane);

    await api.refreshScope();
    record("scope mode", pane.scope.mode !== "none", { value: pane.scope.mode });
    record("scope items", pane.scope.items.length > 0, { value: pane.scope.items.length });

    await checkFill(record, pane);
    await checkResize(record, pane, api);
    await checkZoom(record, pane, api);
    checkLayout(record, pane);

    let text = await api.contextText();
    record("context text", text.length > 40, { value: { chars: text.length } });
    await checkPackage(record, pane);
    checkBadges(record, pane, section);

    if (pane.scope.items.length) {
      let context = Zotero.SideBrowser.loadModule("src/context.mjs");
      let pdfs = await context.collectPDFs(pane.scope.items);
      record("pdfs found", pdfs.files.length > 0, {
        value: pdfs.files.map((f) => f.name),
        skipped: pdfs.skipped,
      });
      if (pdfs.files.length) {
        let read = await context.readFiles(pdfs.files.slice(0, 1));
        record("pdf bytes", read[0].data.length > 100, {
          value: { name: read[0].name, bytes: read[0].data.length },
        });
      }
    }
  }

  try {
    let { testReaderFlow } = Zotero.SideBrowser.loadModule("src/selftest-reader.mjs");
    await testReaderFlow(record, section);
  } catch (e) {
    record("reader flow", false, { error: String(e) });
  }

  let testURL = "";
  try {
    testURL = Zotero.Prefs.get("sidebrowser.testURL") || "";
  } catch (e) {
    testURL = "";
  }
  if (testURL && api) {
    try {
      await runSendTest(api, testURL, record);
    } catch (e) {
      record("send test", false, { error: String(e && e.message || e), stack: String(e && e.stack || "").slice(0, 600) });
    }
  }

  let live = false;
  try {
    live = Zotero.Prefs.get("sidebrowser.testLive") || false;
  } catch (e) {
    live = false;
  }
  if (live && api) {
    try {
      let { testLiveProviders } = Zotero.SideBrowser.loadModule("src/selftest-live.mjs");
      await testLiveProviders(record, api);
    } catch (e) {
      record("live providers", false, { error: String(e) });
    }
  }

  try {
    await testMultiSelect(record, section);
  } catch (e) {
    record("multi select", false, { error: String(e) });
  }

  // Leave the library tab in front with the pane open, for a screenshot.
  if (!Zotero.Prefs.get("sidebrowser.testHoldMulti")) try {
    let win = Zotero.getMainWindow();
    win.Zotero_Tabs.select("zotero-pane");
    await Zotero.Promise.delay(800);
    let view = win.ZoteroPane.itemsView;
    let ids = view?.getSortedItems?.(true) || [];
    if (ids.length) {
      await view.selectItem(ids[0]);
    }
    await Zotero.Promise.delay(1500);
    section.showInWindow(win);
    // Leave the service list open, so a screenshot shows the marks.
    if (Zotero.Prefs.get("sidebrowser.testHoldPicker")) {
      await Zotero.Promise.delay(800);
      section.activePane()?.pane.root.querySelector('[data-role="provider"]')?.click();
    }
  } catch (e) {
    Zotero.debug(`[Side Browser] Could not return to the library: ${e}`);
  }

  Zotero.debug(`[Side Browser] selfTest: ${JSON.stringify(results, null, 1)}`);
  let failed = results.filter((r) => !r.ok);
  Zotero.debug(`[Side Browser] selfTest summary: ${results.length} checks, ${failed.length} failed`);
  return results;
}

/**
 * Point the pane at a mock page, push a context block, then send from the page
 * the way a person would: type into the composer and click send.
 *
 * This is the check that matters, because it exercises the send intercept and
 * not a special test message.
 */
async function runSendTest(api, testURL, record) {
  let step = (m) => Zotero.debug(`[Side Browser] sendTest: ${m}`);

  // The reader flow leaves the reader tab in front, and its pane is destroyed
  // when the tab closes. Go back to the library and take the live pane.
  let win = api.pane.doc.defaultView;
  win.Zotero_Tabs.select("zotero-pane");
  await Zotero.Promise.delay(1500);
  let fresh = Zotero.SideBrowser.loadModule("src/section.mjs").activePane();
  if (fresh) {
    api = fresh;
  }
  let pane = api.pane;

  pane.provider = {
    id: "mock",
    label: "Mock",
    url: testURL,
    composerSelectors: ["#composer"],
    sendSelectors: ["#send"],
    sendMode: "button",
    attachSelectors: ["#attach"],
    fileSelectors: ["#files"],
  };
  pane.providerID = "mock";

  step("navigate");
  api.navigate(testURL);
  if (!(await waitForPane(api, testURL))) {
    record("send: page loaded", false);
    return;
  }
  await Zotero.Promise.delay(1200);
  await api.sync();
  record("send: page loaded", true);

  // One message with the metadata and the PDF, sent the way a person sends it.
  pane.options.metadata = true;
  pane.options.selection = false;
  pane.options.annotations = false;
  pane.options.pdf = true;
  pane.options.others = false;
  pane.editedText = null;
  api.render();
  await api.syncPackage();

  await typeInPage(pane, "Summarise this.");
  await clickSend(pane);
  let state = await waitForMessages(pane, 1);
  let message = state?.received?.[0] || {};
  let names = (message.files || []).map((file) => file.name);
  record("send: one message arrives", state?.messages === 1, { value: state?.messages });
  record("send: the message keeps the user words", String(message.text || "").endsWith("Summarise this."), {
    value: message.text,
  });
  record("send: the metadata file arrives", names.includes("paper-metadata.md"), { value: names });
  record("send: the PDF file arrives", names.some((name) => name.endsWith(".pdf")), { value: names });

  const prepared = await api.prepareDrag();
  const dragButton = pane.root.querySelector('button[data-action="drag"]');
  record("drag: preparation enables native dragging", !!prepared?.paths.length && dragButton.draggable);
  const transfer = Zotero.SideBrowser.loadModule("src/file-transfer.mjs");
  if (prepared) {
    // Native dragstart supplies a writable transfer. A constructed DataTransfer
    // outside that event does not permit multiple native items in Gecko.
    const entries = [];
    transfer.setDragData({ mozSetDataAt: (...args) => entries.push(args) }, prepared.paths);
    record("drag: native data includes every file", entries.length === prepared.paths.length
      && entries[0][0] === "application/x-moz-file" && entries[0][1].path === prepared.paths[0]);
    const original = await IOUtils.read(prepared.paths.find((p) => p.endsWith(".pdf")));
    record("drag: PDF copy preserves its bytes", original.length > 100 && String.fromCharCode(...original.slice(0, 5)) === "%PDF-");
    const dragEnd = new pane.doc.defaultView.DragEvent("dragend", {
      dataTransfer: new pane.doc.defaultView.DataTransfer(),
    });
    dragButton.dispatchEvent(dragEnd);
    record("drag: canceled drag keeps prepared files", dragButton.draggable
      && await IOUtils.exists(prepared.paths[0]));
    pane.options.pdf = false;
    api.render();
    await Zotero.Promise.delay(200);
    record("drag: changing the selection clears stale files", !dragButton.draggable
      && !(await IOUtils.exists(prepared.paths[0])));
  }

  // An optional native-pointer test is driven by xdotool in the test harness.
  if (Zotero.Prefs.get("sidebrowser.testNativeDrag")) {
    await testNativeDrag(api, record);
  }

  // A page that takes pictures only gets the metadata as a picture.
  api.navigate(`${testURL}?images=1`);
  await waitForPane(api, `${testURL}?images=1`);
  await Zotero.Promise.delay(1200);
  await api.sync();
  pane.options.metadata = true;
  pane.options.pdf = true;
  pane.provider.fileMode = "images";
  pane.editedText = null;
  api.render();
  await api.syncPackage();
  await typeInPage(pane, "A page that takes pictures.");
  await clickSend(pane);
  // A new page counts from zero, so this is its first message.
  let images = await waitForMessages(pane, 1);
  let imageFiles = (images?.received?.[0] || {}).files || [];
  record("images: the metadata travels as a picture", imageFiles.length === 2
    && imageFiles.every((f) => f.type === "image/png" && f.size > 800), { value: imageFiles });

  // A page that takes PDFs only gets the picture as a PDF.
  pane.provider.fileMode = "pdf";
  pane.options.pdf = false;
  api.navigate(`${testURL}?pdfonly=1`);
  await waitForPane(api, `${testURL}?pdfonly=1`);
  await Zotero.Promise.delay(1200);
  await api.sync();
  await api.syncPackage();
  await typeInPage(pane, "A page that takes documents.");
  await clickSend(pane);
  let pdfs = await waitForMessages(pane, 1);
  let pdfOnly = (pdfs?.received?.[0] || {}).files || [];
  record("pdf only: the text travels as a PDF", pdfOnly.length === 1
    && pdfOnly[0].type === "application/pdf" && pdfOnly[0].size > 300, { value: pdfOnly });

  // Back to the plain page, and send twice: the files go with the first message
  // only.
  pane.provider.fileMode = null;
  api.navigate(testURL);
  await waitForPane(api, testURL);
  await Zotero.Promise.delay(1200);
  await api.sync();
  await api.syncPackage();
  await typeInPage(pane, "One more question.");
  await clickSend(pane);
  let again = await waitForMessages(pane, 1);
  record("send: the files go again for a new page", ((again?.received?.[0] || {}).files || []).length > 0, {
    value: (again?.received?.[0] || {}).files,
  });
  await typeInPage(pane, "And another question.");
  await clickSend(pane);
  let second = await waitForMessages(pane, 2);
  record("send: the next message has no files", (second?.messages || 0) === 2
    && ((second.received[1] || {}).files || []).length === 0, {
    value: (second?.received?.[1] || {}).files,
  });
}

async function testNativeDrag(api, record) {
  const pane = api.pane;
  pane.options.pdf = true;
  pane.provider.fileMode = "images";
  api.render();
  await api.syncPackage();
  const prepared = await api.prepareDrag();
  if (!prepared) {
    record("drag: trusted pointer test prepared files", false);
    return;
  }
  const button = pane.root.querySelector('button[data-action="drag"]');
  button.scrollIntoView({ block: "nearest" });
  await Zotero.Promise.delay(300);
  const rect = button.getBoundingClientRect();
  const browser = pane.browser.getBoundingClientRect();
  const win = pane.doc.defaultView;
  await IOUtils.writeUTF8("/tmp/sbtest/drag-ready.json", JSON.stringify({
    source: [Math.round(win.mozInnerScreenX + rect.x + rect.width / 2),
      Math.round(win.mozInnerScreenY + rect.y + rect.height / 2)],
    target: [Math.round(win.mozInnerScreenX + browser.x + browser.width / 2),
      Math.round(win.mozInnerScreenY + browser.y + 90)],
  }));
  let dropped;
  for (let i = 0; i < 100; i++) {
    dropped = await readMockState(pane);
    if (dropped?.dropped?.length) {
      break;
    }
    await Zotero.Promise.delay(250);
  }
  record("drag: trusted drop delivers native files", dropped?.dropped?.length === prepared.paths.length
    && dropped.dropped.length === 2 && dropped.dropped.every((file) => file.type === "image/png"), {
    value: dropped?.dropped,
  });
  record("drag: handled drop disarms duplicate attachments", dropped?.pending === false, { value: dropped?.pending });
  await typeInPage(pane, "Message with manually dropped files.");
  await clickSend(pane);
  const message = await waitForMessages(pane, 2);
  record("drag: manually dropped files travel once", message?.received?.[1]?.files?.length === prepared.paths.length, {
    value: message?.received?.[1]?.files,
  });
}

/** The address the pane shows, or "" when its browser is gone. */
function currentURL(pane) {
  try {
    return pane.browser?.currentURI?.spec || "";
  } catch (e) {
    return "";
  }
}

async function waitForPane(api, url) {
  let start = Date.now();
  while (Date.now() - start < PAGE_WAIT_MS) {
    await Zotero.Promise.delay(250);
    if (currentURL(api.pane).startsWith(url)) {
      return true;
    }
  }
  return false;
}

async function pageQuery(pane, name, data = {}) {
  let actor = null;
  try {
    actor = pane.browser.browsingContext?.currentWindowGlobal?.getActor("SideBrowser");
  } catch (e) {
    actor = null;
  }
  if (!actor) {
    return null;
  }
  return actor.sendQuery(name, data);
}

async function readMockState(pane) {
  return pageQuery(pane, "read-mock-state");
}

async function typeInPage(pane, text) {
  return pageQuery(pane, "insert", { text });
}

/** Wait until the page has recorded at least `count` messages. */
async function waitForMessages(pane, count, timeoutMs = 25000) {
  let start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let state = await readMockState(pane);
    if ((state?.messages || 0) >= count) {
      return state;
    }
    await Zotero.Promise.delay(400);
  }
  return readMockState(pane);
}

async function clickSend(pane) {
  // The page script ignores a click while it is busy attaching files, so wait
  // until it is idle again before sending.
  for (let i = 0; i < 60; i++) {
    let state = await pageQuery(pane, "read-mock-state");
    if (state && state.busy !== true) {
      break;
    }
    await Zotero.Promise.delay(400);
  }
  return pageQuery(pane, "click-send");
}

/**
 * Select two papers. Zotero then shows its message page, so the registered
 * section is hidden. The plugin's own icon must appear, open the pane, and give
 * it both papers as the context.
 */
async function testMultiSelect(record, section) {
  let win = Zotero.getMainWindow();
  win.Zotero_Tabs.select("zotero-pane");
  await Zotero.Promise.delay(800);

  let second = new Zotero.Item("journalArticle");
  second.setField("title", "A second paper for the multi select test");
  await second.saveTx();

  let view = win.ZoteroPane.itemsView;
  let ids = view.getSortedItems(true);
  await view.selectItems(ids);
  await Zotero.Promise.delay(1500);

  let itemPane = win.document.getElementById("zotero-item-pane");
  record("multi: item details replaced", ["message", "batch-edit-prompt"].includes(itemPane.getAttribute("view-type")), {
    value: itemPane.getAttribute("view-type"),
  });

  let wrapper = win.document.getElementById("sidebrowser-multi-button");
  record("multi: icon shown", !!wrapper && !wrapper.hidden);
  wrapper?.querySelector(".btn")?.click();
  await Zotero.Promise.delay(1800);

  let panel = win.document.getElementById("sidebrowser-multi");
  let rect = panel?.getBoundingClientRect();
  record("multi: pane visible", !!rect && rect.width > 100 && rect.height > 100, {
    value: rect && { width: Math.round(rect.width), height: Math.round(rect.height) },
  });

  let api = section.activePane();
  await api?.refreshScope();
  record("multi: both papers are the context", api?.pane.scope.items.length === ids.length, {
    value: { mode: api?.pane.scope.mode, items: api?.pane.scope.items.length, selected: ids.length },
  });
  if (api) {
    api.pane.options.metadata = true;
  }
  let multiText = (await api?.contextText()) || "";
  record("multi: context lists both", /### Paper \d/.test(multiText) && multiText.includes("second paper"), {
    value: multiText.slice(0, 120),
  });

  if (Zotero.Prefs.get("sidebrowser.testHoldMulti")) {
    return;
  }

  // Back to one paper: the registered section takes over and the icon hides.
  await view.selectItem(ids[0]);
  await Zotero.Promise.delay(1200);
  record("multi: icon hidden for one paper", !!wrapper && wrapper.hidden);
}

/**
 * The pane must fill the visible height of the item pane and follow the window.
 */
async function checkFill(record, pane) {
  let win = pane.doc.defaultView;
  let area = pane.root.closest("#zotero-view-item");
  if (!area) {
    record("fill: scroll area found", false);
    return;
  }
  await Zotero.Promise.delay(600);
  let head = pane.body.closest("collapsible-section")?.querySelector(".head");
  let headHeight = head?.getBoundingClientRect().height || 36;
  let measure = () => ({
    area: area.clientHeight,
    pane: Math.round(pane.root.getBoundingClientRect().height),
    page: Math.round(pane.root.querySelector(".sb-page").getBoundingClientRect().height),
  });
  let before = measure();
  record("fill: pane matches visible height", Math.abs(before.pane + headHeight - before.area) < 40, { value: before });
  record("fill: page is taller than wide", before.page > pane.root.getBoundingClientRect().width, { value: before });

  let originalHeight = win.outerHeight;
  win.resizeTo(win.outerWidth, 760);
  await Zotero.Promise.delay(1500);
  let smaller = measure();
  win.resizeTo(win.outerWidth, 1000);
  await Zotero.Promise.delay(1500);
  let larger = measure();
  record("fill: follows the window", larger.pane > smaller.pane + 100, { value: { smaller, larger } });
  win.resizeTo(win.outerWidth, originalHeight);
  await Zotero.Promise.delay(800);
}

/**
 * The page must be taller than wide, the three buttons must stand in the
 * requested order, and the old controls must be gone.
 */
function checkLayout(record, pane) {
  let root = pane.root;
  let buttons = Array.from(root.querySelectorAll(".sb-actions button")).map((b) => b.dataset.action);
  record("layout: buttons in order", buttons.join(",") === "drag,edit,copy", { value: buttons });
  record("layout: no attach button", !root.querySelector('button[data-action="attach"]'));
  record("layout: no pencil", !root.querySelector('button[data-action="composer"]'));
  record("layout: the edit box starts hidden", pane.ui.editor.hidden === true);
  record("layout: no status line", !root.querySelector(".sb-status"));
  record("layout: no list checkbox", !root.querySelector('[data-role="includeList"]'));
  let kinds = Array.from(root.querySelectorAll(".sb-send label[data-kind]")).map((l) => l.dataset.kind);
  record("layout: five send options", kinds.join(",") === "metadata,selection,annotations,pdf,others", { value: kinds });
}

/** A valid PDF with two image-only pages and no text content. */
function imageOnlyPDF() {
  const stream = "q 160 0 0 160 20 20 cm /Im1 Do Q";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R /Resources << /XObject << /Im1 6 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R /Resources << /XObject << /Im1 6 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 25 >>\nstream\nFF000000FF000000FFFFFFFF>\nendstream",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  return out + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

/** Build the five kinds of file for the sample paper and check each one. */
async function checkPackage(record, pane) {
  let pkg = Zotero.SideBrowser.loadModule("src/package.mjs");
  let selection = { text: "Selected sentence for the test.", pageLabel: "1", pageIndex: 0 };
  let built = await pkg.buildPackage({
    items: pane.scope.items,
    selection,
    attachmentItem: null,
    options: { metadata: true, selection: true, annotations: true, pdf: true, others: true },
  });
  let transfer = Zotero.SideBrowser.loadModule("src/file-transfer.mjs");
  let imageBuilt = await transfer.preparePackage(built, "images", pane.doc);
  record("conversion: PDF and text become PNG files", !imageBuilt.skipped.some((f) => f.reason !== "none")
    && imageBuilt.files.length >= 3 && imageBuilt.files.every((f) => f.type === "image/png"), {
    value: { files: imageBuilt.files.map((f) => ({ name: f.name, size: f.data?.length })), skipped: imageBuilt.skipped },
  });
  // Raster-only two-page PDF: no text layer exists to extract.
  const fixture = await transfer.preparePackage({
    files: [{ name: "scan.pdf", type: "application/pdf", data: imageOnlyPDF(), isPdf: true }], skipped: [],
  }, "images", pane.doc);
  record("conversion: every scanned PDF page becomes an image", fixture.skipped.length === 0
    && fixture.files.length === 2
    && fixture.files.every((f, index) => f.name === `scan-page-00${index + 1}.png`
      && f.data.startsWith("\x89PNG")), {
    value: { names: fixture.files.map((f) => f.name), skipped: fixture.skipped },
  });
  for (const file of fixture.files) {
    await IOUtils.write(PathUtils.join(PathUtils.tempDir, file.name),
      Uint8Array.from(file.data, (ch) => ch.charCodeAt(0)));
  }
  const malformed = await transfer.preparePackage({
    files: [{ name: "broken.pdf", type: "application/pdf", isPdf: true, data: "not a PDF" }], skipped: [],
  }, "images", pane.doc);
  record("conversion: invalid PDF reports an error", malformed.files.length === 0 && malformed.skipped.length === 1);
  const diskText = await transfer.preparePackage({ files: [
    { name: "note.txt", type: "text/plain", data: "Text from disk" },
    { name: "note.md", type: "text/markdown", text: "Another text" },
  ], skipped: [] }, "images", pane.doc);
  record("conversion: local text files become images with unique names", diskText.skipped.length === 0
    && diskText.files.length === 2 && diskText.files.every((f) => f.type === "image/png")
    && new Set(diskText.files.map((f) => f.name)).size === 2);
  const policies = Zotero.SideBrowser.loadModule("src/providers/registry.mjs").DEFAULT_PROVIDERS;
  record("conversion: Leo and Euria use page images", ["brave", "euria"].every((id) =>
    policies.find((p) => p.id === id)?.fileMode === "images"));
  record("conversion: Duck.ai uses PDFs for text", policies.find((p) => p.id === "duckai")?.fileMode === "pdf");
  const plain = await transfer.preparePackage(built, null, pane.doc);
  record("conversion: other providers keep the original PDF", plain === built);
  let names = built.files.map((f) => f.name);
  record("package: metadata file", names.includes("paper-metadata.md"), { value: names });
  record("package: selection file", names.includes("selected-text.md"));
  record("package: PDF file", names.some((n) => n.endsWith(".pdf")));
  let text = built.files.find((f) => f.name === "selected-text.md");
  record("package: selection text is inside", !!text?.text?.includes("Selected sentence"));
  record("package: text files are text", built.files
    .filter((f) => f.name.endsWith(".md"))
    .every((f) => typeof f.text === "string" && f.type === "text/markdown"));
  record("package: text files can change shape", built.files
    .filter((f) => f.name.endsWith(".md"))
    .every((f) => f.fromText === true));
  record("package: PDF is binary", built.files
    .filter((f) => f.name.endsWith(".pdf"))
    .every((f) => typeof f.data === "string" && f.data.length > 100));
  let none = await pkg.buildPackage({
    items: pane.scope.items,
    selection: null,
    attachmentItem: null,
    options: { metadata: false, selection: false, annotations: false, pdf: false, others: false },
  });
  record("package: nothing checked gives no files", none.files.length === 0);
  let skipText = await pkg.buildPackage({
    items: pane.scope.items,
    selection,
    attachmentItem: null,
    options: { metadata: true, selection: true, annotations: false, pdf: true, others: false },
    skipText: true,
  });
  record("package: skipText keeps only the PDF", skipText.files.length === 1 && skipText.files[0].name.endsWith(".pdf"), {
    value: skipText.files.map((f) => f.name),
  });
}

/** Drag the handle, then double-click it. */
async function checkResize(record, pane, api) {
  let win = pane.doc.defaultView;
  let handle = pane.ui.resizer;
  record("resize: handle is shown", !!handle && !handle.hidden);
  if (!handle) {
    return;
  }
  let fill = Math.round(pane.root.getBoundingClientRect().height);
  let fire = (type, y) => handle.dispatchEvent(new win.PointerEvent(type, {
    bubbles: true, cancelable: true, button: 0, pointerId: 7, clientY: y,
  }));
  fire("pointerdown", 300);
  fire("pointermove", 200);
  fire("pointerup", 200);
  let shorter = Math.round(pane.root.getBoundingClientRect().height);
  record("resize: drag up makes it shorter", shorter === Math.max(320, fill - 100), { value: { fill, shorter } });
  record("resize: height is saved", Number(Zotero.Prefs.get("sidebrowser.paneHeight")) === shorter);

  // A dragged height must survive a change of the window size.
  api.resizer.fit();
  record("resize: dragged height holds", Math.round(pane.root.getBoundingClientRect().height) === shorter);

  fire("pointerdown", 300);
  fire("pointermove", 380);
  fire("pointerup", 380);
  let taller = Math.round(pane.root.getBoundingClientRect().height);
  record("resize: drag down makes it taller", taller === shorter + 80, { value: { shorter, taller } });

  handle.dispatchEvent(new win.MouseEvent("dblclick", { bubbles: true }));
  await Zotero.Promise.delay(300);
  let back = Math.round(pane.root.getBoundingClientRect().height);
  record("resize: double-click fills the window again", Math.abs(back - fill) < 4 && Number(Zotero.Prefs.get("sidebrowser.paneHeight")) === 0, {
    value: { fill, back },
  });
}

/** The two toolbar buttons change the page zoom and the zoom is remembered. */
async function checkZoom(record, pane, api) {
  let zoomOf = () => {
    try {
      return Math.round(pane.browser.browsingContext.fullZoom * 100);
    } catch (e) {
      return -1;
    }
  };
  record("zoom: buttons exist", !!pane.root.querySelector('button[data-action="zoomin"]')
    && !!pane.root.querySelector('button[data-action="zoomout"]'));
  let order = Array.from(pane.root.querySelectorAll(".sb-toolbar > *")).map((el) => el.dataset.action || el.dataset.role);
  record("zoom: buttons stand before the external link", order.indexOf("zoomout") < order.indexOf("zoomin")
    && order.indexOf("zoomin") < order.indexOf("external"), { value: order });

  Zotero.Prefs.set("sidebrowser.zoomPercent", 100);
  api.applyZoom();
  record("zoom: starts at 100%", zoomOf() === 100, { value: zoomOf() });
  pane.root.querySelector('button[data-action="zoomin"]').click();
  record("zoom: in goes to 110%", zoomOf() === 110 && Zotero.Prefs.get("sidebrowser.zoomPercent") === 110, { value: zoomOf() });
  pane.root.querySelector('button[data-action="zoomout"]').click();
  pane.root.querySelector('button[data-action="zoomout"]').click();
  record("zoom: out twice goes to 90%", zoomOf() === 90, { value: zoomOf() });
  for (let i = 0; i < 20; i++) {
    pane.root.querySelector('button[data-action="zoomout"]').click();
  }
  record("zoom: stops at 30%", zoomOf() === 30 && pane.root.querySelector('button[data-action="zoomout"]').disabled, { value: zoomOf() });
  Zotero.Prefs.set("sidebrowser.zoomPercent", 100);
  api.applyZoom();
}

/**
 * Add a small EPUB to the sample paper, so the "Other attachments" option has
 * something real to send. The file is a short plain-text file with the EPUB
 * extension, which is enough to prove that it travels.
 */
async function addOtherAttachment(pane) {
  let paper = pane.scope.items[0];
  if (!paper) {
    return null;
  }
  let name = "sidebrowser-selftest.epub";
  let path = PathUtils.join(PathUtils.tempDir, name);
  await IOUtils.writeUTF8(path, "EPUB test file for the AI sidebar self test.\n");
  let existing = paper.getAttachments()
    .map((id) => Zotero.Items.get(id))
    .find((item) => item?.attachmentFilename === name);
  if (existing) {
    return existing;
  }
  return Zotero.Attachments.importFromFile({
    file: path,
    parentItemID: paper.id,
    contentType: "application/epub+zip",
  });
}

/**
 * Drive the mock page's own attach button and input, and check that the page is
 * told about every file. This checks the attach path on its own, without the
 * send timing of the bigger test.
 */
/**
 * Drive the mock page's own attach button and input, and check that the page is
 * told about every file. This checks the attach path on its own, without the
 * send timing of the bigger test.
 */

/**
 * The service list carries the marks from the readme lists, and picking a row
 * switches the service.
 */
function checkBadges(record, pane, section) {
  let marks = (id) => (section.getProviders().find((p) => p.id === id) || {}).badges || [];
  record("badges: every built-in service is free", section.getProviders()
    .filter((p) => !p.custom).every((p) => p.badges.includes("free")));
  record("badges: Euria is free, private, and eco", ["free", "privacy", "eco"]
    .every((mark) => marks("euria").includes(mark)), { value: marks("euria") });
  record("providers: Mistral is available", section.getProviders().some((p) => p.id === "mistral"));
  record("badges: Mistral is free and eco", marks("mistral").join(",") === "free,eco", { value: marks("mistral") });
  record("badges: Lumo is free and private", marks("lumo").join(",") === "free,privacy", { value: marks("lumo") });
  record("badges: ChatGPT is free only", marks("chatgpt").join(",") === "free", { value: marks("chatgpt") });

  // The button shows the current service and its marks.
  let shown = pane.root.querySelector('[data-role="providerName"]').textContent;
  record("badges: the button names the service", shown === pane.provider.label, { value: shown });
  let buttonBadges = Array.from(pane.root.querySelectorAll('[data-role="providerBadges"] .sb-badge'))
    .map((el) => el.dataset.badge);
  record("badges: the button shows the marks", buttonBadges.join(",") === (pane.provider.badges || []).join(","), {
    value: buttonBadges,
  });

  // The list opens, shows one row per service with its marks, and selects.
  let trigger = pane.root.querySelector('[data-role="provider"]');
  trigger.click();
  let list = pane.root.querySelector('[data-role="providerList"]');
  record("badges: the list opens", list.hidden === false);
  let style = pane.doc.defaultView.getComputedStyle(list);
  // `rgb(r, g, b)` has no alpha, and that is the point: the page must not show
  // through the list. `rgba(..., a)` with a below one is transparent.
  let opaque = (value) => {
    let parts = String(value).match(/rgba?\(([^)]+)\)/);
    if (!parts) {
      return false;
    }
    let fields = parts[1].split(",").map((v) => v.trim());
    return fields.length === 3 || Number(fields[3]) === 1;
  };
  record("badges: the list is opaque", opaque(style.backgroundColor) && style.opacity === "1", {
    value: { background: style.backgroundColor, opacity: style.opacity, image: style.backgroundImage },
  });
  let rows = Array.from(list.querySelectorAll(".sb-picker-row"));
  record("badges: one row for each service", rows.length === section.getProviders().length, { value: rows.length });
  let euriaRow = rows.find((row) => row.dataset.provider === "euria");
  let euriaMarks = Array.from(euriaRow?.querySelectorAll(".sb-badge") || []).map((el) => el.dataset.badge);
  record("badges: the row shows its marks", euriaMarks.join(",") === "free,privacy,eco", { value: euriaMarks });
  let icons = Array.from(euriaRow?.querySelectorAll(".sb-badge svg") || []);
  record("badges: each mark has an icon", icons.length === 3
    && icons.every((svg) => svg.namespaceURI === "http://www.w3.org/2000/svg"
      && svg.getBoundingClientRect().width >= 10), {
    value: icons.map((svg) => ({
      ns: svg.namespaceURI,
      width: Math.round(svg.getBoundingClientRect().width),
      fill: svg.querySelector("path")?.getAttribute("fill"),
    })),
  });

  euriaRow?.dispatchEvent(new pane.doc.defaultView.MouseEvent("click", { bubbles: true }));
  record("badges: picking a row switches service", Zotero.Prefs.get("sidebrowser.provider") === "euria", {
    value: Zotero.Prefs.get("sidebrowser.provider"),
  });
  record("badges: the list closes after a pick", list.hidden === true);

  // Put the service back, so the rest of the test is not affected.
  section.activePane()?.selectProvider("chatgpt");
}

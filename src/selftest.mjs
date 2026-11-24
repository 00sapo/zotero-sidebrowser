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
    await runSendTest(api, testURL, record);
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
  let pane = api.pane;

  // The reader flow leaves the reader tab in front, and a page in a hidden tab
  // has no layout, so the message box would count as not visible.
  let win = pane.doc.defaultView;
  win.Zotero_Tabs.select("zotero-pane");
  await Zotero.Promise.delay(1200);

  pane.provider = {
    id: "mock",
    label: "Mock",
    url: testURL,
    composerSelectors: ["#composer"],
    sendSelectors: ["#send"],
    sendMode: "button",
    fileSelectors: ["#files"],
    acceptsDocuments: true,
  };
  pane.providerID = "mock";

  api.navigate(testURL);
  let loaded = await waitForPane(api, testURL);
  record("mock page loaded", loaded, { value: currentURL(pane) });
  if (!loaded) {
    return;
  }
  await Zotero.Promise.delay(800);

  await api.refreshScope();
  let info = await pageQuery(pane, "prepare");
  record("mock page has a message box", info?.hasComposer === true, { value: info });
  // Check metadata and the PDF, so the message must carry two kinds of file.
  pane.options.metadata = true;
  pane.options.pdf = true;
  pane.options.selection = false;
  pane.options.annotations = false;
  pane.options.others = false;
  pane.textInserted = false;
  api.render();
  await api.syncPackage();
  let armed = await readMockState(pane);
  record("package is armed in the page", armed?.pending === true, { value: armed?.pending });

  // Type the user's own words, then click send. The page script must stop that
  // click, attach the files, wait, and send again.
  let typed = await typeInPage(pane, "Please summarise this.");
  record("typed in the page", typed?.ok === true, { value: typed });
  let clicked = await clickSend(pane);
  record("clicked send in the page", clicked?.ok === true, { value: clicked });
  await Zotero.Promise.delay(6000);

  let state = await readMockState(pane);
  record("page received one message", state?.messages === 1, { value: state?.messages });
  let message = state?.received?.[0] || {};
  let names = (message.files || []).map((file) => file.name);
  record("message keeps the user words", message.text === "Please summarise this.", {
    value: message.text,
  });
  record("message carries the metadata file", names.includes("paper-metadata.md"), { value: names });
  record("message carries the PDF file", names.some((name) => name.endsWith(".pdf")), { value: names });
  let metadataFile = (message.files || []).find((file) => file.name === "paper-metadata.md");
  record("metadata file has content", (metadataFile?.size || 0) > 40, { value: metadataFile?.size });
  record("package is spent after the send", state?.pending === false, { value: state?.pending });

  // A second message in the same conversation carries no files.
  await typeInPage(pane, "And a second question.");
  await clickSend(pane);
  await Zotero.Promise.delay(1500);
  let second = await readMockState(pane);
  record("second message has no files", second?.messages === 2 && (second.received[1].files || []).length === 0, {
    value: second?.received?.[1]?.files,
  });

  // "Attach files" attaches now, and the next send does not repeat it.
  pane.options.metadata = true;
  pane.options.pdf = false;
  pane.textInserted = false;
  pane.selection = null;
  api.render();
  await api.syncPackage();
  let attach = pane.root.querySelector('button[data-action="attach"]');
  attach.click();
  await Zotero.Promise.delay(4000);
  await typeInPage(pane, "Third question.");
  await clickSend(pane);
  await Zotero.Promise.delay(1500);
  let third = await readMockState(pane);
  record("attach now sends the file once", third?.messages === 3
    && (third.received[2].files || []).map((f) => f.name).join(",") === "paper-metadata.md", {
    value: third?.received?.[2]?.files,
  });
}

function currentURL(pane) {
  try {
    return pane.browser.currentURI?.spec || "";
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

async function readPageContext(pane) {
  let state = await pageQuery(pane, "read-mock-state");
  return state?.context || "";
}

async function readMockState(pane) {
  return pageQuery(pane, "read-mock-state");
}

async function typeInPage(pane, text) {
  return pageQuery(pane, "insert", { text });
}

async function clickSend(pane) {
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
  record("multi: context lists both", ((await api?.contextText()) || "").includes("### Paper 2"));

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
  record("layout: buttons in order", buttons.join(",") === "attach,insert,copy", { value: buttons });
  record("layout: no pencil", !root.querySelector('button[data-action="composer"]'));
  record("layout: no text box", !root.querySelector("textarea"));
  record("layout: no status line", !root.querySelector(".sb-status"));
  record("layout: no list checkbox", !root.querySelector('[data-role="includeList"]'));
  let kinds = Array.from(root.querySelectorAll(".sb-send label[data-kind]")).map((l) => l.dataset.kind);
  record("layout: five send options", kinds.join(",") === "metadata,selection,annotations,pdf,others", { value: kinds });
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
  let names = built.files.map((f) => f.name);
  record("package: metadata file", names.includes("paper-metadata.md"), { value: names });
  record("package: selection file", names.includes("selected-text.md"));
  record("package: PDF file", names.some((n) => n.endsWith(".pdf")));
  let text = built.files.find((f) => f.name === "selected-text.md");
  record("package: selection text is inside", !!text?.text?.includes("Selected sentence"));
  record("package: text files are text", built.files
    .filter((f) => f.name.endsWith(".md"))
    .every((f) => typeof f.text === "string" && f.type === "text/markdown"));
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

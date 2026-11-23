/*
 * Self-test entry point, reachable from the error console as
 * `Zotero.SideBrowser.selfTest()`.
 *
 * It seeds one sample paper, checks the context helpers, and then exercises the
 * real send path against a local mock page when `sidebrowser.testURL` is set.
 * It never sends anything to a real AI service.
 */

const MOCK_COLLECT_WAIT_MS = 3000;

export async function selfTest() {
  let step = (m) => Zotero.debug(`[Side Browser] selfTest step: ${m}`);
  step("begin");
  let results = [];
  let record = (name, ok, extra = {}) => {
    results.push({ name, ok: !!ok, ...extra });
  };

  let sidebar = Zotero.SideBrowser?.getActiveSidebar?.() || null;

  step("seeding");
  // Seed a paper so the context has content in a fresh profile.
  try {
    let { seedSamplePaper } = Zotero.SideBrowser.loadModule("src/testseed.mjs");
    let seeded = await seedSamplePaper();
    record("sample paper", !!seeded, { value: seeded?.id });
  } catch (e) {
    record("sample paper", false, { error: String(e) });
  }

  step("selecting");
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

  sidebar = Zotero.SideBrowser?.getActiveSidebar?.() || null;
  record("sidebar exists", !!sidebar);
  if (!sidebar) {
    Zotero.debug(`[Side Browser] selfTest: ${JSON.stringify(results)}`);
    return results;
  }

  step("refreshing scope");
  await sidebar._refreshScope();
  record("providers", sidebar.providers.length >= 4, {
    value: sidebar.providers.map((p) => p.id).join(","),
  });
  record("scope mode", sidebar.scope.mode !== "none", { value: sidebar.scope.mode });
  record("scope items", sidebar.scope.items.length > 0, {
    value: sidebar.scope.items.length,
  });
  record("composer created", !!sidebar.input);
  record("checkbox count", Object.keys(sidebar.checkboxes).length === 5);

  let items = sidebar.scope.items;
  if (items.length) {
    let context = Zotero.SideBrowser.loadModule("src/context.mjs");
    record("describeItems", context.describeItems(items).length > 40);
    step("collecting pdfs");
    let pdfs = await context.collectPDFs(items);
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
    // Point the sidebar at a page that accepts a PDF, so this check measures the
    // compose logic and not whatever page happens to be loaded.
    sidebar.pageInfo = {
      fileInputs: [{ accept: "application/pdf", multiple: true }],
    };
    // Re-evaluate the PDF checkbox now that the page accepts documents again.
    sidebar._updateAttachmentAvailability();
    let composed = sidebar._compose();
    record("compose", composed.text.length > 100 && composed.items.length > 0, {
      value: { chars: composed.text.length, items: composed.items.length },
    });
    sidebar.pageInfo = null;
  }

  // End-to-end check against a local mock page.
  try {
    let { testToggle } = Zotero.SideBrowser.loadModule("src/selftest-ui.mjs");
    await testToggle(record, sidebar);
  } catch (e) {
    record("toggle", false, { error: String(e) });
  }

  try {
    let { testReaderFlow } = Zotero.SideBrowser.loadModule("src/selftest-reader.mjs");
    await testReaderFlow(record, sidebar);
  } catch (e) {
    record("reader flow", false, { error: String(e) });
  }

  let live = "";
  try {
    live = Zotero.Prefs.get("sidebrowser.testLive") || false;
  } catch (e) {
    live = false;
  }
  if (live) {
    try {
      let { testLiveProviders } = Zotero.SideBrowser.loadModule("src/selftest-live.mjs");
      await testLiveProviders(record, sidebar);
    } catch (e) {
      record("live providers", false, { error: String(e) });
    }
  }

  let testURL = "";
  try {
    testURL = Zotero.Prefs.get("sidebrowser.testURL") || "";
  } catch (e) {
    testURL = "";
  }
  step(`testURL="${testURL}"`);
  if (testURL && sidebar) {
    step("send test");
    await runSendTest(sidebar, testURL, record);
    step("send test done");
  }

  Zotero.debug(`[Side Browser] selfTest: ${JSON.stringify(results, null, 1)}`);
  return results;
}

/**
 * Drive the full path: navigate, set the provider adapter, insert the composed
 * prompt, attach the PDF, click send, then read the page state back.
 */
async function runSendTest(sidebar, testURL, record) {
  sidebar.provider = {
    id: "mock",
    label: "Mock",
    url: testURL,
    composerSelectors: ["#composer"],
    sendSelectors: ["#send"],
    sendMode: "button",
    fileSelectors: ["#files"],
    acceptsDocuments: true,
  };
  sidebar._fillProviders();
  await sidebar.open();
  // `open()` may already be navigating to the provider, so navigate explicitly
  // and wait for the new page instead of reusing the current one.
  sidebar._navigate(testURL);
  for (let i = 0; i < 60; i++) {
    await Zotero.Promise.delay(250);
    let current = sidebar._currentURL();
    if (current === testURL && sidebar._pageLoaded) {
      break;
    }
  }
  Zotero.debug(`[Side Browser] selfTest: navigated to ${sidebar._currentURL()}`);

  for (let i = 0; i < 40; i++) {
    await Zotero.Promise.delay(250);
    let a = sidebar._getActor();
    if (a) {
      Zotero.debug(`[Side Browser] selfTest: actor found after ${i * 250}ms`);
      break;
    }
    if (i % 8 === 0) {
      Zotero.debug(`[Side Browser] selfTest: waiting for actor, url=${sidebar._currentURL()}`);
    }
  }
  let actor = sidebar._getActor();
  record("actor reached", !!actor);
  if (!actor) {
    return;
  }
  await sidebar._applyAdapter();
  await Zotero.Promise.delay(1000);

  let composed = sidebar._compose();
  let files = [];
  if (composed.items.length) {
    let context = Zotero.SideBrowser.loadModule("src/context.mjs");
    let pdfs = await context.collectPDFs(composed.items);
    if (pdfs.files.length) {
      files = await context.readFiles(pdfs.files);
    }
  }
  record("prompt ready", composed.text.length > 0, {
    value: { chars: composed.text.length, files: files.length },
  });

  let result = await actor.sendQuery("compose", {
    text: composed.text,
    files,
    send: true,
  });
  record("compose sent", !!result?.ok, { value: result });

  await Zotero.Promise.delay(MOCK_COLLECT_WAIT_MS);
  let state = await actor.sendQuery("current-url", {});
  record("page url", state?.url === testURL, { value: state?.url });

  let probe = Zotero.SideBrowser.loadModule("src/selftest-probe.mjs");
  let received = await probe.readMockState(actor);
  // The page counter is authoritative: it only increments inside the page.
  let arrived = received?.messages >= 1 || /messages=1/.test(received?.log || "");
  record("page received message", arrived, { value: received });
  if (received?.received?.[0]) {
    record("message has prompt", received.received[0].text.length > 100, {
      value: { chars: received.received[0].text.length },
    });
    record("message has pdf", received.received[0].files?.[0]?.type === "application/pdf", {
      value: received.received[0].files,
    });
  }
}

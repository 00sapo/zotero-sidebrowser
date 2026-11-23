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

    let composed = api.compose();
    record("compose", composed.text.length > 40, {
      value: { chars: composed.text.length, items: composed.items.length },
    });

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
  await api.showContext();
  record("context pushed", (await readPageContext(pane)).length > 40, {
    value: (await readPageContext(pane)).length,
  });

  // Type the user's own words, then click send. The page records what arrived.
  await typeInPage(pane, "Please summarise this.");
  await clickSend(pane);
  await Zotero.Promise.delay(2500);

  let state = await readMockState(pane);
  record("page received one message", state?.messages === 1, { value: state?.messages });
  let message = state?.received?.[0] || {};
  record("message carries the context", String(message.text || "").includes("Title:"), {
    value: { chars: String(message.text || "").length },
  });
  record("message keeps the user words", String(message.text || "").includes("Please summarise this."));
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
  record("multi: prompt lists both", (api?.compose().text.match(/Paper \d/g) || []).length >= 2);

  if (Zotero.Prefs.get("sidebrowser.testHoldMulti")) {
    return;
  }

  // Back to one paper: the registered section takes over and the icon hides.
  await view.selectItem(ids[0]);
  await Zotero.Promise.delay(1200);
  record("multi: icon hidden for one paper", !!wrapper && wrapper.hidden);
}

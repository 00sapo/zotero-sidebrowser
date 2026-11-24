/*
 * Live provider check used by the self test.
 *
 * Visits each built-in AI service in the pane and records what the page script
 * finds: the final address, the message box, the send button, and the file
 * inputs. This is what tells us whether the per-site selectors still work, and
 * it is the tool for measuring a new service.
 *
 * Set `sidebrowser.testLive` to true to run it. Set `sidebrowser.testLiveOnly`
 * to a comma-separated list of provider ids to visit only those.
 */

const WAIT_FOR_PAGE_MS = 25000;
const SETTLE_MS = 9000;

export async function testLiveProviders(record, api) {
  let section = Zotero.SideBrowser.loadModule("src/section.mjs");
  let only = String(Zotero.Prefs.get("sidebrowser.testLiveOnly") || "")
    .split(",").map((id) => id.trim()).filter(Boolean);
  let results = [];
  let pane = api.pane;

  for (let provider of section.getProviders().filter((p) => !p.custom)) {
    if (only.length && !only.includes(provider.id)) {
      continue;
    }
    pane.provider = provider;
    pane.providerID = provider.id;
    api.navigate(provider.url);
    await waitForPage(pane, provider.url);
    await Zotero.Promise.delay(SETTLE_MS);

    let probe = null;
    try {
      let actor = actorOf(pane);
      if (actor) {
        await actor.sendQuery("set-adapter", { adapter: adapterOf(provider) });
        probe = await actor.sendQuery("probe", { type: true });
      }
    } catch (e) {
      probe = { error: String(e) };
    }
    Zotero.debug(`[Side Browser] PROBE ${provider.id} ${JSON.stringify(probe)}`);

    let adapter = probe?.adapter || {};
    let entry = {
      provider: provider.id,
      url: urlOf(pane),
      composer: !!adapter.composer,
      sendButton: !!adapter.send,
      fileInputs: adapter.files || 0,
    };
    results.push(entry);
    Zotero.debug(`[Side Browser] LIVE ${JSON.stringify(entry)}`);
    // A provider passes when its selectors find the box and, after typing, the
    // send button.
    record(`live ${provider.id}`, entry.composer && entry.sendButton, { value: entry });
  }
  return results;
}

function adapterOf(provider) {
  return {
    composerSelectors: provider.composerSelectors,
    sendSelectors: provider.sendSelectors,
    sendMode: provider.sendMode,
    fileSelectors: provider.fileSelectors,
  };
}

function actorOf(pane) {
  try {
    return pane.browser.browsingContext?.currentWindowGlobal?.getActor("SideBrowser") || null;
  } catch (e) {
    return null;
  }
}

function urlOf(pane) {
  try {
    return pane.browser.currentURI?.spec || "";
  } catch (e) {
    return "";
  }
}

async function waitForPage(pane, wanted) {
  let host = "";
  try {
    host = new URL(wanted).hostname.replace(/^www\./, "");
  } catch (e) {
    host = "";
  }
  for (let i = 0; i < WAIT_FOR_PAGE_MS / 250; i++) {
    await Zotero.Promise.delay(250);
    let current = urlOf(pane);
    if (current && host && current.includes(host)) {
      return true;
    }
  }
  return false;
}

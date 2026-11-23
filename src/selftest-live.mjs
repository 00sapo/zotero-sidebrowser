/*
 * Live provider check used by the self test.
 *
 * Visits each built-in AI service in the pane and records what the actor sees:
 * the final address, whether a composer exists, and which file inputs the page
 * offers. This is what tells us whether the per-site selectors still work.
 */

const WAIT_FOR_PAGE_MS = 20000;

export async function testLiveProviders(record, api) {
  let section = Zotero.SideBrowser.loadModule("src/section.mjs");
  let results = [];
  let pane = api.pane;

  for (let provider of section.getProviders().filter((p) => !p.custom)) {
    pane.provider = provider;
    pane.providerID = provider.id;
    api.navigate(provider.url);
    await waitForPage(pane, provider.url);
    await Zotero.Promise.delay(2000);

    let info = null;
    try {
      let actor = actorOf(pane);
      info = actor ? await actor.sendQuery("prepare", {}) : null;
    } catch (e) {
      info = { error: String(e) };
    }

    let entry = {
      provider: provider.id,
      url: urlOf(pane),
      composer: !!info?.hasComposer,
      fileInputs: info?.fileInputs || [],
    };
    results.push(entry);
    record(`live ${provider.id}`, !!entry.url, { value: entry });
  }

  return results;
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
    host = new URL(wanted).hostname;
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

/*
 * Live provider check used by the self test.
 *
 * Visits each built-in AI service in the sidebar and records what the actor can
 * see: the final URL, whether a composer exists, and which file inputs the page
 * offers. This is what tells us whether the per-site selectors still work.
 */

const WAIT_FOR_PAGE_MS = 15000;

export async function testLiveProviders(record, sidebar) {
  let step = (m) => Zotero.debug(`[Side Browser] liveTest: ${m}`);
  let results = [];

  for (let provider of sidebar.providers.filter((p) => !p.custom)) {
    step(`visiting ${provider.id}`);
    sidebar._selectProvider(provider.id, true);
    await waitForPage(sidebar, provider.url);
    await Zotero.Promise.delay(2000);

    let info = null;
    try {
      let actor = await sidebar._waitForActor();
      if (actor) {
        await sidebar._applyAdapter();
        info = await actor.sendQuery("prepare", {});
      }
    } catch (e) {
      info = { error: String(e) };
    }

    let entry = {
      provider: provider.id,
      url: sidebar._currentURL(),
      composer: !!info?.hasComposer,
      fileInputs: info?.fileInputs || [],
    };
    results.push(entry);
    record(`live ${provider.id}`, true, { value: entry });
  }

  step("done");
  return results;
}

async function waitForPage(sidebar, wanted) {
  let host = "";
  try {
    host = new URL(wanted).hostname;
  } catch (e) {
    host = "";
  }
  for (let i = 0; i < WAIT_FOR_PAGE_MS / 250; i++) {
    await Zotero.Promise.delay(250);
    let current = sidebar._currentURL();
    if (current && host && current.includes(host) && sidebar._pageLoaded) {
      return true;
    }
  }
  return false;
}

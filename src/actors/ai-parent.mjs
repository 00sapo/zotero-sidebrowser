/*
 * Window actor parent for the AI page.
 *
 * The child cannot reach chrome, so it forwards the events that need a decision
 * here. This side holds no state of its own: it finds the pane that owns the
 * message and hands the data over.
 */

export class SideBrowserParent extends JSWindowActorParent {
  receiveMessage({ name, data }) {
    let section = Zotero.SideBrowser?.loadModule?.("src/section.mjs");
    let embedder = this.browsingContext?.embedderElement;
    let pane = section?.paneForBrowser(embedder);

    if (name === "debug") {
      Zotero.debug(`[Side Browser] page: ${data.message}`);
      return;
    }

    if (name === "link-click") {
      if (!pane) {
        // No pane claims this page, so send the link to the system browser
        // rather than leaving the user with a dead click.
        Zotero.launchURL(data.href);
        return;
      }
      pane.handleLinkClick(data);
      return;
    }

    if (name === "send-prepped") {
      pane?.reportSendPrepared(data);
    }
  }
}

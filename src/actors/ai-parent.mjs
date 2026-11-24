/*
 * Window actor parent for the AI page.
 *
 * The child cannot reach chrome, so it forwards the events that need a decision
 * here. This side holds no state of its own: it finds the pane that owns the
 * message and hands the data over.
 */

export class SideBrowserParent extends JSWindowActorParent {
  receiveMessage({ name, data }) {
    if (name === "debug") {
      Zotero.debug(`[Side Browser] page: ${data.message}`);
      return undefined;
    }

    let section = Zotero.SideBrowser?.loadModule?.("src/section.mjs");
    let embedder = this.browsingContext?.embedderElement;
    let pane = section?.paneForBrowser(embedder);

    switch (name) {
      case "link-click":
        if (pane) {
          pane.handleLinkClick(data);
        } else {
          // No pane claims this page, so send the link to the system browser
          // rather than leaving the user with a dead click.
          Zotero.launchURL(data.href);
        }
        return undefined;
      case "get-package":
        // The page script asks for the files when the user sends. The answer is
        // a promise, which the actor system resolves for `sendQuery`.
        return pane ? pane.packageForPage() : { files: [], skipped: [] };
      case "package-sent":
        pane?.reportSent(data);
        return undefined;
      default:
        return undefined;
    }
  }
}

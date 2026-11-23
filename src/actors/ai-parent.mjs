/*
 * Window actor parent for the sidebar browser.
 *
 * The child cannot reach the sidebar, so it forwards events here. This side
 * holds no state: it looks up the sidebar that owns the message and hands the
 * data to it.
 */

export class SideBrowserParent extends JSWindowActorParent {
  receiveMessage({ name, data }) {
    let win = this.browsingContext?.topChromeWindow;
    let api = win?.Zotero?.SideBrowser;
    let sidebar = api?.getSidebarByWindow?.(win);
    if (!sidebar) {
      return;
    }
    if (name === "link-click") {
      sidebar.handleLinkClick(data);
    }
  }
}

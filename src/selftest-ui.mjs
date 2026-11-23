/*
 * UI checks used by the self test: toggle the panel from the View menu path and
 * confirm the row class and the pane visibility move together.
 */

export async function testToggle(record, sidebar) {
  let step = (m) => Zotero.debug(`[Side Browser] uiTest: ${m}`);
  let win = sidebar.win;
  let appcontent = win.document.getElementById("appcontent");

  step("closing");
  sidebar.close();
  await Zotero.Promise.delay(200);
  record("close hides pane", sidebar.pane.hidden === true);
  record("close removes row class", !appcontent.classList.contains("sb-row"));

  step("opening");
  sidebar.open();
  await Zotero.Promise.delay(400);
  record("open shows pane", sidebar.pane.hidden === false);
  record("open sets row class", appcontent.classList.contains("sb-row"));
  record("pane is a child of appcontent", sidebar.pane.parentElement === appcontent);

  let rect = sidebar.pane.getBoundingClientRect();
  record("pane has real size", rect.width > 200 && rect.height > 200, {
    value: { width: Math.round(rect.width), height: Math.round(rect.height) },
  });

  // The tab stack must keep its own space, not be covered by the panel.
  let stack = win.document.getElementById("zotero-pane-stack");
  let stackRect = stack.getBoundingClientRect();
  record("panel does not overlap the stack", stackRect.right <= rect.left + 2, {
    value: {
      stackRight: Math.round(stackRect.right),
      panelLeft: Math.round(rect.left),
    },
  });

  step("done");
}

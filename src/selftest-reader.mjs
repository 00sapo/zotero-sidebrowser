/*
 * Reader checks used by the self test.
 *
 * Opens the sample paper in the reader, selects text there, and verifies that
 * the selection reaches the pane and the composed context.
 */

export async function testReaderFlow(record, section) {
  let step = (m) => Zotero.debug(`[Side Browser] readerTest: ${m}`);

  let api = section.activePane();
  if (!api) {
    record("reader: pane available", false);
    return;
  }
  let pane = api.pane;

  step("opening reader");
  let item = pane.scope.items[0];
  let attachment = item ? await item.getBestAttachment() : null;
  if (!attachment) {
    record("reader attachment", false);
    return;
  }
  record("reader attachment", !!attachment.isPDFAttachment());

  let reader = await Zotero.Reader.open(attachment.id, undefined, {
    openInBackground: false,
  });
  if (!reader) {
    record("reader opened", false);
    return;
  }
  await reader._initPromise;
  record("reader opened", true, { value: reader.type });
  await Zotero.Promise.delay(2500);

  let selected = selectAllInReader(reader);
  record("reader text selected", selected.length > 0, { value: selected.slice(0, 60) });

  // Push a selection through the same path a real popup click uses.
  let annotation = {
    text: selected || "Synthetic selection for the self test.",
    pageLabel: "1",
    pageIndex: 0,
  };
  section.useSelection(annotation, reader, Zotero.getMainWindow());
  await Zotero.Promise.delay(600);

  record("selection stored", pane.selection?.text?.length > 0, {
    value: pane.selection?.text?.slice(0, 40),
  });
  let label = pane.root.querySelector('[data-kind="selection"]');
  await api.refreshScope();
  record("selection option shown", !!label && !label.hidden);

  let text = await api.contextText();
  record("selection in context text", text.includes(annotation.text.slice(0, 20)), {
    value: { chars: text.length },
  });

  step("done");
}

/** Select every word in the reader's PDF frame. */
function selectAllInReader(reader) {
  try {
    let frameWin = reader._iframeWindow;
    let inner = frameWin?.wrappedJSObject;
    let iframe = inner?.document?.querySelector("iframe");
    let pdfDoc = iframe?.contentDocument;
    if (!pdfDoc?.body) {
      return "";
    }
    let range = pdfDoc.createRange();
    range.selectNodeContents(pdfDoc.body);
    let selection = iframe.contentWindow.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  } catch (e) {
    Zotero.debug(`[Side Browser] Could not select in the reader: ${e}`);
    return "";
  }
}

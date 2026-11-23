/*
 * Reader checks used by the self test.
 *
 * Opens the sample paper in the reader, selects text, and verifies that the
 * sidebar receives a usable selection payload.
 */

export async function testReaderFlow(record, sidebar) {
  let step = (m) => Zotero.debug(`[Side Browser] readerTest: ${m}`);

  step("opening reader");
  let win = Zotero.getMainWindow();
  let item = sidebar.scope.items[0];
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

  // The reader runs in its own frame; select all text there.
  let frameWin = reader._iframeWindow;
  let selected = "";
  try {
    let inner = frameWin?.wrappedJSObject;
    let iframe = inner?.document?.querySelector("iframe");
    let pdfDoc = iframe?.contentDocument;
    if (pdfDoc?.body) {
      let range = pdfDoc.createRange();
      range.selectNodeContents(pdfDoc.body);
      let selection = iframe.contentWindow.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      selected = selection.toString();
    }
  } catch (e) {
    step(`selection failed: ${e}`);
  }
  record("reader text selected", selected.length > 0, { value: selected.slice(0, 60) });

  // Push a synthetic selection through the same path a real popup click uses.
  let annotation = {
    text: selected || "Synthetic selection for the self test.",
    pageLabel: "1",
    pageIndex: 0,
  };
  sidebar._useSelection(annotation, reader);
  await Zotero.Promise.delay(300);

  record("selection stored", sidebar.selection?.text?.length > 0, {
    value: sidebar.selection?.text?.slice(0, 40),
  });
  record("pdf text box shown", !sidebar.checkboxes.includePDFText.closest("label").hidden);

  // Compose with the selection and check the prompt carries it.
  sidebar.checkboxes.includePDFText.checked = true;
  sidebar._userTouched.includePDFText = true;
  let composed = sidebar._compose();
  record("selection in prompt", composed.text.includes(annotation.text.slice(0, 20)), {
    value: { chars: composed.text.length },
  });
  step("done");
}

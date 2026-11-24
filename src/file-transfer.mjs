/* Provider conversion and private, on-disk files for native dragging. */

export async function preparePackage(built, mode, doc) {
  if (!mode || !built.files.length) {
    return built;
  }
  // A plugin-owned chrome document can import Zotero's packaged PDF modules.
  const browser = doc.createXULElement("browser");
  browser.setAttribute("remote", "false");
  browser.style.cssText = "position:fixed;width:1px;height:1px;visibility:hidden;pointer-events:none";
  const host = doc.defaultView;
  let timer;
  try {
    await new Promise((resolve, reject) => {
      browser.addEventListener("load", (event) => {
        if (event.target?.documentURI === "chrome://sidebrowser-renderer/content/file-renderer.html") {
          resolve();
        }
      }, true);
      timer = host.setTimeout(() => reject(new Error("The file converter did not load.")), 20000);
      browser.setAttribute("src", "chrome://sidebrowser-renderer/content/file-renderer.html");
      doc.documentElement.appendChild(browser);
    });
    host.clearTimeout(timer);
    const win = browser.contentWindow.wrappedJSObject;
    const result = await win.convertSideBrowserFiles(
      Cu.cloneInto(built.files, win), mode,
    );
    return {
      files: Array.from(result.files, (file) => ({ name: file.name, type: file.type,
        ...(typeof file.text === "string" ? { text: file.text } : { data: file.data }),
        ...(file.isPdf ? { isPdf: true } : {}),
      })),
      skipped: [...built.skipped, ...Array.from(result.skipped, (f) => ({ title: f.title, reason: f.reason }))],
    };
  } finally {
    host.clearTimeout(timer);
    browser.remove();
  }
}

export async function writeDragFiles(files) {
  const dir = Zotero.getTempDirectory();
  dir.append("sidebrowser-drag");
  dir.createUnique(Ci.nsIFile.DIRECTORY_TYPE, 0o700);
  const paths = [];
  try {
    for (const spec of files) {
      // Never allow a supplied file name to leave the private directory.
      const name = spec.name.replace(/[\x00-\x1f<>:"/\\|?*]/g, "_").replace(/^\.+$/, "file");
      const file = dir.clone();
      file.append(name || "file");
      file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, 0o600);
      const bytes = typeof spec.text === "string" ? new TextEncoder().encode(spec.text)
        : Uint8Array.from(spec.data || "", (ch) => ch.charCodeAt(0));
      await IOUtils.write(file.path, bytes, { permissions: 0o600 });
      paths.push(file.path);
    }
    return { directory: dir.path, paths };
  } catch (error) {
    await IOUtils.remove(dir.path, { recursive: true, ignoreAbsent: true });
    throw error;
  }
}

export function setDragData(transfer, paths) {
  transfer.effectAllowed = "copy";
  paths.forEach((path, index) => {
    transfer.mozSetDataAt("application/x-moz-file", Zotero.File.pathToFile(path), index);
  });
}

export async function removeDragFiles(files) {
  if (files?.directory) {
    await IOUtils.remove(files.directory, { recursive: true, ignoreAbsent: true });
  }
}

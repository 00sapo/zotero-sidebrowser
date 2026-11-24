/*
 * Provider definitions for the sidebar browser.
 *
 * One entry per AI service. A provider needs a start URL, an ordered list of
 * selectors that find the message composer, an ordered list of selectors that
 * find the send button, and an ordered list of selectors that find the file
 * input used to attach documents.
 *
 * Selector order matters: the first match wins. Lists end with generic
 * fallbacks so a cosmetic site change does not break insertion.
 *
 * Adapter contract:
 *   composerSelectors  string[]  contenteditable, textarea, or [role=textbox]
 *   sendSelectors      string[]  a clickable element, or empty to press Enter
 *   sendMode           "button" | "enter" | "button-then-enter"
 *   fileSelectors      string[]  input[type=file] elements
 *   acceptsDocuments   boolean   whether the composer accepts a non-image file
 */

/**
 * A provider with the generic selectors, for a site that has not been measured
 * yet. Every field can be overridden.
 *
 * @param {object} fields
 * @returns {object}
 */
function generic(fields) {
  return {
    composerSelectors: ["textarea", "div[contenteditable='true']", "[role='textbox']"],
    sendSelectors: ["button[type='submit']", "button[aria-label*='Send' i]"],
    sendMode: "button-then-enter",
    fileSelectors: ["input[type='file'][accept*='pdf']", "input[type='file'][multiple]", "input[type='file']"],
    acceptsDocuments: true,
    ...fields,
  };
}

export const DEFAULT_PROVIDERS = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    composerSelectors: [
      "#prompt-textarea",
      "div.ProseMirror[contenteditable='true']",
      "div[contenteditable='true'][id='prompt-textarea']",
      "form div[contenteditable='true']",
      "textarea#prompt-textarea",
      "form textarea",
    ],
    sendSelectors: [
      "button[data-testid='send-button']",
      "button[aria-label='Send prompt']",
      "button[aria-label*='Send']",
      "form button[type='submit']:not([disabled])",
    ],
    sendMode: "button-then-enter",
    fileSelectors: [
      "input[type='file'][accept*='pdf']",
      "input[type='file'][accept*='application']",
      "input[type='file'][multiple]",
    ],
    acceptsDocuments: true,
  },
  {
    id: "claude",
    label: "Claude",
    url: "https://claude.ai/new",
    composerSelectors: [
      "div.ProseMirror[contenteditable='true']",
      "div[contenteditable='true'][aria-label]",
      "fieldset div[contenteditable='true']",
      "div[contenteditable='true']",
    ],
    sendSelectors: [
      "button[aria-label='Send message']",
      "button[aria-label*='Send']",
      "fieldset button[type='button']:last-of-type",
    ],
    sendMode: "button-then-enter",
    fileSelectors: [
      "input[type='file'][accept*='pdf']",
      "input[type='file'][multiple]",
      "input[type='file']",
    ],
    acceptsDocuments: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    url: "https://chat.deepseek.com/",
    composerSelectors: [
      "textarea#chat-input",
      "textarea[placeholder]",
      "div[contenteditable='true']",
      "textarea",
    ],
    sendSelectors: [
      "div[role='button'][aria-label*='Send']",
      "button[aria-label*='Send']",
      "div[role='button'][aria-disabled='false']",
    ],
    sendMode: "enter",
    fileSelectors: [
      "input[type='file'][accept*='pdf']",
      "input[type='file'][multiple]",
      "input[type='file']",
    ],
    acceptsDocuments: true,
  },
  {
    id: "mistral",
    label: "Mistral Le Chat",
    url: "https://chat.mistral.ai/chat",
    composerSelectors: [
      "div.ProseMirror[contenteditable='true']",
      "div[contenteditable='true']",
      "textarea",
    ],
    sendSelectors: [
      "button[type='submit']",
      "button[aria-label*='Send']",
    ],
    sendMode: "button-then-enter",
    fileSelectors: [
      "input[type='file'][accept*='pdf']",
      "input[type='file'][multiple]",
      "input[type='file']",
    ],
    acceptsDocuments: true,
  },
  // The five services below were measured on their live pages, signed out. The
  // selectors come from `Zotero.SideBrowser.probe()` output.
  generic({
    id: "gemini",
    label: "Gemini",
    url: "https://gemini.google.com/app",
    composerSelectors: [
      "div.ql-editor[role='textbox']",
      "rich-textarea div[contenteditable='true']",
      "div[contenteditable='true'][aria-label*='prompt' i]",
    ],
    sendSelectors: ["button[aria-label='Send message']", "button.send-button"],
    // Gemini creates its file input only when the upload menu opens, so files
    // arrive by paste.
    notes: "Files are pasted into the message box.",
  }),
  generic({
    id: "perplexity",
    label: "Perplexity",
    url: "https://www.perplexity.ai/",
    composerSelectors: [
      "div[role='textbox'][contenteditable='true']",
      "#ask-input",
      "div[contenteditable='true'][aria-label^='Ask']",
    ],
    sendSelectors: ["button[aria-label='Submit']", "button[type='submit']"],
  }),
  generic({
    id: "euria",
    label: "Euria",
    url: "https://euria.infomaniak.com/",
    composerSelectors: ["textarea[aria-label='Ask Euria']", "textarea"],
    sendSelectors: ["button[aria-label='Send']", "button[type='submit']"],
    notes: "Signed out, the page takes only images, so text goes as a PDF.",
  }),
  generic({
    id: "ecosia",
    label: "Ecosia AI",
    url: "https://www.ecosia.org/ai-chat",
    composerSelectors: ["textarea[name='prompt']", "textarea.input-field__prompt-textarea", "textarea"],
    sendSelectors: ["button.input-field__prompt-button", "button[aria-label='Send']"],
    fileSelectors: ["input[name='file-attachment']", "input[type='file']"],
  }),
  generic({
    id: "lumo",
    label: "Lumo",
    url: "https://lumo.proton.me/",
    composerSelectors: [
      "textarea.composer",
      ".ProseMirror.composer",
      "textarea[placeholder^='Ask']",
      "div[contenteditable='true']",
    ],
    sendSelectors: ["button.button-solid-norm.rounded-full", "button[type='submit']"],
    fileSelectors: ["#emptyFileCardInput", "input[type='file']"],
  }),
  generic({
    id: "duckai",
    label: "Duck.ai",
    url: "https://duck.ai/",
    composerSelectors: ["textarea[name='user-prompt']", "textarea[placeholder^='Ask']", "textarea"],
    sendSelectors: ["button[type='submit']", "button[aria-label='Ask']"],
    fileSelectors: ["input[name='upload']", "input[type='file']"],
    notes: "The page takes PDFs and images only, so text goes as a PDF.",
  }),
  generic({
    id: "brave",
    label: "Brave Leo",
    url: "https://search.brave.com/ask",
    composerSelectors: ["#tap-input-field", "textarea[placeholder^='Ask']"],
    sendSelectors: ["button.tap-input-primary-button", "button[aria-label='Ask']"],
    fileSelectors: ["input.tap-image-input", "input[type='file']"],
    notes: "The page takes images only. Use Insert context to edit for papers.",
  }),
  generic({
    id: "venice",
    label: "Venice",
    url: "https://venice.ai/chat",
    composerSelectors: ["textarea[name='prompt-textarea']", "textarea[aria-label='Chat message input']", "textarea"],
    sendSelectors: ["button[data-testid='minds-chat-send-button']", "button[aria-label='Send message']"],
    fileSelectors: ["input[data-testid='minds-chat-file-input']", "input[type='file']"],
  }),
];

/**
 * Providers a user adds by hand, stored as JSON in a preference. Each entry
 * needs at least an id, a label, and a url; the rest falls back to the generic
 * adapter, which types into the focused element and presses Enter.
 */
export function loadCustomProviders(rawPref) {
  let list = [];
  try {
    let parsed = JSON.parse(rawPref || "[]");
    if (Array.isArray(parsed)) {
      list = parsed;
    }
  } catch (e) {
    return [];
  }
  return list
    .filter((p) => p && typeof p.url === "string" && p.url.startsWith("http"))
    .map((p, index) => ({
      id: typeof p.id === "string" && p.id ? p.id : `custom-${index}`,
      label: typeof p.label === "string" && p.label ? p.label : p.url,
      url: p.url,
      custom: true,
      composerSelectors: Array.isArray(p.composerSelectors) && p.composerSelectors.length
        ? p.composerSelectors
        : ["div[contenteditable='true']", "textarea", "[role='textbox']"],
      sendSelectors: Array.isArray(p.sendSelectors) ? p.sendSelectors : [],
      sendMode: p.sendMode === "button" || p.sendMode === "enter" ? p.sendMode : "button-then-enter",
      fileSelectors: Array.isArray(p.fileSelectors) && p.fileSelectors.length
        ? p.fileSelectors
        : ["input[type='file'][accept*='pdf']", "input[type='file']"],
      acceptsDocuments: p.acceptsDocuments !== false,
    }));
}

export function findProvider(providers, id) {
  return providers.find((p) => p.id === id) || providers[0];
}

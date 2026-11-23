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
    label: "Mistral",
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

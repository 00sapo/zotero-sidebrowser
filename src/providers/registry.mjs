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
 *   attachSelectors    string[]  the site's own "attach" button, clicked before
 *                                the file input is filled, because several sites
 *                                create or unlock the input only when it opens
 *   fileSelectors      string[]  input[type=file] elements
 *   acceptsDocuments   boolean   whether the composer accepts a non-image file
 *   badges             string[]  which marks the service earns, from the lists in
 *                                the readme: "eco" (climate-aware energy) and
 *                                "privacy" (privacy-respecting policy). Every
 *                                service listed there is free, so "free" is added
 *                                to each built-in entry by `withBadges`.
 *
 * Attaching is done through the page's own controls. A person cannot drop a file
 * on most of these sites, and a synthetic drop is ignored, so the plugin clicks
 * the attach button, fills the file input the site creates, and tells the input
 * the way a file dialog would.
 */

/**
 * Services from the three lists in the readme. Every one of them is free; the
 * other two marks come from their own list.
 *
 * - eco: free services powered by climate-aware energy
 * - privacy: free services with privacy-respecting policies
 */
const README_MARKS = {
  euria: ["eco", "privacy"],
  ecosia: ["eco", "privacy"],
  mistral: ["eco"],
  lumo: ["privacy"],
  duckai: ["privacy"],
  brave: ["privacy"],
  venice: ["privacy"],
  chatgpt: [],
  deepseek: [],
  claude: [],
  gemini: [],
};

/**
 * Add the free mark, and the marks from the readme, to a built-in provider.
 *
 * @param {object} provider
 * @returns {object}
 */
function withBadges(provider) {
  let marks = README_MARKS[provider.id] || [];
  return { ...provider, badges: ["free", ...marks] };
}

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
    attachSelectors: ["button[aria-label*='Attach' i]", "button[aria-label*='Upload' i]", "button[aria-label*='Add file' i]"],
    fileSelectors: ["input[type='file'][accept*='pdf']", "input[type='file'][multiple]", "input[type='file']"],
    acceptsDocuments: true,
    badges: [],
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
    attachSelectors: [
      "button[aria-label*='Attach' i]",
      "button[data-testid='composer-plus-btn']",
      "button[aria-label*='Add' i]",
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
    attachSelectors: [
      "button[aria-label*='Attach' i]",
      "button[aria-label*='Upload' i]",
      "button[data-testid='input-menu-plus']",
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
    attachSelectors: [
      "button[aria-label*='Attach' i]",
      "div[role='button'][aria-label*='Upload' i]",
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
    attachSelectors: [
      "button[aria-label*='Attach' i]",
      "button[aria-label*='Upload' i]",
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
    attachSelectors: [
      "button[aria-label='Upload & tools']",
      "button[aria-label*='Add files' i]",
      "button[aria-label*='Upload' i]",
    ],
    sendSelectors: ["button[aria-label='Send message']", "button.send-button"],
    // Gemini creates its file input only when the upload menu opens, so files
    // arrive by paste.
    notes: "Files are pasted into the message box.",
  }),
  generic({
    id: "euria",
    label: "Euria",
    url: "https://euria.infomaniak.com/",
    composerSelectors: ["textarea[aria-label='Ask Euria']", "textarea"],
    attachSelectors: [
      "button[aria-label*='Add attachments' i]",
      "button[aria-label*='Attach' i]",
    ],
    sendSelectors: ["button[aria-label='Send']", "button[type='submit']"],
    notes: "Signed out, the page takes only images, so text goes as a PDF.",
  }),
  generic({
    id: "ecosia",
    label: "Ecosia AI",
    url: "https://www.ecosia.org/ai-chat",
    composerSelectors: ["textarea[name='prompt']", "textarea.input-field__prompt-textarea", "textarea"],
    attachSelectors: [
      "button[aria-label='AI tools']",
      "button[aria-label*='Attach' i]",
    ],
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
    attachSelectors: [
      "button[aria-label='Tools']",
      "button[aria-label*='Attach' i]",
    ],
    sendSelectors: ["button.button-solid-norm.rounded-full", "button[type='submit']"],
    fileSelectors: ["#emptyFileCardInput", "input[type='file']"],
  }),
  generic({
    id: "duckai",
    label: "Duck.ai",
    url: "https://duck.ai/",
    composerSelectors: ["textarea[name='user-prompt']", "textarea[placeholder^='Ask']", "textarea"],
    attachSelectors: [
      "button[data-testid='duckai-attach-button']",
      "button[aria-label*='Add images' i]",
    ],
    sendSelectors: ["button[type='submit']", "button[aria-label='Ask']"],
    fileSelectors: ["input[name='upload']", "input[type='file']"],
    notes: "The page takes PDFs and images only, so text goes as a PDF.",
  }),
  generic({
    id: "brave",
    label: "Brave Leo",
    url: "https://search.brave.com/ask",
    composerSelectors: ["#tap-input-field", "textarea[placeholder^='Ask']"],
    attachSelectors: [
      "button[aria-label='Add image']",
      "button[aria-label*='Attach' i]",
    ],
    sendSelectors: ["button.tap-input-primary-button", "button[aria-label='Ask']"],
    fileSelectors: ["input.tap-image-input", "input[type='file']"],
    notes: "The page takes images only, so a drop is used. Edit context sends the text in the message box instead.",
  }),
  generic({
    id: "venice",
    label: "Venice",
    url: "https://venice.ai/chat",
    composerSelectors: ["textarea[name='prompt-textarea']", "textarea[aria-label='Chat message input']", "textarea"],
    attachSelectors: [
      "button[data-testid='minds-chat-attach-button']",
      "button[aria-label*='Attach' i]",
    ],
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
    .map((p) => ({ ...p, badges: Array.isArray(p.badges) ? p.badges.filter((b) => BADGE_KEYS.includes(b)) : [] }))
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
      attachSelectors: Array.isArray(p.attachSelectors) && p.attachSelectors.length
        ? p.attachSelectors
        : ["button[aria-label*='Attach' i]", "button[aria-label*='Upload' i]"],
      fileSelectors: Array.isArray(p.fileSelectors) && p.fileSelectors.length
        ? p.fileSelectors
        : ["input[type='file'][accept*='pdf']", "input[type='file']"],
      acceptsDocuments: p.acceptsDocuments !== false,
    }));
}

/** The three possible marks, in the order they are shown. */
export const BADGE_KEYS = ["free", "privacy", "eco"];

/**
 * Apply `withBadges` to the built-in list.
 *
 * @param {object[]} providers
 * @returns {object[]}
 */
export function applyBadges(providers) {
  return providers.map((provider) => (provider.custom ? provider : withBadges(provider)));
}

export function findProvider(providers, id) {
  return providers.find((p) => p.id === id) || providers[0];
}

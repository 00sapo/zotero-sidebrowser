/*
 * The marks that describe a service.
 *
 * The three marks come from the lists in the readme: free, a privacy-respecting
 * policy, and climate-aware energy. The glyphs are present, mask-privacy and
 * leaves from uxwing, drawn as one filled path each.
 *
 * The colours are chosen to keep about three to one contrast against both
 * Zotero's light pane (#f2f2f2) and its dark pane (#303030), so the same file
 * works in either theme.
 */

export const BADGE_COLORS = {
  free: "#9c7200",
  privacy: "#0c8599",
  eco: "#2b8a3e",
};

export const BADGES = {
  free: {
    label: "Free",
    title: "Free to use, within the site's own limits",
    color: BADGE_COLORS.free,
    viewBox: "0 0 122.88 120.19",
    path: "M62.95,27.86c2.36-5.34,4.98-10.39,8.11-14.67c6.34-8.7,21.82-19.17,31.29-9.03 c8.48,9.07,1.29,18.98-8.81,23.7h22.85c1.77,0,3.43,0.74,4.57,1.92c1.18,1.18,1.92,2.8,1.92,4.57v12.31c0,1.77-0.74,3.43-1.92,4.57 c-1.07,1.07-2.47,1.77-4.05,1.88v60.08c0,1.92-0.77,3.69-2.06,4.94c-1.25,1.25-3.02,2.06-4.94,2.06H13.12 c-1.92,0-3.69-0.77-4.94-2.06c-1.25-1.25-2.06-3.02-2.06-4.94l0-60.04c-1.62-0.11-3.1-0.81-4.2-1.88C0.74,50.09,0,48.47,0,46.7 V34.39c0-1.77,0.74-3.43,1.92-4.57c1.18-1.18,2.8-1.92,4.57-1.92h23.26c-10.06-4.72-17.25-14.63-8.81-23.7 c9.47-10.17,24.95,0.33,31.29,9.03c3.13,4.31,5.75,9.36,8.11,14.67h2.54L62.95,27.86L62.95,27.86z M83.63,27.86 C106.74,17.62,99.07,0.37,84.44,8.7c-3.43,1.95-6.3,5.6-8.88,9.25c-2.43,3.43-4.61,7.04-6.23,9.91L83.63,27.86L83.63,27.86z M39.69,27.86C16.59,17.62,24.25,0.37,38.88,8.7c3.43,1.95,6.3,5.6,8.88,9.25c2.43,3.43,4.61,7.04,6.23,9.91L39.69,27.86 L39.69,27.86z M111.53,91.07H70.51v23.7h39.44c0.44,0,0.85-0.18,1.14-0.48c0.3-0.3,0.48-0.7,0.48-1.14V91.07H111.53L111.53,91.07z M53.11,91.07H11.5v22.08c0,0.44,0.18,0.85,0.48,1.14c0.3,0.3,0.7,0.48,1.14,0.48h39.99V91.07L53.11,91.07z M11.5,76.66h41.61 V50.57H11.5V76.66L11.5,76.66z M70.47,76.66h41.02V50.57H70.47V76.66L70.47,76.66z",
  },
  privacy: {
    label: "Privacy",
    title: "Privacy-respecting policy: your text is not used for training",
    color: BADGE_COLORS.privacy,
    viewBox: "0 0 122.88 66.56",
    path: "M0,3.27c0.2-2.04,1.28-2.86,3.36-2.32c2.9,0.71,5.87,0.98,8.91,0.79c7.02-0.44,9.14-3.14,17.05-0.79 C40.2,4.39,50.95,7.59,60.83,9.22C74.79,8.2,84.61,2.25,94.54,0.69c8.65-2.18,14.2,3,25.18,0c2.51-0.21,3.41,0.17,3.1,3.36 c-0.66,12.31-2.38,32.36-12.06,43.11c-7.91,8.78-22.25,8.78-33.7,13.96l-14.67,5.44c-6.72-0.84-13.33-3.32-19.89-6.59 c-8.38-3.24-14.94-4.91-21.05-6.2C2.86,45.53,1.2,20.98,0,3.27L0,3.27z M15.4,14.96c11.08-0.19,30.75,0.11,35.08,13.25 c0.8,2.43,0.8,4.91-0.03,7.55C27.99,37.02,20.87,30.28,15.4,14.96L15.4,14.96z M107.48,18.23c-11.85-4.66-35.98-5.8-39.86,9.98 c-0.61,2.49-1.16,4.91-0.34,7.55C89.2,36.06,99.96,32.88,107.48,18.23L107.48,18.23z",
  },
  eco: {
    label: "Eco",
    title: "Powered by climate-aware energy",
    color: BADGE_COLORS.eco,
    viewBox: "0 0 122.88 114.86",
    path: "M59.07,110.77C110.92,105,139.6,71.12,112.44,0c-21.29,14.9-50.39,24.6-65,44.55C57,52.94,64.89,62.23,67.08,74.37c13.19-16.08,27.63-30.72,35.23-47-7.79,39.07-20,53.84-38.78,73.81a93.64,93.64,0,0,1-4.46,9.62Zm-14.9,4C4,105-15.18,76.09,14.27,24.75c23.8,22.92,65.79,37.48,38.39,85.86a27.08,27.08,0,0,1-1.83,2.93C45.9,89.62,26.21,70.69,20.43,50.61,21.77,83.42,31.23,93,45.88,114.86c-.57,0-1.14-.06-1.71-.13Z",
  },
};

/** Every mark, in the order they are shown. */
export const BADGE_ORDER = ["free", "privacy", "eco"];

/**
 * Build the icon by hand, in the SVG namespace. Neither `innerHTML` nor the XUL
 * fragment parser produces a working `<svg>` inside a Zotero pane, so every node
 * is created with the namespace it needs.
 *
 * @param {Document} doc
 * @param {object} badge
 * @returns {Element|null}
 */
function svgElement(doc, badge) {
  const NS = "http://www.w3.org/2000/svg";
  try {
    let svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", badge.viewBox);
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("role", "presentation");
    let path = doc.createElementNS(NS, "path");
    path.setAttribute("d", badge.path);
    path.setAttribute("fill", badge.color);
    svg.appendChild(path);
    return svg;
  } catch (e) {
    Zotero.debug(`[Side Browser] Could not build an icon: ${e}`);
    return null;
  }
}

/**
 * The marks for one provider, as elements of the given document.
 *
 * The icon is set through `innerHTML` on an HTML element, because the XUL
 * fragment parser does not build a working `<svg>`, and the colour is written
 * into the path, because a stylesheet cannot reach inside it here.
 *
 * @param {Document} doc
 * @param {string[]} keys
 * @returns {Element[]}
 */
export function badgeElements(doc, keys) {
  let out = [];
  for (let key of BADGE_ORDER) {
    if (!(keys || []).includes(key)) {
      continue;
    }
    let badge = BADGES[key];
    let span = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    span.className = "sb-badge";
    span.dataset.badge = key;
    span.title = badge.title;
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", badge.label);
    let svg = svgElement(doc, badge);
    if (svg) {
      span.appendChild(svg);
    }
    out.push(span);
  }
  return out;
}

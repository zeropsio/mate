/**
 * An address pasted into an answer, as the reader sees it.
 *
 * A bare link's text is its own address, which makes a sentence carry
 * `https://`, a query string and a fragment the reader has no use for, and
 * lets one address run across two lines. It reads instead as where it goes:
 * the host and the path, and past 48 characters the middle gives way — by
 * whole segments where it can, so the host (where) and the last segments
 * (what) stay whole. The link's href, its tooltip and its copy keep the full
 * address; a link written with words of its own keeps them.
 */

/** Characters of the address a bare link shows, the ellipsis aside. */
const BARE_URL_LABEL_LIMIT = 48;
const ELLIPSIS = "…";

function decodedPath(pathname: string): string {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

/** `text` is the address itself: as written, or as the parser percent-encoded it. */
function isAddressText(text: string, href: string): boolean {
  if (text === href) return true;
  try {
    return encodeURI(text) === href;
  } catch {
    return false;
  }
}

function middleEllipsis(label: string): string {
  if (label.length <= BARE_URL_LABEL_LIMIT) return label;
  const slash = label.indexOf("/");
  if (slash !== -1) {
    const host = label.slice(0, slash);
    const segments = label.slice(slash + 1).split("/");
    let tail: string | null = null;
    // Keep one segment out at least, or there is no middle to give way.
    for (let start = segments.length - 1; start >= 1; start -= 1) {
      const candidate = segments.slice(start).join("/");
      if (host.length + candidate.length + 2 > BARE_URL_LABEL_LIMIT) break;
      tail = candidate;
    }
    if (tail !== null) return `${host}/${ELLIPSIS}/${tail}`;
  }
  const characters = Array.from(label);
  const head = Math.ceil(BARE_URL_LABEL_LIMIT / 2);
  const end = characters.slice(characters.length - (BARE_URL_LABEL_LIMIT - head));
  return `${characters.slice(0, head).join("")}${ELLIPSIS}${end.join("")}`;
}

/**
 * The label a link shows when its text is its own web address, or `null`
 * when the link should keep its text: words of its own, or an address that is
 * not on the web (`mailto:`, a fragment, a file).
 */
export function bareUrlLabel(text: string, href: string): string | null {
  if (!isAddressText(text, href)) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return middleEllipsis(`${url.host}${decodedPath(url.pathname).replace(/\/+$/, "")}`);
}

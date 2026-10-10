/**
 * A page the Mate published for the person (`zerops_publish_page`), drawn in its conversation:
 * the document its frame shows, what the frame hears from it, and the frame's height.
 *
 * The frame is sandboxed with scripts alone — never the same origin — so the page runs in an
 * opaque origin: it cannot read the Mate's server, the person's session or the conversation
 * around it. Its document opens, ahead of anything the page says, with a policy that lets it
 * request nothing: no fetch, script, style, picture, font, media or form submission from anywhere.
 * A policy governs no navigation, WebRTC or DNS prefetch. A page that navigates its own frame is
 * taken down at once (`PublishedPage.tsx` counts the frame's loads, and the page says it is
 * leaving); WebRTC and DNS prefetch stay open to it, carrying only what the page itself holds. It
 * talks to the conversation only by messages: its height, a link the person clicked, its leaving.
 */

/** Everything the page may load: what it carries inline, nothing from anywhere. */
export const PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** The conversation's colours, as the page reads them: CSS variables and a colour scheme. */
export interface PageTheme {
  readonly scheme: "light" | "dark";
  readonly vars: Readonly<Record<string, string>>;
}

/** The conversation's variables a page may read (the Mate's instructions name the main ones). */
export const PAGE_THEME_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--primary",
  "--primary-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--font-sans",
  "--font-mono",
] as const;

/** A value that cannot leave the declaration it is written into. */
const SAFE_VALUE = /^[^<>{};\\]*$/;

/** The page's `:root` rule for the theme: its variables and its colour scheme. */
export function themeRule(theme: PageTheme): string {
  const declarations = Object.entries(theme.vars)
    .filter(([name, value]) => /^--[\w-]+$/.test(name) && SAFE_VALUE.test(value))
    .map(([name, value]) => `${name}:${value.trim()};`)
    .join("");
  return `:root{${declarations}color-scheme:${theme.scheme};}`;
}

/**
 * What runs in the page before the page does: it says the page's height whenever it changes, hands
 * a link the person clicked to the conversation to open (http and https only), and takes the
 * conversation's colours when they change.
 */
const BOOTSTRAP = `(function(){
var host=window.parent;var post=function(m){m.mate="page";host.postMessage(m,"*");};
var last=-1;
var measure=function(){var d=document.documentElement,b=document.body;
var h=Math.ceil(Math.max(d.getBoundingClientRect().height,b?b.scrollHeight:0));
if(h!==last){last=h;post({kind:"height",height:h});}};
var ro=new ResizeObserver(measure);ro.observe(document.documentElement);
document.addEventListener("DOMContentLoaded",function(){if(document.body)ro.observe(document.body);measure();});
addEventListener("load",measure);
document.addEventListener("click",function(e){if(!e.isTrusted||e.defaultPrevented)return;
var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;
var u;try{u=new URL(a.getAttribute("href"),document.baseURI)}catch(_){return}
if(u.protocol!=="http:"&&u.protocol!=="https:")return;
e.preventDefault();post({kind:"open",url:u.href});},true);
addEventListener("pagehide",function(){post({kind:"left"});});
addEventListener("message",function(e){if(e.source!==host)return;var d=e.data;
if(!d||d.mate!=="page-theme"||typeof d.rule!=="string")return;
var s=document.getElementById("mate-page-theme");if(s)s.textContent=d.rule;});
})();`;

/**
 * The document the frame shows: the policy, the theme and the bootstrap first, then the page
 * whole. What the page writes after them — its doctype, its own `<html>` and `<head>` — the parser
 * folds into the head they opened, so nothing of the page runs or loads before the policy holds.
 */
export function pageDocument(html: string, theme: PageTheme): string {
  return (
    "<!doctype html><html><head>" +
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">` +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<style id="mate-page-theme">${themeRule(theme)}</style>` +
    `<style>html,body{background:var(--background);color:var(--foreground);font-family:var(--font-sans,system-ui,sans-serif);}body{margin:0;}</style>` +
    `<script>${BOOTSTRAP}</script>` +
    html
  );
}

/** What a page said to the conversation: its height, a link the person clicked, its leaving. */
export type PageMessage =
  | { readonly kind: "height"; readonly height: number }
  | { readonly kind: "open"; readonly url: string }
  | { readonly kind: "left" };

/** A page's message, or null for anything else: another window's, a malformed one. */
export function readPageMessage(data: unknown): PageMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as { mate?: unknown; kind?: unknown; height?: unknown; url?: unknown };
  if (message.mate !== "page") return null;
  if (message.kind === "left") return { kind: "left" };
  if (message.kind === "height")
    return typeof message.height === "number" && Number.isFinite(message.height)
      ? { kind: "height", height: Math.max(0, Math.ceil(message.height)) }
      : null;
  if (message.kind === "open" && typeof message.url === "string") {
    try {
      const url = new URL(message.url);
      return url.protocol === "http:" || url.protocol === "https:"
        ? { kind: "open", url: url.href }
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The link a page asks to open, when the person clicked it: the message came from this page's
 * frame, the frame is where the person clicked, and the click is still the person's (their
 * activation). A page's script asking on its own opens nothing.
 */
export function linkToOpen(
  message: Extract<PageMessage, { kind: "open" }>,
  input: { readonly fromFrame: boolean; readonly focused: boolean; readonly activated: boolean },
): string | null {
  return input.fromFrame && input.focused && input.activated ? message.url : null;
}

/** The least a frame stands: a line, so an empty page is still a page. */
const PAGE_MIN_HEIGHT = 48;

/**
 * The frame's height: the page's own as it says it, else as zcp's browser laid it out when it was
 * published; null while neither is known, when the frame stands at the cap every item shares
 * (`--run-words-cap`). The cap is the frame's max height: a taller page scrolls inside it.
 */
export function pageFrameHeight(content: number | null, recorded?: number): number | null {
  const height = content ?? recorded ?? null;
  return height === null ? null : Math.max(PAGE_MIN_HEIGHT, height);
}

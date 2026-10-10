/**
 * A page the Mate published for the person (`zerops_publish_page`), drawn in its conversation:
 * the document its frame shows, what the frame hears from it, and the frame's height.
 *
 * The frame is sandboxed with scripts alone — never the same origin — and the document opens with a
 * policy that allows no network at all, ahead of anything the page says: the page runs in an opaque
 * origin and can fetch, load or post nothing, so it reaches neither the network, the Mate's server
 * nor the person's session. No proxy or origin of its own is needed for that. It talks to the
 * conversation only by messages: its height, and a link the person clicked.
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
var post=function(m){m.mate="page";parent.postMessage(m,"*");};
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
addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data;
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

/** What a page said to the conversation: its height, or a link the person clicked. */
export type PageMessage =
  | { readonly kind: "height"; readonly height: number }
  | { readonly kind: "open"; readonly url: string };

/** A page's message, or null for anything else: another window's, a malformed one. */
export function readPageMessage(data: unknown): PageMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as { mate?: unknown; kind?: unknown; height?: unknown; url?: unknown };
  if (message.mate !== "page") return null;
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
 * The frame's height: the page's own — the frame's max height is the cap every item shares
 * (`--run-words-cap`), so a taller page scrolls inside it — or null while it is unknown, when the
 * frame stands at the cap.
 */
export function pageFrameHeight(content: number | null): number | null {
  return content === null ? null : Math.max(PAGE_MIN_HEIGHT, content);
}

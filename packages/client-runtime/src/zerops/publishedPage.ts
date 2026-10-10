/**
 * A page the Mate published for the person (`zerops_publish_page`), drawn in its conversation:
 * the documents its frames show, what the frames hear from it, and the frame's height.
 *
 * The page runs two frames deep. The conversation's frame, sandboxed with scripts alone (never the
 * same origin), holds a fixed wrapper document whose policy is `frame-src 'none'`; the page is the
 * wrapper's own `srcdoc` frame, sandboxed the same, behind a policy that lets it request nothing —
 * no fetch, script, style, picture, font, media or form submission from anywhere. Both run in
 * opaque origins, so the page reaches neither the Mate's server, the person's session nor the
 * conversation around it. Loading `about:srcdoc` fetches nothing, so the page loads; any later
 * navigation of its frame — http(s), `data:`, `blob:`, by script, refresh, link or named target —
 * is a request the wrapper's `frame-src` refuses before it leaves (measured in Chromium, WebKit and
 * Firefox). The wrapper, which the page cannot reach, also takes the page down on any load after
 * its first. WebRTC and DNS prefetch are governed by no policy: they carry only what the page holds.
 *
 * The page talks to the conversation only through the wrapper, by JSON strings it builds with
 * functions captured before the page's own scripts run: its height and a link the person clicked.
 */
import { CallResultPage } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { readRecord } from "./cards/decode.ts";

const decodePage = Schema.decodeUnknownOption(CallResultPage);
/** Each record's page, read once: a record read again gives the page it gave before. */
const pagesRead = new WeakMap<object, CallResultPage | undefined>();

/**
 * The page a call's record says it published (`data.zerops.page`), read the same by every client;
 * one that does not decode is none.
 */
export function readCallPage(payload: unknown): CallResultPage | undefined {
  const data = readRecord(readRecord(payload)?.data);
  const raw = data !== undefined ? readRecord(data.zerops)?.page : undefined;
  if (typeof raw !== "object" || raw === null) return undefined;
  if (!pagesRead.has(raw)) pagesRead.set(raw, Option.getOrUndefined(decodePage(raw)));
  return pagesRead.get(raw);
}

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
 * What runs in the page before the page does: it says the page's height whenever it changes and
 * hands a link the person clicked (http and https only) to the conversation, and takes the
 * conversation's colours when they change. Every function it needs is captured first, and its
 * messages are JSON strings of literals: a page's own script can neither replace what it calls nor
 * reach into what it says through a prototype.
 */
const PAGE_BOOTSTRAP = `(function(){
var host=window.parent,send=host.postMessage.bind(host),stringify=JSON.stringify,parse=JSON.parse;
var root=document.documentElement,last=-1;
var measure=function(){var b=document.body;
var h=Math.ceil(Math.max(root.getBoundingClientRect().height,b?b.scrollHeight:0));
if(h!==last){last=h;send(stringify({mate:"page",kind:"height",height:h}),"*");}};
var ro=new ResizeObserver(measure);ro.observe(root);
document.addEventListener("DOMContentLoaded",function(){if(document.body)ro.observe(document.body);measure();});
addEventListener("load",measure);
document.addEventListener("click",function(e){if(!e.isTrusted||e.defaultPrevented)return;
var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;
var u;try{u=new URL(a.getAttribute("href"),document.baseURI)}catch(_){return}
if(u.protocol!=="http:"&&u.protocol!=="https:")return;
e.preventDefault();send(stringify({mate:"page",kind:"open",url:u.href}),"*");},true);
addEventListener("message",function(e){if(e.source!==host||typeof e.data!=="string")return;var d;
try{d=parse(e.data)}catch(_){return}
if(!d||d.mate!=="page-theme"||typeof d.rule!=="string")return;
var s=document.getElementById("mate-page-theme");if(s)s.textContent=d.rule;});
})();`;

/** The page's document: its policy, the theme and the bootstrap first, then the page whole. */
function pageInner(html: string, theme: PageTheme): string {
  return (
    "<!doctype html><html><head>" +
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">` +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<style id="mate-page-theme">${themeRule(theme)}</style>` +
    `<style>html,body{background:var(--background);color:var(--foreground);font-family:var(--font-sans,system-ui,sans-serif);}body{margin:0;}</style>` +
    `<script>${PAGE_BOOTSTRAP}</script>` +
    html
  );
}

/** What the wrapper lets load: only its own inline script and style, and no frame but `about:srcdoc`. */
export const WRAPPER_POLICY =
  "default-src 'none'; frame-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";

/**
 * Who the wrapper talks to. On the web, the conversation's frame: the wrapper's parent window. In
 * a phone's web view, the app, through its bridge — which the web view also lets any frame of the
 * document call, the page's own among them. The app then reads only messages carrying the token
 * this wrapper was written with: the page runs in another origin and cannot read the wrapper's
 * script, so it cannot say it. The app's own messages reach the wrapper from no window at all.
 */
export type PageHost =
  | { readonly kind: "frame" }
  | { readonly kind: "native"; readonly token: string };

const FRAME_HOST: PageHost = { kind: "frame" };

/** A token that cannot leave the string it is written into. */
const SAFE_TOKEN = /^[\w-]{16,}$/;

/** The wrapper's link to its host: how it sends, and how it knows its host's own messages. */
function hostLink(host: PageHost): string {
  if (host.kind === "frame")
    return `var host=window.parent,post=host.postMessage.bind(host),stringify=JSON.stringify,parse=JSON.parse;
var send=function(m){post(stringify(m),"*");},fromHost=function(e){return e.source===host;};`;
  if (!SAFE_TOKEN.test(host.token))
    throw new Error("A page's token is letters, digits and dashes.");
  return `var bridge=window.ReactNativeWebView,post=bridge.postMessage.bind(bridge),stringify=JSON.stringify,parse=JSON.parse,token="${host.token}";
var send=function(m){m.token=token;post(stringify(m));},fromHost=function(e){return e.source===null;};`;
}

/**
 * The wrapper: the page in its frame, and a relay the page cannot reach. It passes the page's
 * height and links up as JSON strings it rebuilds, the conversation's colours down, and says the
 * page left on any load of its frame after the first, taking the frame away. It listens as a
 * message passes it on the way down, where a web view's bridge delivers to the document too.
 */
function wrapperScript(host: PageHost): string {
  return `(function(){
${hostLink(host)}
var frame=document.getElementById("page"),loads=0,gone=false;
var leave=function(){if(gone)return;gone=true;frame.remove();send({mate:"page",kind:"left"});};
frame.addEventListener("load",function(){loads++;if(loads>1)leave();});
addEventListener("message",function(e){if(typeof e.data!=="string")return;var d;
try{d=parse(e.data)}catch(_){return}if(!d||typeof d!=="object")return;
if(fromHost(e)){if(d.mate==="page-theme"&&typeof d.rule==="string"&&!gone&&frame.contentWindow){
if(d.scheme==="light"||d.scheme==="dark")document.documentElement.style.colorScheme=d.scheme;
frame.contentWindow.postMessage(stringify({mate:"page-theme",rule:d.rule}),"*");}return;}
if(gone||e.source!==frame.contentWindow||d.mate!=="page")return;
if(d.kind==="height"&&typeof d.height==="number")send({mate:"page",kind:"height",height:d.height});
else if(d.kind==="open"&&typeof d.url==="string")send({mate:"page",kind:"open",url:d.url});},true);
})();`;
}

const asAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/**
 * The document the conversation's frame shows — or a phone's web view: the wrapper, the page whole
 * in its own frame. What the page writes after its head opens — its doctype, its own `<html>` and
 * `<head>` — the parser folds into that head, so nothing of the page runs or loads before its
 * policy holds.
 */
export function pageDocument(html: string, theme: PageTheme, host: PageHost = FRAME_HOST): string {
  const script = wrapperScript(host);
  return (
    "<!doctype html><html><head>" +
    `<meta http-equiv="Content-Security-Policy" content="${WRAPPER_POLICY}">` +
    '<meta charset="utf-8">' +
    `<style>:root{color-scheme:${theme.scheme};}html,body{margin:0;height:100%;overflow:hidden;background:transparent;}iframe{display:block;width:100%;height:100%;border:0;}</style>` +
    `</head><body><iframe id="page" sandbox="allow-scripts" title="page" srcdoc="${asAttribute(pageInner(html, theme))}"></iframe>` +
    `<script>${script}</script></body></html>`
  );
}

/** The page inside the wrapper, as its frame's `srcdoc` holds it (for a test to read). */
export function innerDocumentOf(document: string): string | null {
  const match = /<iframe id="page" sandbox="allow-scripts" title="page" srcdoc="([^"]*)">/.exec(
    document,
  );
  return match === null ? null : match[1]!.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

/** What a page said to the conversation: its height, a link the person clicked, its leaving. */
export type PageMessage =
  | { readonly kind: "height"; readonly height: number }
  | { readonly kind: "open"; readonly url: string }
  | { readonly kind: "left" };

/**
 * A message from the wrapper, or null for anything else: another window's, one not from an opaque
 * origin, one not a JSON string the wrapper built, a malformed one. In a phone's web view, whose
 * messages carry no origin, it is the wrapper's only when it carries the wrapper's `token`.
 */
export function readPageMessage(
  data: unknown,
  origin = "null",
  token: string | null = null,
): PageMessage | null {
  if (origin !== "null" || typeof data !== "string") return null;
  let message: { mate?: unknown; kind?: unknown; height?: unknown; url?: unknown; token?: unknown };
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null) return null;
    message = parsed as typeof message;
  } catch {
    return null;
  }
  if (message.mate !== "page" || (token !== null && message.token !== token)) return null;
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

/** The colours the conversation hands a page as they change, as the wrapper reads them. */
export function themeMessage(theme: PageTheme): string {
  return JSON.stringify({ mate: "page-theme", scheme: theme.scheme, rule: themeRule(theme) });
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
 * The frame's height: the page's own as it says it; null until it does, when the frame stands at
 * the cap every item shares (`--run-words-cap`) and eases to the page's height once it is known.
 * The cap is the frame's max height: a taller page scrolls inside it.
 */
export function pageFrameHeight(content: number | null): number | null {
  return content === null ? null : Math.max(PAGE_MIN_HEIGHT, content);
}

/**
 * The cap every item of a run shares, for a client that sizes in numbers: the web's
 * `--run-words-cap`, `min(440px, 52svh)`, for a view this tall.
 */
export function pageCapHeight(viewHeight: number): number {
  return Math.round(Math.min(440, viewHeight * 0.52));
}

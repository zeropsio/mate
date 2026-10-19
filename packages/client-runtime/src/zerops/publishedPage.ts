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
import {
  CallResultPage,
  PAGE_HEIGHTS_KEPT,
  PAGE_WIDTH_MAX,
  PAGE_WIDTH_MIN,
  type PageHeight,
} from "@t3tools/contracts";
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
 * What runs in the page before the page does: it says the page's height, and the viewport it was
 * laid out in, whenever either changes — even one alone, so a frame asking whether the page grows
 * with its viewport always hears back (`pageFitHeard`) — and
 * hands a link the person clicked (http and https only) to the conversation, and takes the
 * conversation's colours when they change. Every function it needs is captured first, and its
 * messages are JSON strings of literals: a page's own script can neither replace what it calls nor
 * reach into what it says through a prototype.
 */
const PAGE_BOOTSTRAP = `(function(){
var host=window.parent,send=host.postMessage.bind(host),stringify=JSON.stringify,parse=JSON.parse;
var root=document.documentElement,last=-1,lastView=-1;
var measure=function(){var b=document.body,v=innerHeight;
var h=Math.ceil(Math.max(root.getBoundingClientRect().height,b?b.scrollHeight:0));
if(h!==last||v!==lastView){last=h;lastView=v;send(stringify({mate:"page",kind:"height",height:h,viewport:v}),"*");}};
var ro=new ResizeObserver(measure);ro.observe(root);addEventListener("resize",measure);
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

/**
 * What the wrapper lets load: its own inline script and style, no frame but `about:srcdoc` — and
 * what the page carries inline. The page's frame is the wrapper's `about:srcdoc`, which keeps the
 * wrapper's policy as well as its own: a picture both do not allow never shows (the owner,
 * 2026-10-13, of a page's screens drawn as broken images: "why are these not loading?").
 */
export const WRAPPER_POLICY = [
  "default-src 'none'",
  "frame-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
].join("; ");

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
if(d.kind==="height"&&typeof d.height==="number")send({mate:"page",kind:"height",height:d.height,viewport:typeof d.viewport==="number"?d.viewport:null});
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

/**
 * What a page said to the conversation: its height and the viewport it was laid out in (null from
 * a page that says none), a link the person clicked, its leaving.
 */
export type PageMessage =
  | { readonly kind: "height"; readonly height: number; readonly viewport: number | null }
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
  let message: {
    mate?: unknown;
    kind?: unknown;
    height?: unknown;
    viewport?: unknown;
    url?: unknown;
    token?: unknown;
  };
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
      ? {
          kind: "height",
          height: Math.max(0, Math.ceil(message.height)),
          viewport:
            typeof message.viewport === "number" && Number.isFinite(message.viewport)
              ? Math.max(0, Math.round(message.viewport))
              : null,
        }
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
 * Where a page's frame stands on its very first landing, before any client measured it: a modest
 * box it glides from, once, to the page's own height.
 */
export const PAGE_FIRST_HEIGHT = 240;

/**
 * The frame's height for a height the page says: its own, however tall, at least a line. Null
 * while it says none.
 */
export function pageFrameHeight(content: number | null): number | null {
  return content === null ? null : Math.max(PAGE_MIN_HEIGHT, content);
}

/**
 * How far past its frame a page is laid out while the frame asks whether the page grows with its
 * viewport: the frame's own edge hides it, so the asking never shows.
 */
export const PAGE_PROBE = 64;

/**
 * What a frame knows of the page it holds. A page its content sizes stands at its own height,
 * however tall, following it up and down. A page its viewport sizes — slides a viewport tall, an
 * opening of `100vh` — has no height of its own: each time its frame grew it would grow again,
 * without end, so it stands a screen tall (`pageScreenHeight`) and scrolls inside.
 */
export interface PageFit {
  /** The height the page says it stands at; null until it says one. */
  readonly content: number | null;
  /** What sizes the page, once the frame asked; null until a page outgrew its frame. */
  readonly sizedBy: "content" | "viewport" | null;
  /** While the frame asks: the height the page said before its viewport reached past the frame. */
  readonly asking: number | null;
}

export const PAGE_FIT_START: PageFit = { content: null, sizedBy: null, asking: null };

/**
 * The fit once the page says `said` while its frame stands at `standing`, the same fit when it
 * changes nothing. A page that says it is taller than its frame, before anything sized it, is
 * asked first: its viewport reaches `PAGE_PROBE` past the frame, which stands still, and the page
 * that grows by half of that or more grows with its viewport. One that grows less settles where
 * its frame meets it, as any page does.
 */
export function pageFitHeard(
  fit: PageFit,
  said: { readonly height: number; readonly viewport: number | null },
  standing: number,
): PageFit {
  if (fit.sizedBy === "viewport") return fit;
  if (fit.asking !== null) {
    // A height said before the viewport reached past the frame answers nothing yet.
    if (said.viewport === null || Math.abs(said.viewport - (standing + PAGE_PROBE)) > 1) return fit;
    return said.height - fit.asking >= PAGE_PROBE / 2
      ? { content: null, sizedBy: "viewport", asking: null }
      : { content: said.height, sizedBy: "content", asking: null };
  }
  if (said.height > standing && fit.sizedBy === null && said.viewport !== null)
    return { ...fit, asking: said.height };
  return said.height === fit.content ? fit : { ...fit, content: said.height };
}

/** A screen, for a page its viewport sizes: four fifths of the conversation's view. */
export function pageScreenHeight(visible: number): number {
  return Math.max(PAGE_FIRST_HEIGHT, Math.round(visible * 0.8));
}

/**
 * Where a fitted page's frame stands: a screen for a page its viewport sizes (`screen`), else as
 * `pageStandHeight` places it — its own height once it says one, never moved while it is asked.
 */
export function pageFitStand(input: {
  readonly fit: PageFit;
  readonly heights: ReadonlyArray<PageHeight>;
  readonly width: number;
  readonly screen: number;
}): number {
  return input.fit.sizedBy === "viewport"
    ? input.screen
    : pageStandHeight({ content: input.fit.content, heights: input.heights, width: input.width });
}

/** The height recorded at the width nearest `width`; null when none is recorded. */
export function recordedPageHeight(
  heights: ReadonlyArray<PageHeight> | undefined,
  width: number,
): number | null {
  let nearest: PageHeight | null = null;
  for (const height of heights ?? [])
    if (nearest === null || Math.abs(height[0] - width) < Math.abs(nearest[0] - width))
      nearest = height;
  return nearest === null ? null : pageFrameHeight(nearest[1]);
}

/**
 * Where a page's frame stands before its width is read, in its first draw: the height last
 * recorded, the likeliest at its width; null when none is. A list measures a row as it is first
 * drawn, and a page reloaded in its first box was measured 129 px short (run 9: the conversation
 * landed 320 px short of its end and glided there).
 */
export function pageFirstDrawHeight(heights: ReadonlyArray<PageHeight> | undefined): number | null {
  const last = heights?.at(-1);
  return last === undefined ? null : pageFrameHeight(last[1]);
}

/**
 * The heights this client laid pages out at while it runs, by the page's call: a frame mounted
 * again before its record carries them paints at them too. Memory only, never stored.
 */
const measured = new Map<string, Array<PageHeight>>();

/** What this client measured a page's call at, with what its record carries. */
export function knownPageHeights(
  itemId: string,
  recorded: ReadonlyArray<PageHeight> | undefined,
): ReadonlyArray<PageHeight> {
  const own = measured.get(itemId) ?? [];
  return [...(recorded ?? []).filter(([width]) => !own.some(([at]) => at === width)), ...own];
}

/**
 * Where a page's frame stands: the height the page says once it says one; before that the height
 * recorded at the nearest width, so a page measured once paints at it from its first frame; else,
 * on its very first landing, `PAGE_FIRST_HEIGHT`.
 */
export function pageStandHeight(input: {
  readonly content: number | null;
  readonly heights: ReadonlyArray<PageHeight>;
  readonly width: number;
}): number {
  return (
    pageFrameHeight(input.content) ??
    recordedPageHeight(input.heights, input.width) ??
    PAGE_FIRST_HEIGHT
  );
}

/**
 * The `[width, height]` to record for a page laid out at `width` standing at `content`: its frame's
 * width and height, rounded; null when what is known at that width already says it.
 * Remembered in memory as it is decided, so a frame mounted again paints at it.
 */
export function pageHeightToRecord(input: {
  readonly itemId: string;
  readonly heights: ReadonlyArray<PageHeight>;
  readonly width: number;
  readonly content: number;
}): PageHeight | null {
  const width = Math.round(input.width);
  const height = pageFrameHeight(Math.round(input.content))!;
  if (width < PAGE_WIDTH_MIN || width > PAGE_WIDTH_MAX) return null;
  if (input.heights.some(([at, tall]) => at === width && tall === height)) return null;
  const own = (measured.get(input.itemId) ?? []).filter(([at]) => at !== width);
  measured.set(input.itemId, [...own, [width, height] as const].slice(-PAGE_HEIGHTS_KEPT));
  return [width, height];
}

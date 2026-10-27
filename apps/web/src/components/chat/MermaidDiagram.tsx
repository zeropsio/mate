import type DOMPurify from "dompurify";
import type { Mermaid } from "mermaid";
import { useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import {
  diagramCss,
  diagramStyleAttribute,
  MERMAID_SECURE_KEYS,
  type MermaidRenderResult,
} from "./mermaidDiagram.logic";

let mermaidModulePromise: Promise<{ mermaid: Mermaid; purify: typeof DOMPurify }> | null = null;
let renderQueue: Promise<unknown> = Promise.resolve();
let nextDiagramId = 0;
const MAX_CACHED_RENDERS = 64;
// Keyed by theme and the full source, so distinct diagrams never share an entry.
const renderCache = new Map<string, Promise<MermaidRenderResult>>();
// What each key settled to, read synchronously so a remount paints its diagram at once.
const settledRenders = new Map<string, MermaidRenderResult>();

// Mermaid is ~1MB, so it and its sanitizer load only once a diagram is shown.
function loadMermaid(): Promise<{ mermaid: Mermaid; purify: typeof DOMPurify }> {
  mermaidModulePromise ??= Promise.all([import("mermaid"), import("dompurify")])
    .then(([mermaid, purify]) => ({ mermaid: mermaid.default, purify: purify.default }))
    .catch((error: unknown) => {
      mermaidModulePromise = null;
      throw error;
    });
  return mermaidModulePromise;
}

let purifier: ReturnType<typeof DOMPurify> | null = null;
// The diagram being sanitized; renders run one at a time.
let sanitizingId = "";

// A diagram comes from the agent's words, so strip anything that can navigate,
// run script, or fetch remote content on top of Mermaid's own strict
// sanitization. Its stylesheet keeps only rules on the diagram itself, and no
// CSS keeps anything that fetches or pins; label text is untouched.
function sanitizeMermaidSvg(createPurifier: typeof DOMPurify, svg: string, id: string): string {
  sanitizingId = id;
  if (!purifier) {
    purifier = createPurifier(window);
    purifier.addHook("uponSanitizeElement", (node, data) => {
      if (data.tagName === "style") {
        node.textContent = diagramCss(node.textContent ?? "", sanitizingId);
      }
    });
    purifier.addHook("uponSanitizeAttribute", (_node, data) => {
      if (data.attrName === "style") data.attrValue = diagramStyleAttribute(data.attrValue);
    });
  }
  return purifier.sanitize(svg, {
    ADD_TAGS: ["foreignObject"],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_ATTR: ["href", "xlink:href", "src", "srcset"],
    FORBID_TAGS: ["a", "img", "image", "script"],
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
  });
}

// Mermaid also lazy-loads diagram chunks inside render(); losing the network
// there is worth a retry, unlike a syntax error.
const CHUNK_LOAD_ERROR = /dynamically imported module|importing a module script|failed to fetch/i;

async function renderMermaid(
  source: string,
  theme: "light" | "dark",
): Promise<MermaidRenderResult> {
  const id = `mermaid-diagram-${nextDiagramId++}`;
  let mermaid: Mermaid;
  let purify: typeof DOMPurify;
  try {
    ({ mermaid, purify } = await loadMermaid());
  } catch {
    return { status: "error", message: "Mermaid failed to load.", retryable: true };
  }
  try {
    // initialize() mutates global config, so renders run one at a time.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      // HTML labels, theme CSS, theme variables and fonts reach the diagram's
      // stylesheet unescaped, and Mermaid mounts it while laying the diagram
      // out, before sanitizing, so diagram directives must not set them.
      secure: [...MERMAID_SECURE_KEYS],
      htmlLabels: false,
      // Set at the answer's code size and spacing, so a diagram of a dozen
      // steps fits its frame without scaling its words below legibility.
      flowchart: { htmlLabels: false, nodeSpacing: 32, rankSpacing: 32, padding: 10 },
      // Neutral greys in light, Mermaid's own dark in dark: no theme hue of its own.
      theme: theme === "dark" ? "dark" : "neutral",
      themeVariables: { fontSize: "13px" },
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    const { svg } = await mermaid.render(id, source);
    return { status: "rendered", svg: sanitizeMermaidSvg(purify, svg, id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The diagram could not be drawn.";
    return { status: "error", message, retryable: CHUNK_LOAD_ERROR.test(message) };
  } finally {
    document.getElementById(`d${id}`)?.remove();
  }
}

function evictSettledRenders() {
  for (const key of renderCache.keys()) {
    if (renderCache.size <= MAX_CACHED_RENDERS) return;
    if (settledRenders.has(key)) {
      renderCache.delete(key);
      settledRenders.delete(key);
    }
  }
}

function mermaidRenderKey(source: string, theme: "light" | "dark") {
  return `${theme}\n${source}`;
}

function mermaidRenderPromise(key: string, source: string, theme: "light" | "dark") {
  const cached = renderCache.get(key);
  if (cached) {
    renderCache.delete(key);
    renderCache.set(key, cached);
    return cached;
  }
  const result = renderQueue.then(() => renderMermaid(source, theme));
  renderQueue = result;
  void result.then((settled) => {
    // A lost network is tried again on the next mount; a syntax error stays settled.
    if (settled.status === "error" && settled.retryable) {
      renderCache.delete(key);
      return;
    }
    settledRenders.set(key, settled);
    evictSettledRenders();
  });
  renderCache.set(key, result);
  evictSettledRenders();
  return result;
}

/**
 * The diagram `source` draws in `theme`, or `null` while it is drawn. A theme
 * change keeps the last drawing until the new one is ready, so the frame never
 * empties.
 */
export function useMermaidDiagram(
  source: string,
  theme: "light" | "dark",
  enabled: boolean,
): MermaidRenderResult | null {
  const trimmed = source.trim();
  const key = mermaidRenderKey(trimmed, theme);
  const [drawn, setDrawn] = useState<{ key: string; result: MermaidRenderResult } | null>(null);
  const settled = enabled ? (settledRenders.get(key) ?? null) : null;

  useEffect(() => {
    if (!enabled || trimmed.length === 0 || settledRenders.has(key)) return;
    let live = true;
    void mermaidRenderPromise(key, trimmed, theme).then((result) => {
      if (live) setDrawn({ key, result });
    });
    return () => {
      live = false;
    };
  }, [enabled, key, theme, trimmed]);

  if (!enabled) return null;
  return settled ?? drawn?.result ?? null;
}

let expandedImageUrl: string | null = null;

/**
 * Converts a drawn diagram into a standalone image with fixed size and background.
 * A blob URL, unlike a data URL, passes the desktop connect-src policy that media
 * save and copy actions fetch through. Only one diagram is expanded at a time, so
 * the previous URL is released.
 */
export function mermaidImageUrl(svg: string): string {
  const svgDocument = new DOMParser().parseFromString(svg, "image/svg+xml");
  const element = svgDocument.documentElement;
  const viewBox = element.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    element.setAttribute("width", String(viewBox[2]));
    element.setAttribute("height", String(viewBox[3]));
  }
  element.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  element.style.maxWidth = "none";
  element.style.backgroundColor = getComputedStyle(document.body).backgroundColor;
  if (expandedImageUrl) URL.revokeObjectURL(expandedImageUrl);
  expandedImageUrl = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(element)], { type: "image/svg+xml" }),
  );
  return expandedImageUrl;
}

/**
 * The drawn diagram sized to fit its frame whole: never past its own size, and
 * scaled down when its frame is smaller, so its words stay as drawn when it fits.
 */
function fittedSvg(svg: string): string {
  const svgDocument = new DOMParser().parseFromString(svg, "image/svg+xml");
  const element = svgDocument.documentElement;
  const viewBox = element.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (viewBox?.length !== 4 || !viewBox.every(Number.isFinite)) return svg;
  element.removeAttribute("width");
  element.removeAttribute("height");
  element.setAttribute(
    "style",
    `max-width: min(100%, ${viewBox[2]}px); max-height: ${viewBox[3]}px; width: auto; height: 100%;`,
  );
  return new XMLSerializer().serializeToString(element);
}

/** A drawn diagram, whole in its frame; a press opens it full size when the answer can. */
export function MermaidSvg({
  svg,
  onExpand,
}: {
  svg: string;
  onExpand: ((imageUrl: string) => void) | null;
}) {
  const fitted = useMemo(() => fittedSvg(svg), [svg]);
  const fit = "flex size-full items-center justify-center";
  if (onExpand === null) {
    return <div className={cn(fit)} dangerouslySetInnerHTML={{ __html: fitted }} />;
  }
  return (
    <button
      type="button"
      aria-label="Open the diagram"
      className={cn(
        fit,
        "cursor-zoom-in rounded-md focus-visible:outline-2 focus-visible:outline-ring",
      )}
      onClick={() => onExpand(mermaidImageUrl(svg))}
      dangerouslySetInnerHTML={{ __html: fitted }}
    />
  );
}

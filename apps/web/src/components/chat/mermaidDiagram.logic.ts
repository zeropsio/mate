export type MermaidRenderResult =
  | { readonly status: "rendered"; readonly svg: string }
  | { readonly status: "error"; readonly message: string; readonly retryable: boolean };

/**
 * What a Mermaid fence's frame holds. The frame keeps one height in every
 * state, so streaming, drawing, the diagram and a fallback never move the
 * answer around it.
 */
export type MermaidFrame = "source" | "drawing" | "diagram" | "fallback";

export function mermaidFrame(input: {
  readonly streaming: boolean;
  readonly showCode: boolean;
  readonly source: string;
  readonly result: MermaidRenderResult | null;
}): MermaidFrame {
  if (input.streaming || input.showCode || input.source.trim().length === 0) return "source";
  if (input.result === null) return "drawing";
  return input.result.status === "rendered" ? "diagram" : "fallback";
}

const REMOTE_CSS_URL = /url\(\s*(?!['"]?#)[^)]*\)/giu;

/** A diagram's CSS keeps its local `url(#id)` references and loses every other address. */
export function withoutRemoteCssUrls(css: string): string {
  return css.replace(REMOTE_CSS_URL, "none");
}

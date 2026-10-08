import { describe, expect, it } from "vite-plus/test";

import {
  diagramCss,
  diagramStyleAttribute,
  MERMAID_SECURE_KEYS,
  mermaidFrame,
} from "./mermaidDiagram.logic";

const SOURCE = "flowchart TD\n  A --> B";
const drawn = { status: "rendered", svg: "<svg></svg>" } as const;
const failed = { status: "error", message: "Parse error", retryable: false } as const;

describe("mermaidFrame", () => {
  it.each([
    {
      sentence: "a diagram still streaming shows its source",
      input: { streaming: true, showCode: false, source: SOURCE, result: drawn },
      frame: "source",
    },
    {
      sentence: "an empty fence shows its (empty) source",
      input: { streaming: false, showCode: false, source: "  \n", result: null },
      frame: "source",
    },
    {
      sentence: "a settled diagram holds its frame while it is drawn",
      input: { streaming: false, showCode: false, source: SOURCE, result: null },
      frame: "drawing",
    },
    {
      sentence: "a drawn diagram shows the diagram",
      input: { streaming: false, showCode: false, source: SOURCE, result: drawn },
      frame: "diagram",
    },
    {
      sentence: "Show code shows the source of a drawn diagram",
      input: { streaming: false, showCode: true, source: SOURCE, result: drawn },
      frame: "source",
    },
    {
      sentence: "a diagram that cannot be drawn falls back to its source",
      input: { streaming: false, showCode: false, source: SOURCE, result: failed },
      frame: "fallback",
    },
  ] as const)("$sentence", ({ input, frame }) => {
    expect(mermaidFrame(input)).toBe(frame);
  });
});

describe("a diagram's remote addresses", () => {
  it.each([
    {
      sentence: "a diagram's styles cannot fetch a remote address",
      css: "fill: url(https://evil.test/x.svg); stroke: #333",
      expected: "stroke: #333",
    },
    {
      sentence: "a quoted remote address is removed too",
      css: "background: url( 'http://evil.test/a.png' ); fill: none",
      expected: "fill: none",
    },
    {
      sentence: "a diagram's own markers and gradients stay",
      css: "marker-end: url(#arrowhead); fill: url('#gradient')",
      expected: "marker-end: url(#arrowhead);fill: url('#gradient')",
    },
  ])("$sentence", ({ css, expected }) => {
    expect(diagramStyleAttribute(css)).toBe(expected);
  });
});

describe("diagramCss", () => {
  const ID = "mermaid-diagram-3";
  it.each([
    {
      sentence: "a diagram's own scoped rules stay",
      css: `#${ID}{font-family:Inter;fill:#333;}#${ID} .node rect{stroke:#999;}`,
      expected: `#${ID}{font-family:Inter;fill:#333}#${ID} .node rect{stroke:#999}`,
    },
    {
      sentence: "a font that breaks out of its rule cannot style the rest of the app",
      css: `#${ID}{font-family:x} body{display:none} #${ID} .a{color:red;}`,
      expected: `#${ID}{font-family:x}#${ID} .a{color:red}`,
    },
    {
      sentence: "a diagram cannot pin itself over the window",
      css: `#${ID}{font-family:x; position: fixed !important; inset: 0; z-index: 2147483647;}`,
      expected: `#${ID}{font-family:x;inset: 0;z-index: 2147483647}`,
    },
    {
      sentence: "a diagram's styles fetch nothing through image-set",
      css: `#${ID}{font-family:x; background-image: image-set("https://evil.example/p.png" 1x);}`,
      expected: `#${ID}{font-family:x}`,
    },
    {
      sentence: "a diagram's styles fetch nothing through url, image or cross-fade",
      css: `#${ID} .a{fill:url(https://e.example/a);stroke:url(#arrow);background:-webkit-image-set(url(x) 1x);mask:cross-fade(url(a),url(b),50%);list-style:image("x")}`,
      expected: `#${ID} .a{stroke:url(#arrow)}`,
    },
    {
      sentence: "imports, font faces and other at-rules are dropped; keyframes stay",
      css: `@import url(https://e.example/x.css);@font-face{src:url(https://e.example/f.woff)}@keyframes dash{to{stroke-dashoffset:0;}}#${ID}{fill:red}`,
      expected: `@keyframes dash{to{stroke-dashoffset:0}}#${ID}{fill:red}`,
    },
    {
      sentence: "a stylesheet that cannot be read is dropped whole",
      css: `#${ID}{font-family:"x}`,
      expected: "",
    },
  ])("$sentence", ({ css, expected }) => {
    expect(diagramCss(css, ID)).toBe(expected);
  });
});

describe("diagramStyleAttribute", () => {
  it("keeps a node's inline style and drops what would pin or fetch", () => {
    expect(
      diagramStyleAttribute(
        "fill:#fff; position:fixed; background-image:image-set('https://e.example/p.png' 1x)",
      ),
    ).toBe("fill:#fff");
  });
});

describe("MERMAID_SECURE_KEYS", () => {
  it("keeps a diagram's directives off every setting that reaches its CSS", () => {
    for (const key of ["fontFamily", "altFontFamily", "fontSize", "themeVariables", "themeCSS"]) {
      expect(MERMAID_SECURE_KEYS).toContain(key);
    }
  });
});

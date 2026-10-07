import { describe, expect, it } from "vite-plus/test";

import { mermaidFrame, withoutRemoteCssUrls } from "./mermaidDiagram.logic";

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

describe("withoutRemoteCssUrls", () => {
  it.each([
    {
      sentence: "a diagram's styles cannot fetch a remote address",
      css: ".node { fill: url(https://evil.test/x.svg); }",
      expected: ".node { fill: none; }",
    },
    {
      sentence: "a quoted remote address is removed too",
      css: "background: url( 'http://evil.test/a.png' )",
      expected: "background: none",
    },
    {
      sentence: "a diagram's own markers and gradients stay",
      css: "marker-end: url(#arrowhead); fill: url('#gradient')",
      expected: "marker-end: url(#arrowhead); fill: url('#gradient')",
    },
  ])("$sentence", ({ css, expected }) => {
    expect(withoutRemoteCssUrls(css)).toBe(expected);
  });
});

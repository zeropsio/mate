import { describe, expect, it } from "vite-plus/test";

import { pageBlocks, textBlocks } from "./pageStructure.logic";

/** agent-browser's own snapshot of a status page, compacted (`snapshot -c`). */
const STATUS_PAGE = [
  "- generic",
  "  - banner",
  '    - link "Snap" [ref=e1]',
  "    - navigation",
  '      - link "Docs" [ref=e2]',
  '  - heading "Service status" [level=1, ref=e3]',
  '    - StaticText "Service status"',
  "  - paragraph",
  '    - StaticText "Everything runs as it should."',
  "  - generic",
  '    - StaticText "Uptime"',
  '    - StaticText " "',
  '    - StaticText "3 days"',
  "  - list",
  "    - listitem",
  '      - StaticText "Hostname: app"',
  "    - listitem",
  '      - StaticText "Node "',
  "      - code",
  '        - StaticText "v22.22.3"',
  '  - img "Status chart"',
  '  - textbox "Email" [ref=e4]',
  '  - button "Subscribe" [ref=e5]',
  "  - text: Last deployed 2 hours ago",
].join("\n");

describe("pageBlocks", () => {
  it("reads a page's tree top to bottom as what it shows, its containers dropped", () => {
    expect(pageBlocks(STATUS_PAGE)).toEqual([
      { kind: "link", text: "Snap" },
      { kind: "link", text: "Docs" },
      { kind: "heading", level: 1, text: "Service status" },
      { kind: "text", text: "Everything runs as it should." },
      { kind: "text", text: "Uptime 3 days" },
      { kind: "item", text: "Hostname: app" },
      { kind: "item", text: "Node v22.22.3" },
      { kind: "image", text: "Status chart" },
      { kind: "field", text: "Email" },
      { kind: "button", text: "Subscribe" },
      { kind: "text", text: "Last deployed 2 hours ago" },
    ]);
  });

  it("stops at its limit: a page's shape is in its first screens", () => {
    const long = Array.from(
      { length: 200 },
      (_, index) => `- heading "Part ${index}" [level=2]`,
    ).join("\n");
    expect(pageBlocks(long, 10)).toHaveLength(10);
  });

  it.each([
    { name: "nothing", tree: "" },
    { name: "only containers", tree: "- generic\n  - generic\n    - main" },
    { name: "lines it cannot read", tree: "Page loaded.\nNo tree here." },
  ])("reads $name as no blocks", ({ tree }) => {
    expect(pageBlocks(tree)).toEqual([]);
  });

  it("reads a quoted name with quotes in it", () => {
    expect(pageBlocks('- heading "The \\"Service status\\" page" [level=2]')).toEqual([
      { kind: "heading", level: 2, text: 'The "Service status" page' },
    ]);
  });
});

describe("textBlocks", () => {
  it("reads a page's text as its lines", () => {
    expect(textBlocks("Service status\n\n  Uptime   3 days \n")).toEqual([
      { kind: "text", text: "Service status" },
      { kind: "text", text: "Uptime 3 days" },
    ]);
  });
});

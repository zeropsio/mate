import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ComposerPathSearchState } from "@t3tools/client-runtime/state/threads";

import { TestNode } from "../zerops/__fixtures__/testDom";

const SEARCH_RESULT = [
  { path: "src/index.ts", kind: "file", parentPath: "src" },
  { path: "src/lib", kind: "directory", parentPath: "src" },
] as const;

let queryEntries: () => ReadonlyArray<(typeof SEARCH_RESULT)[number]> = () => [];

vi.mock("../state/queries", () => ({
  useComposerPathSearch: () => ({
    entries: queryEntries(),
    error: null,
    isPending: false,
    searchedQuery: "",
    refresh: () => undefined,
  }),
}));

function installTestDom(): TestNode {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return document;
}

afterEach(() => {
  queryEntries = () => [];
  vi.unstubAllGlobals();
});

describe("useComposerPathSearch", () => {
  // The composer's menu items are memoized on these entries, and the menu's
  // highlight sync runs whenever the items change identity.
  it.each([
    { result: "no search result", entries: () => [], expected: [] },
    {
      result: "an unchanged search result",
      entries: () => SEARCH_RESULT,
      expected: [
        { path: "src/index.ts", kind: "file" },
        { path: "src/lib", kind: "directory" },
      ],
    },
  ])("hands out the same entries across renders over $result", async ({ entries, expected }) => {
    queryEntries = entries;
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useComposerPathSearch } = await import("./composerPathSearchState");
    const seen: Array<ComposerPathSearchState["entries"]> = [];

    function Probe() {
      seen.push(useComposerPathSearch({ environmentId: null, cwd: "/repo", query: "src" }).entries);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => root.render(<Probe />));
      await act(() => root.render(<Probe />));
    } finally {
      await act(() => root.unmount());
    }

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(expected);
    expect(seen[1]).toBe(seen[0]);
  });
});

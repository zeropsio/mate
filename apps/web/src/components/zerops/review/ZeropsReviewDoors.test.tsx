/**
 * Review is the one door (pass 16, R1): every door this part owns opens the review, and none of
 * them merges, releases, rolls back or lands by itself. The review's own surface says what its
 * button does and presses it only while it is safe (R5).
 */
import {
  parseChangeDiff,
  releaseRow,
  type FlowRelease,
  type ReviewVerdict,
} from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { elementsOf, TestNode } from "~/zerops/__fixtures__/testDom";

import { ZeropsReleaseRows } from "../ZeropsReleaseRows";
import {
  ReviewDiff,
  ZeropsReviewSurface,
  type ReviewDiffState,
  type ZeropsReviewSurfaceProps,
} from "./ZeropsReviewSurface";

/** The test DOM, able to hold an SVG. */
class SvgDocument extends TestNode {
  createElementNS(_namespace: string, name: string) {
    return new TestNode(name, this);
  }
}

function installTestDom(): TestNode {
  const document = new SvgDocument("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    Element: TestNode,
    HTMLElement: TestNode,
    HTMLIFrameElement: TestNode,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  vi.stubGlobal("Element", TestNode);
  vi.stubGlobal("HTMLElement", TestNode);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return document;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Presses `button` the way React sees it, with the element that was pressed. */
function pressFrom(button: TestNode): void {
  const propsKey = Object.keys(button).find((key) => key.startsWith("__reactProps$"));
  const props = propsKey === undefined ? undefined : (button as never)[propsKey];
  const onClick = (props as { readonly onClick?: (event: unknown) => void } | undefined)?.onClick;
  if (onClick === undefined) throw new Error(`"${button.textContent}" has no click handler.`);
  onClick({ currentTarget: button });
}

describe("Roll back to this opens the roll back's review, from the row pressed", () => {
  it("hands over the version it goes back to and what was pressed, and rolls nothing back", async () => {
    const earlier: FlowRelease = {
      tag: "v1.1.0",
      verdict: "approved",
      detail: undefined,
      line: "app ccccccc",
      entries: [{ service: "app", commit: "c".repeat(40) }],
      taggedAt: "2026-09-25T07:00:00Z",
    };
    const rows = [
      releaseRow(earlier, 1, {
        production: new Map([["app", "a".repeat(40)]]),
        failed: [],
        live: false,
      }),
    ];
    const onRollBack = vi.fn();
    const document = installTestDom();
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("ul");
    const root = createRoot(container as unknown as Element);
    try {
      await act(async () =>
        root.render(
          <ZeropsReleaseRows
            groupId="shop"
            onRollBack={onRollBack}
            pending={new Set()}
            releases={rows}
          />,
        ),
      );
      const button = elementsOf(container, "button").find(
        (candidate) => candidate.textContent.trim() === "Roll back to this",
      );
      if (button === undefined) throw new Error("no Roll back to this");
      await act(async () => pressFrom(button));
      expect(onRollBack.mock.calls).toEqual([["v1.1.0", button]]);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

const VERDICT: ReviewVerdict = {
  state: "ready",
  tone: "ok",
  title: "Ready to merge",
  why: "No conflicts with main · 1 commit",
  fix: undefined,
};

function surface(over: Partial<ZeropsReviewSurfaceProps> = {}): string {
  return renderToStaticMarkup(
    <ZeropsReviewSurface
      consequence="Squash-merges 1 commit into main. Production isn't touched until you release."
      kind="change"
      kindLabel="Review · change"
      onClose={() => {}}
      primary={{ label: "Merge", enabled: true, safe: true, onPress: () => {} }}
      title="Add a /status page"
      verdict={VERDICT}
      {...over}
    />,
  );
}

describe("the review's one button (R5)", () => {
  it.each([
    ["safe: pressable, with its keys", { enabled: true, safe: true }, false, true, "true"],
    ["blocked: off, no keys", { enabled: false, safe: false }, true, false, "false"],
    [
      "pressable but not safe: no keys, no focus",
      { enabled: true, safe: false },
      false,
      false,
      "false",
    ],
    ["running: off while it runs", { enabled: true, safe: true, busy: true }, true, false, "false"],
    [
      "waiting for what it acts on to be read: off, its keys kept in place",
      { enabled: false, safe: false, shortcut: true },
      true,
      true,
      "false",
    ],
  ] as const)("%s", (_case, state, disabled, keys, safe) => {
    const html = surface({ primary: { label: "Merge", onPress: () => {}, ...state } });
    const button = /<button[^>]*data-review-primary[^>]*>[\s\S]*?<\/button>/u.exec(html)?.[0] ?? "";
    expect(button.includes(" disabled")).toBe(disabled);
    expect(button.includes("<kbd")).toBe(keys);
    expect(button).toContain(`data-safe="${safe}"`);
  });

  it("says what the button does beside it, and the verdict first", () => {
    const html = surface();
    expect(html.indexOf("Ready to merge")).toBeLessThan(html.indexOf("Squash-merges 1 commit"));
    expect(html).toContain('data-tone="ok"');
    expect(html).toContain('data-review-state="ready"');
  });

  it.each([
    [
      "offers the fix where there is a Mate of the person's to ask",
      { label: "Ask Nova to resolve it", onPress: () => {} },
      true,
    ],
    ["offers none where there is none", undefined, false],
  ] as const)("%s", (_case, fix, shown) => {
    expect(surface({ fix }).includes(">Ask Nova to resolve it</button>")).toBe(shown);
  });

  it("closes from its ×, and from Cancel or Close where it offers one", () => {
    expect(surface()).toContain('aria-label="Close"');
    expect(surface({ dismiss: "Cancel" })).toContain(">Cancel</button>");
  });
});

describe("one review, two frames", () => {
  it.each([
    [
      "a dialog: its kind, its way to its page, its × and its Close",
      "dialog",
      ["Review · change", "Open as page", 'aria-label="Close"', ">Close</button>", "<h2"],
      [],
    ],
    [
      "a page: the review itself, nothing to close, its title the page's",
      "page",
      ["<h1"],
      ["Review · change", "Open as page", 'aria-label="Close"', ">Close</button>"],
    ],
  ] as const)("is drawn in %s", (_case, frame, has, hasNot) => {
    const html = surface({ frame, dismiss: "Close", onOpenPage: () => {} });
    for (const words of has) expect(html).toContain(words);
    for (const words of hasNot) expect(html).not.toContain(words);
  });

  it("offers its page only where it has one", () => {
    expect(surface({ onOpenPage: undefined })).not.toContain("Open as page");
  });

  it("says what its one button does, beside it, in both", () => {
    for (const frame of ["dialog", "page"] as const) {
      const html = surface({ frame });
      expect(html).toContain("Squash-merges 1 commit into main.");
      expect(html).toContain('data-review-primary=""');
    }
  });
});

describe("the page presses its button on ⌘↵ while it is safe, never from a field", () => {
  class Field extends TestNode {}

  it.each([
    ["from the page", false, true, true],
    ["from the comment box", true, true, false],
    ["while it is not safe", false, false, false],
  ])("%s", async (_case, inField, safe, pressed) => {
    const document = installTestDom();
    vi.stubGlobal("HTMLTextAreaElement", Field);
    vi.stubGlobal("HTMLInputElement", Field);
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    const root = createRoot(container as unknown as Element);
    const onPress = vi.fn();
    try {
      await act(async () =>
        root.render(
          <ZeropsReviewSurface
            consequence="Squash-merges 1 commit into main."
            frame="page"
            kind="change"
            kindLabel="Review · change"
            onClose={() => {}}
            primary={{ label: "Merge", enabled: true, safe, onPress }}
            title="Add a /status page"
            verdict={VERDICT}
          />,
        ),
      );
      const page = elementsOf(container, "h1")[0]?.parentNode?.parentNode;
      if (page === undefined || page === null) throw new Error("no page");
      const propsKey = Object.keys(page).find((key) => key.startsWith("__reactProps$"));
      const props = (propsKey === undefined ? {} : (page as never)[propsKey]) as {
        readonly onKeyDown?: (event: unknown) => void;
      };
      const target = inField ? new Field("textarea", document) : new TestNode("div", document);
      await act(async () =>
        props.onKeyDown?.({
          key: "Enter",
          metaKey: true,
          ctrlKey: false,
          repeat: false,
          target,
          preventDefault() {},
        }),
      );
      expect(onPress).toHaveBeenCalledTimes(pressed ? 1 : 0);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

const STOPPED_INSIDE = parseChangeDiff(
  ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1,2 @@", "-x", "+y", "+z"].join(
    "\n",
  ),
  { cut: true },
).get("a.ts");

describe("a diff too long to read here says so (D4)", () => {
  it.each<[string, ReviewDiffState, string]>([
    [
      "a file the read stopped inside",
      { kind: "read", file: STOPPED_INSIDE, cut: true },
      "The rest is too long to read here.",
    ],
    [
      "a file past where the read stopped",
      { kind: "read", file: undefined, cut: true },
      "Too long to read here.",
    ],
    [
      "a file with nothing to show in a diff read whole",
      { kind: "read", file: undefined, cut: false },
      "Nothing to show for this file.",
    ],
  ])("%s", (_case, diff, words) => {
    const html = renderToStaticMarkup(<ReviewDiff diff={diff} />);
    expect(html).toContain(words);
    expect(html).not.toContain("href=");
  });
});

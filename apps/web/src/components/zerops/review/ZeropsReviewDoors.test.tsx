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

import crewBoardSource from "../crew/CrewBoardPanel.tsx?raw";
import crewLaneBarSource from "../crew/CrewLaneBar.tsx?raw";
import crewLeadPlanSource from "../crew/CrewLeadPlan.tsx?raw";
import crewSectionSource from "../crew/CrewSection.tsx?raw";
import gitSurfaceSource from "../ZeropsGitSurface.tsx?raw";
import gitTabSource from "../ZeropsGitTab.tsx?raw";
import groupDetailSource from "../ZeropsGroupDetail.tsx?raw";
import projectsPageSource from "../ZeropsProjectsPage.tsx?raw";
import releaseRowsSource from "../ZeropsReleaseRows.tsx?raw";
import reviewDialogSource from "./ZeropsReviewDialog.tsx?raw";
import { ZeropsReleaseRows } from "../ZeropsReleaseRows";
import {
  ReviewDiff,
  ReviewFiles,
  ZeropsReviewSurface,
  type ReviewDiffState,
  type ZeropsReviewSurfaceProps,
} from "./ZeropsReviewSurface";

/** What acting directly looks like in a door's source: a flow verb or a crew landing. */
const ACTS = [
  ".mergePullRequest(",
  ".release(",
  ".rollBack(",
  '_tag: "land"',
  '_tag: "landNow"',
] as const;

describe("every door opens the review and never acts itself (R1)", () => {
  it.each([
    [
      "the projects page",
      projectsPageSource,
      ["openReview(", 'kind: "change"', 'kind: "rollback"'],
    ],
    [
      "a change's, a project's and a stop's pages",
      groupDetailSource,
      ["openReview(", 'kind: "change"', 'kind: "release"', 'kind: "rollback"'],
    ],
    ["the Git tab", gitTabSource, ["onReviewPullRequest"]],
    ["the Git tab's surface", gitSurfaceSource, ["openReview(", 'kind: "change"']],
    ["the release rows", releaseRowsSource, ["onRollBack(release.tag, event.currentTarget)"]],
    ["the crew board", crewBoardSource, ["openReview(", 'kind: "crew-task"']],
    ["the lead's plan", crewLeadPlanSource, ["openReview(", 'kind: "crew-task"']],
    ["the crew section's rows", crewSectionSource, ["openReview(", 'kind: "crew-task"']],
    ["a crewmate's lane bar", crewLaneBarSource, ["openReview(", 'kind: "crew-task"']],
  ] as const)("%s", (_door, source, opens) => {
    for (const words of opens) expect(source).toContain(words);
    for (const act of ACTS) expect(source).not.toContain(act);
  });
});

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
      taggedAt: undefined,
    };
    const rows = [
      releaseRow(earlier, 1, {
        production: new Map([["app", "a".repeat(40)]]),
        failed: new Map(),
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
  why: "Checks passed · no conflicts with main · 1 commit",
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

const GITEA_FILE = "https://git.example.test/acme/appdev/pulls/2/files#diff-0a1b";
const STOPPED_INSIDE = parseChangeDiff(
  ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1,2 @@", "-x", "+y", "+z"].join(
    "\n",
  ),
  { cut: true },
).get("a.ts");

describe("a diff too long to read here says so, and where the rest is (D4)", () => {
  it.each<[string, ReviewDiffState, string, boolean]>([
    [
      "a file the read stopped inside",
      { kind: "read", file: STOPPED_INSIDE, cut: true },
      "The rest is too long to read here.",
      true,
    ],
    [
      "a file past where the read stopped",
      { kind: "read", file: undefined, cut: true },
      "Too long to read here.",
      true,
    ],
    [
      "a file with nothing to show in a diff read whole",
      { kind: "read", file: undefined, cut: false },
      "Nothing to show for this file.",
      false,
    ],
  ])("%s", (_case, diff, words, linked) => {
    const html = renderToStaticMarkup(<ReviewDiff diff={diff} gitea={GITEA_FILE} />);
    expect(html).toContain(words);
    expect(html.includes(`href="${GITEA_FILE}"`)).toBe(linked);
  });
});

describe("a file's diff is read once a file opens, never before (D4)", () => {
  it("asks for it as a file opens, and not as it closes", async () => {
    const onOpen = vi.fn();
    const document = installTestDom();
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    const root = createRoot(container as unknown as Element);
    const row = (path: string) => {
      const found = elementsOf(container, "button").find((button) =>
        button.textContent.includes(path.slice(path.lastIndexOf("/") + 1)),
      );
      if (found === undefined) throw new Error(`no row for ${path}`);
      return found;
    };
    try {
      await act(async () =>
        root.render(
          <ReviewFiles
            diffOf={() => ({ kind: "reading" })}
            files={[
              { path: "src/a.ts", status: "modified", additions: 1, deletions: 1 },
              { path: "src/b.ts", status: "added", additions: 3, deletions: 0 },
            ]}
            onOpen={onOpen}
            pending={2}
          />,
        ),
      );
      expect(onOpen).not.toHaveBeenCalled();
      await act(async () => pressFrom(row("src/a.ts")));
      await act(async () => pressFrom(row("src/a.ts")));
      await act(async () => pressFrom(row("src/b.ts")));
      expect(onOpen.mock.calls).toEqual([["src/a.ts"], ["src/b.ts"]]);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

describe("the review is a layer: what is typed in it acts on nothing behind it", () => {
  it.each([
    ["keeps its keys from the listeners behind it, Escape aside", "keyStaysInReview(event.key)"],
    ["stops them there", "event.stopPropagation()"],
    ["is a dialog to the panel launcher's letters", 'data-slot="dialog-popup"'],
  ])("%s", (_case, words) => {
    expect(reviewDialogSource).toContain(words);
  });
});

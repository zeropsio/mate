/**
 * A change's review once it merged, drawn with its reads handed in: a recipe change says what its
 * merge did to the project's environments, from the files it changed, and never offers a release;
 * a code change still hands over to the release production waits for.
 */
import { changeReadout, type FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { ChangeFile, HqChange } from "@t3tools/shared/hqChanges";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { buttonsLabelled, elementsOf, press, TestNode } from "~/zerops/__fixtures__/testDom";

import {
  ChangeReviewView,
  ZeropsChangeReview,
  type ChangeReviewViewProps,
} from "./ZeropsChangeReview";

/**
 * The account as a reload leaves it: the registry read, no project's flow read yet — and what its
 * flow was asked to merge or close, each answered as `answer` says.
 */
const account = vi.hoisted(() => ({
  changes: new Map<string, unknown>(),
  reads: [] as Array<string>,
  verbs: [] as Array<readonly unknown[]>,
  answer: { ok: true } as { readonly ok: true } | { readonly ok: false; readonly reason: string },
}));

vi.mock("~/zerops/projectFlowContext", () => ({
  useZeropsProjectFlowOptional: () => ({
    signInTrouble: null,
    flows: new Map(),
    deployments: new Map(),
    slugs: new Map([["group-orchard", "orchard"]]),
    mateNames: new Map(),
    pending: new Set(),
    trouble: null,
    merge: async (...asked: ReadonlyArray<unknown>) => {
      account.verbs.push(["merge", ...asked]);
      return account.answer;
    },
    close: async (...asked: ReadonlyArray<unknown>) => {
      account.verbs.push(["close", ...asked]);
      return account.answer;
    },
  }),
}));
/** The organization's official HQ, the same one on every render, as `useOfficialHq` keeps it. */
const hq = vi.hoisted(() => ({
  address: "https://hq.example.test",
  api: {
    change: async (link: { appId: string; repo: string; number: number }) => {
      const key = `${link.appId}/${link.repo}#${String(link.number)}`;
      account.reads.push(key);
      return { change: account.changes.get(key) };
    },
  },
}));
vi.mock("~/zerops/accountHq", () => ({ useOfficialHq: () => hq }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: async () => {} }) }));
/** What HQ's detail of the change answers. */
const detail = vi.hoisted(() => ({ readout: { kind: "reading" } as unknown }));
vi.mock("~/zerops/useZeropsChangeDetail", () => ({
  useZeropsChangeDetail: () => ({ readout: detail.readout, retry: () => undefined }),
}));
vi.mock("~/zerops/useZeropsChangeComments", () => ({
  useZeropsChangeComments: () => ({
    state: { kind: "reading" },
    say: async () => null,
    saying: false,
    retry: () => undefined,
  }),
}));
vi.mock("~/zerops/useZeropsChangeRun", () => ({
  useZeropsChangeRun: () => ({ words: undefined, reading: false, threadRef: undefined }),
}));
vi.mock("~/zerops/useChangePicture", () => ({
  useHqPictureSource: () => undefined,
  useChangePicture: () => ({ kind: "reading" }),
}));
vi.mock("~/zerops/useAskMate", () => ({ useAskMate: () => () => undefined }));
vi.mock("~/zerops/fixRequest", () => ({ useAskMateToFix: () => () => undefined }));
vi.mock("~/zerops/fixMates", () => ({ useFixMates: () => [] }));
vi.mock("~/zerops/useZeropsReviewMates", () => ({ useZeropsReviewMates: () => new Map() }));
/** What HQ's rule offers the person of the application's changes; the one function every render. */
const offers = vi.hoisted(() => {
  const held = { current: { read: true, comment: true, merge: true, close: true, redeploy: true } };
  return { held, of: () => held.current };
});
vi.mock("~/zerops/useChangeOffers", () => ({ useChangeOffers: () => offers.of }));

const NOW = Date.parse("2026-09-30T10:00:00Z");
const noop = () => undefined;

function merged(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 7,
    title: "Add a mail service",
    kind: "code",
    mateProjectId: "p-wren",
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: true,
    mergedAt: new Date(NOW).toISOString(),
    headSha: "c".repeat(40),
    baseBranch: "main",
    line: "appdev #7",
    updatedAt: undefined,
    ...over,
  };
}

const recipe = merged({ repository: "group", kind: "recipe", line: "#7" });

const MAIN = "a".repeat(40);
const changed = (path: string): ChangeFile => ({
  path,
  added: 6,
  deleted: 0,
  hunks: "",
  binary: false,
  truncated: false,
});

/** Everything HQ's rule offers a developer of the application. */
const DEVELOPS = { read: true, comment: true, merge: true, close: true, redeploy: true } as const;

/** The review of `pull` in a project with a stage and a production two changes behind `main`. */
function render(
  pull: FlowPullRequest,
  files: ReadonlyArray<ChangeFile>,
  over: Partial<ChangeReviewViewProps> = {},
): string {
  const props: ChangeReviewViewProps = {
    pull,
    mate: { name: "Wren", tint: undefined, mine: false },
    readout: {
      kind: "read",
      value: changeReadout({
        change: {} as HqChange,
        mainHead: MAIN,
        mergeBase: MAIN,
        mergeability: { kind: "clean" },
        files,
        filesTruncated: false,
        commits: [],
        commitsTruncated: false,
      }),
    },
    comments: {
      state: { kind: "read", comments: [] },
      say: async () => null,
      saying: false,
      retry: noop,
    },
    remarks: [],
    offers: DEVELOPS,
    press: { kind: "idle" },
    closing: { kind: "idle" },
    run: { words: undefined, reading: false },
    hqAddress: undefined,
    pictures: undefined,
    environments: [{ tier: "stage" }, { tier: "production" }],
    waitingForProduction: 2,
    live: "v0.1.0",
    now: NOW,
    onFix: noop,
    onAsk: async () => undefined,
    onOpenRun: undefined,
    onReviewRelease: noop,
    onMerge: noop,
    onClosing: noop,
    onClose: noop,
    ...over,
  };
  return renderToStaticMarkup(<ChangeReviewView {...props} />);
}

/** The visible text, tags stripped, whitespace folded. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();

describe("ChangeReviewView: a change after its merge", () => {
  it.each([
    [
      "a recipe change to recipes nothing in the project is made from",
      [changed("1 — Remote (CDE)/import.yaml"), changed("2 — Local/import.yaml")],
      "Just now · no environment changes",
      "Nothing in this project is made from the Remote (CDE) or Local recipe, so no environment changes.",
    ],
    [
      "a recipe change to the stage's recipe",
      [changed("3 — Stage/import.yaml"), changed("3 — Stage/README.md")],
      "Just now · the stage gets any new service",
      "The stage gets any service added to its recipe, created empty; the services it has stay as they are.",
    ],
  ])("%s says what it did, and offers no release", (_case, files, why, consequence) => {
    const html = render(recipe, files);
    const text = textOf(html);
    expect(text).toContain(`Merged into main ${why}`);
    expect(text).toContain(consequence);
    expect(html).not.toContain("data-review-primary");
    expect(text).not.toContain("Review release");
  });

  it("a code change hands over to the release production waits for", () => {
    const html = render(merged(), [changed("src/mail.ts")]);
    expect(textOf(html)).toContain("Production still serves v0.1.0 until you release.");
    expect(html).toContain('data-zerops-primary-action="Review release"');
  });
});

/** The review's foot: what its buttons say. */
const footOf = (html: string) => html.slice(html.indexOf('<footer class="rv-foot">'));

describe("ChangeReviewView: an open change", () => {
  const open = merged({ state: "open", merged: false, mergedAt: undefined });
  const files = [changed("src/mail.ts")];

  it("that merges cleanly offers Merge, safe to press, and Close without merging beside it", () => {
    const html = render(open, files);
    expect(html).toMatch(/data-safe="true" data-zerops-primary-action="Merge"/u);
    expect(footOf(html)).toContain(">Close without merging…</button>");
  });

  // Guide 0.8: a verb this person cannot finish is not offered.
  it("offers neither where HQ's rule does not, and says what merging takes", () => {
    const html = render(open, files, {
      offers: { read: true, comment: true, merge: false, close: false, redeploy: false },
    });
    expect(footOf(html)).not.toContain("<button");
    expect(textOf(html)).toContain(
      "You need at least Basic user access to one of this project's Zerops projects to do this.",
    );
  });

  it("says it is merging while the press runs, the button held", () => {
    const html = render(open, files, { press: { kind: "running" } });
    expect(textOf(html)).toContain("Merging into main");
    expect(html).toMatch(/disabled=""[^>]*>Merging…/u);
  });

  // Main stories 129–130: HQ's refusal in its words; a second try only by a deliberate press.
  it("says HQ's refusal as it was given, and takes a second try only from a press", () => {
    const reason = "Its Mate pushed to it since you opened it. Review it again.";
    const html = render(open, files, { press: { kind: "refused", reason } });
    expect(textOf(html)).toContain(`Not merged ${reason}`);
    expect(html).toMatch(/data-safe="false" data-zerops-primary-action="Merge"/u);
  });

  it("asks before it closes, the review its one confirmation", () => {
    const html = render(open, files, { closing: { kind: "asked" } });
    expect(textOf(html)).toContain("Close #7 without merging? Nothing of it reaches main");
    expect(footOf(html)).toMatch(
      /data-safe="false" data-zerops-primary-action="Close without merging"/u,
    );
    expect(footOf(html)).toContain(">Keep it open</button>");
  });
});

/** The test DOM, able to hold an SVG. */
class SvgDocument extends TestNode {
  createElementNS(_namespace: string, name: string) {
    return new TestNode(name, this);
  }
}

function installTestDom(): void {
  const document = new SvgDocument("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    Element: TestNode,
    HTMLElement: TestNode,
    Node: TestNode,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  // The review's tooltips ask what an element is.
  vi.stubGlobal("Element", TestNode);
  vi.stubGlobal("HTMLElement", TestNode);
  vi.stubGlobal("Node", TestNode);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}

const API_CHANGE: HqChange = {
  appId: "group-orchard",
  repo: "apidev",
  number: 1,
  mateProjectId: "p-wren",
  title: "Rebuild the full API on the new schema",
  body: "",
  state: "open",
  head: "d".repeat(40),
  mergedSha: null,
  landedHead: null,
  openedAt: "2026-09-30T09:00:00Z",
  mergedAt: null,
  closedAt: null,
  updatedAt: "2026-09-30T09:00:00Z",
  mergeability: "clean",
  behind: false,
};

describe("ZeropsChangeReview: a change its project's flow does not hold yet", () => {
  afterEach(() => {
    account.changes.clear();
    account.reads.length = 0;
    account.verbs.length = 0;
    account.answer = { ok: true };
    detail.readout = { kind: "reading" };
    offers.held.current = { read: true, comment: true, merge: true, close: true, redeploy: true };
    vi.unstubAllGlobals();
  });

  /** The review of API_CHANGE, mounted; `test` reads what it drew, and presses what it may. */
  async function reviewed(test: (host: TestNode) => void | Promise<void>): Promise<void> {
    account.changes.set("group-orchard/apidev#1", API_CHANGE);
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const host = document.createElement("div") as unknown as TestNode;
    const root = createRoot(host as unknown as Element);
    await act(async () => {
      root.render(
        createElement(ZeropsChangeReview, {
          target: { kind: "change", groupId: "group-orchard", repository: "apidev", number: 1 },
          titleId: "t",
          onClose: noop,
          onReplace: noop,
        }),
      );
    });
    await test(host);
    await act(async () => {
      root.unmount();
    });
  }

  /** The review's buttons that say `label` — the primary by its action, its keys beside it. */
  const buttonsOf = (host: TestNode, label: string) =>
    elementsOf(host, "button").filter(
      (button) =>
        button.getAttribute("data-zerops-primary-action") === label ||
        buttonsLabelled(host, label).includes(button),
    );

  /** Presses the button that says `label`, and lets what it set off settle. */
  const pressed = (host: TestNode, label: string) =>
    act(async () => {
      const [button] = buttonsOf(host, label);
      if (button === undefined) throw new Error(`no "${label}" in the review`);
      press(button);
    });

  /** HQ's detail of API_CHANGE, read: Merge waits for it. */
  const READ_DETAIL = {
    kind: "read",
    value: changeReadout({
      change: API_CHANGE,
      mainHead: MAIN,
      mergeBase: MAIN,
      mergeability: { kind: "clean" },
      files: [changed("src/api.ts")],
      filesTruncated: false,
      commits: [],
      commitsTruncated: false,
    }),
  };

  it("merges with the head the review shows, and says it merged", async () => {
    detail.readout = READ_DETAIL;
    await reviewed(async (host) => {
      await pressed(host, "Merge");
      expect(account.verbs).toEqual([
        ["merge", "group-orchard", { repository: "apidev", number: 1 }, API_CHANGE.head],
      ]);
      expect(host.textContent).toContain("Merged into main");
    });
  });

  it("says HQ's refusal, and keeps Merge for a deliberate press", async () => {
    detail.readout = READ_DETAIL;
    account.answer = { ok: false, reason: "It no longer merges cleanly into main." };
    await reviewed(async (host) => {
      await pressed(host, "Merge");
      expect(host.textContent).toContain("Not merged");
      expect(host.textContent).toContain("It no longer merges cleanly into main.");
      expect(buttonsOf(host, "Merge")).toHaveLength(1);
    });
  });

  it("closes it only once asked, and says it was closed", async () => {
    await reviewed(async (host) => {
      await pressed(host, "Close without merging…");
      expect(account.verbs).toEqual([]);
      expect(host.textContent).toContain("Close #1 without merging?");
      await pressed(host, "Close without merging");
      expect(account.verbs).toEqual([
        ["close", "group-orchard", { repository: "apidev", number: 1 }],
      ]);
      expect(host.textContent).toContain("Closed without merging");
    });
  });

  it("keeps it open when asked to, closing nothing", async () => {
    await reviewed(async (host) => {
      await pressed(host, "Close without merging…");
      await pressed(host, "Keep it open");
      expect(account.verbs).toEqual([]);
      expect(host.textContent).not.toContain("Close #1 without merging?");
      expect(buttonsLabelled(host, "Close without merging…")).toHaveLength(1);
    });
  });

  it("reads the change from HQ by its application, before the flow is read", async () => {
    await reviewed((host) => {
      expect(account.reads).toEqual(["group-orchard/apidev#1"]);
      expect(host.textContent).toContain("Rebuild the full API on the new schema");
      expect(host.textContent).not.toContain("Reading this change");
      expect(elementsOf(host, "textarea")).toHaveLength(1);
    });
  });

  it("offers no box where HQ's rule does not let the person comment on it", async () => {
    offers.held.current = { read: true, comment: false, merge: true, close: true, redeploy: true };
    await reviewed((host) => {
      expect(host.textContent).toContain("Rebuild the full API on the new schema");
      expect(elementsOf(host, "textarea")).toHaveLength(0);
    });
  });
});

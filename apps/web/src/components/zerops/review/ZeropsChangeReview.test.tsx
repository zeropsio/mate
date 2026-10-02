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

import { TestNode } from "~/zerops/__fixtures__/testDom";

import {
  ChangeReviewView,
  ZeropsChangeReview,
  type ChangeReviewViewProps,
} from "./ZeropsChangeReview";

/** The account as a reload leaves it: the registry read, no project's flow read yet. */
const account = vi.hoisted(() => ({
  changes: new Map<string, unknown>(),
  reads: [] as Array<string>,
}));

vi.mock("~/zerops/projectFlowContext", () => ({
  useZeropsProjectFlowOptional: () => ({
    giteaOrigin: "https://gitea.example.test",
    signedIn: true,
    readable: true,
    signInTrouble: null,
    flows: new Map(),
    deployments: new Map(),
    slugs: new Map([["group-orchard", "orchard"]]),
    mateNames: new Map(),
    pending: new Set(),
    trouble: null,
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
vi.mock("~/zerops/useZeropsChangeDetail", () => ({
  useZeropsChangeDetail: () => ({ readout: { kind: "reading" }, retry: () => undefined }),
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

const NOW = Date.parse("2026-09-30T10:00:00Z");
const noop = () => undefined;

function merged(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 7,
    title: "Add a mail service",
    kind: "code",
    mateProjectId: undefined,
    author: "ada",
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: true,
    mergedAt: new Date(NOW).toISOString(),
    headSha: "c".repeat(40),
    baseBranch: "main",
    line: "appdev #7 · ada",
    updatedAt: undefined,
    ...over,
  };
}

const recipe = merged({ repository: "group", kind: "recipe", line: "#7 · ada" });

const MAIN = "a".repeat(40);
const changed = (path: string): ChangeFile => ({
  path,
  added: 6,
  deleted: 0,
  hunks: "",
  binary: false,
  truncated: false,
});

/** The review of `pull` in a project with a stage and a production two changes behind `main`. */
function render(pull: FlowPullRequest, files: ReadonlyArray<ChangeFile>): string {
  const props: ChangeReviewViewProps = {
    pull,
    mate: undefined,
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
    onClose: noop,
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

describe("ChangeReviewView: an open change", () => {
  it("that merges cleanly offers no Merge: a Mate's change merges in HQ", () => {
    const open = merged({ state: "open", merged: false, mergedAt: undefined });
    const html = render(open, [changed("src/mail.ts")]);
    expect(html).not.toContain('data-zerops-primary-action="Merge"');
    expect(html.slice(html.indexOf('<footer class="rv-foot">'))).not.toContain("<button");
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
    vi.unstubAllGlobals();
  });

  it("reads the change from HQ by its application, before the flow is read", async () => {
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
    expect(account.reads).toEqual(["group-orchard/apidev#1"]);
    expect(host.textContent).toContain("Rebuild the full API on the new schema");
    expect(host.textContent).not.toContain("Reading this change");
    await act(async () => {
      root.unmount();
    });
  });
});

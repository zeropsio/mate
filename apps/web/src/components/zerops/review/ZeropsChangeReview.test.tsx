/**
 * A change's review once it merged, drawn with its reads handed in: a recipe change says what its
 * merge did to the project's environments, from the files it changed, and never offers a release;
 * a code change still hands over to the release production waits for.
 */
import type {
  FlowPullRequest,
  GiteaChangedFile,
  GiteaPullRequest,
} from "@t3tools/client-runtime/zerops";
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
  pulls: new Map<string, unknown>(),
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
vi.mock("~/zerops/accountGiteaSessions", () => ({
  useGiteaReadable: () => true,
  giteaSessionLogin: () => undefined,
  giteaClientFor: () => ({
    getPullRequest: async (owner: string, repository: string, number: number) => {
      const key = `${owner}/${repository}#${String(number)}`;
      account.reads.push(key);
      return account.pulls.get(key);
    },
    listCommitStatuses: async () => [],
  }),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: async () => {} }) }));
vi.mock("~/zerops/useZeropsChangeReadout", () => ({
  useZeropsChangeReadout: () => ({
    files: { kind: "reading" },
    diff: { kind: "none" },
    commits: { kind: "reading" },
    mainSince: { kind: "none" },
    retry: () => undefined,
  }),
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
vi.mock("~/zerops/useGiteaPicture", () => ({
  useGiteaPictureSource: () => undefined,
  useGiteaPicture: () => ({ kind: "none" }),
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

const changed = (filename: string): GiteaChangedFile => ({
  filename,
  previousFilename: undefined,
  status: "modified",
  additions: 6,
  deletions: 0,
});

/** The review of `pull` in a project with a stage and a production two changes behind `main`. */
function render(pull: FlowPullRequest, files: ReadonlyArray<GiteaChangedFile>): string {
  const props: ChangeReviewViewProps = {
    pull,
    mate: undefined,
    readout: {
      files: { kind: "read", value: files },
      diff: { kind: "none" },
      commits: { kind: "read", value: [] },
      mainSince: { kind: "none" },
    },
    comments: {
      state: { kind: "read", comments: [] },
      say: async () => null,
      saying: false,
      retry: noop,
    },
    remarks: [],
    run: { words: undefined, reading: false },
    giteaOrigin: undefined,
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

const API_CHANGE: GiteaPullRequest = {
  number: 1,
  title: "Rebuild the full API on the new schema",
  state: "open",
  html_url: "https://gitea.example.test/orchard/apidev/pulls/1",
  mergeable: true,
  head: { ref: "mate/mate-p-wren", sha: "d".repeat(40) },
  base: { ref: "main" },
  user: { login: "mate-p-wren" },
  updated_at: "2026-09-30T09:00:00Z",
};

describe("ZeropsChangeReview: a change its project's flow does not hold yet", () => {
  afterEach(() => {
    account.pulls.clear();
    account.reads.length = 0;
    vi.unstubAllGlobals();
  });

  it("reads the change from Gitea by the project's org, before the flow is read", async () => {
    account.pulls.set("orchard/apidev#1", API_CHANGE);
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
    expect(account.reads).toEqual(["orchard/apidev#1"]);
    expect(host.textContent).toContain("Rebuild the full API on the new schema");
    expect(host.textContent).not.toContain("Reading this change");
    await act(async () => {
      root.unmount();
    });
  });
});

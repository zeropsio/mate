/**
 * A change's review once it merged, drawn with its reads handed in: a recipe change says what its
 * merge did to the project's environments, from the files it changed, and never offers a release;
 * a code change still hands over to the release production waits for.
 */
import {
  changeReadout,
  changeReadoutOfRecord,
  RELEASE_NOTHING_NEW_ON_MAIN,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import type {
  ChangeFile,
  ChangeMetadataResponse,
  ChangeReceiptPart,
  HqChange,
} from "@t3tools/shared/hqChanges";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { buttonsLabelled, elementsOf, press, TestNode } from "~/zerops/__fixtures__/testDom";
import { RegistryContext } from "@effect/atom-react";
import { AccountDataContext } from "~/zerops/ZeropsAccountData";
import { reviewAccount } from "~/zerops/__fixtures__/reviewAccount";
import type { ZeropsChangeOffers } from "~/zerops/useChangeOffers";

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
  flowPull: undefined as FlowPullRequest | undefined,
  reads: [] as Array<string>,
  readError: null as unknown,
  verbs: [] as Array<readonly unknown[]>,
  answer: { ok: true } as { readonly ok: true } | { readonly ok: false; readonly reason: string },
}));

vi.mock("~/zerops/projectFlows", () => ({
  useProjectFlows: () => ({
    hqAddress: undefined,
    readFailure: undefined,
    groupsRead: false,
    knownGroups: new Set(),
    flows:
      account.flowPull === undefined
        ? new Map()
        : new Map([
            [
              "group-orchard",
              {
                pullRequests: [account.flowPull],
                merged: [],
                repos: [],
                environmentInputs: [],
                releases: [],
                releasesKnown: true,
                release: { gate: { allowed: false, reason: "Nothing to release." }, contents: [] },
              },
            ],
          ]),
    releaseFailures: new Map(),
  }),
  useMateNames: () => new Map(),
  useEveryAppId: () => [],
  useAppsEnvironments: () => ({}),
}));
vi.mock("~/zerops/flowVerbs", () => ({
  useFlowVerbs: () => ({
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
    metadata: async (link: { appId: string; repo: string; number: number }) => {
      const key = `${link.appId}/${link.repo}#${String(link.number)}`;
      account.reads.push(key);
      if (account.readError !== null) throw account.readError;
      return { change: account.changes.get(key) } as ChangeMetadataResponse;
    },
  },
}));
vi.mock("~/zerops/accountHq", () => ({ useOfficialHq: () => hq }));
vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ navigate: async () => {} }),
}));
/** What HQ's detail of the change answers. */
const detail = vi.hoisted(() => ({ readout: { kind: "reading" } as unknown }));
vi.mock("~/zerops/useZeropsChangeDetail", async () => ({
  ...(await vi.importActual<typeof import("~/zerops/useZeropsChangeDetail")>(
    "~/zerops/useZeropsChangeDetail",
  )),
  useZeropsChangeDetail: () => ({ readout: detail.readout, retry: () => undefined }),
}));
vi.mock("~/zerops/useChangeDiscussion", () => ({
  useChangeDiscussion: () => ({
    state: { kind: "reading" },
    say: async () => null,
    saying: false,
    waiting: false,
    pending: null,
    landed: null,
    retry: () => undefined,
  }),
}));
vi.mock("~/zerops/useZeropsChangeRun", () => ({
  useZeropsChangeRun: () => ({ words: undefined, reading: false, threadRef: undefined }),
}));
vi.mock("~/zerops/useProjectedHqPicture", () => ({
  useHqPictureSource: () => undefined,
  useProjectedHqPicture: () => ({ kind: "reading" }),
}));
vi.mock("~/zerops/useAskMate", () => ({ useAskMate: () => () => undefined }));
vi.mock("~/zerops/useAddEnvironment", () => ({
  useAddEnvironment: () => () => undefined,
  useEnvironmentQuestionFacts: () => ({
    addable: { stage: false, production: false },
    productionHeld: false,
  }),
}));
vi.mock("~/zerops/fixRequest", () => ({ useAskMateToFix: () => () => undefined }));
vi.mock("~/zerops/fixMates", () => ({ useFixMates: () => [] }));
vi.mock("~/zerops/useZeropsReviewMates", () => ({ useZeropsReviewMates: () => new Map() }));
vi.mock("./reviewReads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./reviewReads")>()),
  useGroupName: () => undefined,
  useMatePreviews: () => [],
}));
/** What HQ offers the person of the application's changes; the one function every render. */
const offers = vi.hoisted(() => {
  const held: { current: ZeropsChangeOffers } = {
    current: {
      read: true,
      comment: true,
      merge: true,
      close: true,
      redeploy: true,
      why: {},
      readRefused: false,
    },
  };
  return { held, of: () => held.current };
});
/** The applications whose detail the review holds now. */
const detailHeld = vi.hoisted(() => ({ now: [] as ReadonlyArray<string> }));
vi.mock("~/zerops/useHqAppDetail", async () => {
  const { useEffect } = await import("react");
  return {
    useHqAppDetailHold: (appIds: ReadonlyArray<string>) => {
      const key = appIds.join(",");
      useEffect(() => {
        detailHeld.now = key === "" ? [] : key.split(",");
        return () => {
          detailHeld.now = [];
        };
      }, [key]);
    },
  };
});
vi.mock("~/zerops/useChangeOffers", () => ({ useChangeOffers: () => () => offers.of() }));

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
const DEVELOPS: ZeropsChangeOffers = {
  read: true,
  comment: true,
  merge: true,
  close: true,
  redeploy: true,
  why: {},
  readRefused: false,
};

/** The review of `pull` in a project with a stage and a production two changes behind `main`. */
function render(
  pull: ChangeReviewViewProps["pull"],
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
      waiting: false,
      pending: null,
      landed: null,
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
    release: { allowed: true },
    live: "v0.1.0",
    now: NOW,
    onFix: noop,
    onAsk: async () => undefined,
    onOpenRun: undefined,
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

describe("ChangeReviewView: a change's conversation", () => {
  it("holds the room of the comments HQ counted while it reads them", () => {
    const markup = render(merged({ commentCount: 2 }), [], {
      comments: {
        state: { kind: "reading" },
        say: async () => null,
        saying: false,
        waiting: false,
        pending: null,
        landed: null,
        retry: noop,
      },
    });
    expect(markup.match(/<li aria-hidden="true"/gu)?.length).toBe(2);
  });
});

describe("ChangeReviewView: a change review from what HQ recorded", () => {
  const recorded = (
    files: ReadonlyArray<{ path: string; status?: "A" | "M" | "D" | "T" }> | null,
    commits?: ReadonlyArray<{ sha: string; subject: string; authorName: string; at: string }>,
  ) =>
    changeReadoutOfRecord(
      {
        mergeability: "clean",
        behind: false,
      } as HqChange,
      {
        mergeBase: MAIN,
        files:
          files?.map(({ path, status }) => ({
            path,
            added: 2,
            deleted: 0,
            binary: false,
            ...(status === undefined ? {} : { status }),
          })) ?? null,
        filesTruncated: false,
        conflictPaths: [],
        commits: commits ?? null,
        commitsTruncated: false,
      },
    );

  it("Files not recorded yet read not known yet", () => {
    const markup = render(merged(), [], {
      readout: { kind: "read", value: recorded(null) },
      showFiles: noop,
    });
    expect(textOf(markup)).toContain("The files are not known yet.");
    expect(textOf(markup)).toContain("Show files");
  });

  it("A file HQ recorded no status for draws no letter, never a guessed M", () => {
    const markup = render(merged(), [], {
      readout: {
        kind: "read",
        value: recorded([{ path: "src/a.ts", status: "A" }, { path: "src/b.ts" }]),
      },
    });
    expect(markup.match(/class="rv-st"[^>]*>([^<]*)</gu)?.map((cell) => cell.slice(-2))).toEqual([
      "A<",
      "><",
    ]);
  });

  it("A file's diff is read from the recorded merge base when the person unfolds it", () => {
    const asked: Array<string> = [];
    const markup = render(merged(), [], {
      readout: { kind: "read", value: recorded([{ path: "src/a.ts" }]) },
      initiallyOpen: ["src/a.ts"],
      fileDiffs: {
        diffOf: () => ({ kind: "reading" }),
        ask: (path) => asked.push(path),
      },
    });
    expect(textOf(markup)).toContain("a.ts");
    expect(textOf(markup)).toContain("Reading the diff");
    expect(asked).toEqual([]);
  });

  it("Commits HQ recorded show at once", () => {
    const markup = render(merged(), [], {
      readout: {
        kind: "read",
        value: recorded(
          [{ path: "src/a.ts" }],
          [
            {
              sha: MAIN,
              subject: "Add a status page",
              authorName: "Nova",
              at: "2026-10-02T09:00:00.000Z",
            },
          ],
        ),
      },
    });
    expect(textOf(markup)).toContain("Add a status page");
  });

  it("Commits not recorded yet read not known yet, and a press reads them", () => {
    const markup = render(merged(), [], {
      readout: { kind: "read", value: recorded([{ path: "src/a.ts" }]) },
      showCommits: noop,
    });
    expect(textOf(markup)).toContain("The commits are not known yet.");
    expect(textOf(markup)).toContain("Show commits");
  });
});

describe("ChangeReviewView: a change after its merge", () => {
  it("says the merge's deploy state once in the dialog's Where section", () => {
    const markup = render(merged(), [], {
      press: {
        kind: "done",
        deploys: {
          jobs: [
            {
              environment: "stage",
              kind: "deploy",
              service: "app",
              sha: MAIN,
              job: "1",
              state: "queued",
              processId: null,
              behind: "0",
              reason: null,
            },
          ],
          note: "Production could not be read.",
        },
      },
    });
    const document = new Window().document;
    document.body.innerHTML = markup;
    const job = document.querySelector('[data-zerops-job-state="queued"]');
    expect(job?.closest("section")?.querySelector("h3")?.textContent).toBe("Where");
    expect(document.body.textContent.match(/queued behind/g)).toHaveLength(1);
    expect(document.body.textContent.match(/Production could not be read/g)).toHaveLength(1);
  });
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
    expect(text).toContain(`Merged into main · ${why}`);
    expect(text).toContain(consequence);
    expect(html).not.toContain("data-review-primary");
    expect(text).not.toContain("Review release");
  });

  it("read from the roll back that lists it, goes back to it and offers nothing", () => {
    const html = render(merged(), [changed("src/mail.ts")], {
      back: { label: "Roll back", onPress: noop },
    });
    const document = new Window().document;
    document.body.innerHTML = html;
    expect(document.querySelector("[data-review-back]")?.textContent).toContain("Roll back");
    expect(html).not.toContain("data-review-primary");
  });

  it("a merged code change says production waits, and ends there", () => {
    const html = render(merged(), [changed("src/mail.ts")]);
    expect(textOf(html)).toContain("Production still serves v0.1.0 until you release.");
    expect(html).not.toContain("data-review-primary");
    expect(textOf(html)).not.toContain("Review release");
  });

  it("offers no Review release when production already runs the merged squash commit", () => {
    // The change's branch head differs from the squash on main; production runs the squash.
    const html = render(merged(), [changed("src/mail.ts")], {
      waitingForProduction: 0,
      release: { allowed: false, reason: RELEASE_NOTHING_NEW_ON_MAIN },
    });
    expect(footOf(html)).not.toContain("Review release");
    expect(footOf(html)).toContain("Production already runs what is merged.");
    expect(textOf(html)).not.toContain("Production still serves v0.1.0 until you release.");
  });
});

/** The review's foot: what its buttons say. */
const footOf = (html: string) => {
  const document = new Window().document;
  document.body.innerHTML = html;
  return document.querySelector("footer")?.innerHTML ?? "";
};

describe("ChangeReviewView: an open change", () => {
  it("says since when HQ does not answer instead of silently removing its actions", () => {
    const html = render(merged({ merged: false, state: "open" }), [changed("README.md")], {
      offers: {
        read: false,
        comment: false,
        merge: false,
        close: false,
        redeploy: false,
        why: { merge: "HQ unavailable since 10:00." },
        readRefused: false,
      },
    });
    expect(textOf(html)).toContain("HQ unavailable since 10:00.");
    expect(footOf(html)).not.toContain('data-zerops-primary-action="Merge"');
  });

  const open = merged({ state: "open", merged: false, mergedAt: undefined });
  const files = [changed("src/mail.ts")];

  it("an empty review carries the header verdict into its footer, with only Close", () => {
    const html = render(open, [], {
      readout: {
        kind: "read",
        value: changeReadout({
          change: {} as HqChange,
          mainHead: MAIN,
          mergeBase: MAIN,
          mergeability: { kind: "empty" },
          files: [],
          filesTruncated: false,
          commits: Array.from({ length: 20 }, (_, i) => ({
            sha: String(i),
            subject: "Already landed",
            authorName: "Wren",
            at: new Date(NOW).toISOString(),
          })),
          commitsTruncated: false,
        }),
      },
    });
    expect(textOf(html)).toContain("Nothing to merge main already has all of it");
    expect(footOf(html)).toContain("Nothing to deliver: main already has this.");
    expect(footOf(html)).not.toContain("Adds this change");
    expect(footOf(html)).not.toContain('data-zerops-primary-action="Merge"');
    expect(footOf(html)).toContain(">Close without merging…</button>");
  });

  it("that merges cleanly offers Merge, safe to press, and Close without merging beside it", () => {
    const html = render(open, files);
    expect(html).toMatch(/data-safe="true" data-zerops-primary-action="Merge"/u);
    expect(footOf(html)).toContain(">Close without merging…</button>");
  });

  it("whose Mate is gone says so, offers Hand to each other Mate of the application, and Close without merging in the foot", () => {
    const html = render({ ...open, mateGone: true }, files, {
      heirs: [
        { projectId: "p-sage", name: "Sage" },
        { projectId: "p-juno", name: "Juno" },
      ],
    });
    expect(textOf(html)).toContain(
      "Its Mate is no longer in this project, so nobody works on it. Close it, or hand it to another Mate to go on with it.",
    );
    expect(html).toContain(">Hand to Sage</button>");
    expect(html).toContain(">Hand to Juno</button>");
    expect(footOf(html)).toContain(">Close without merging…</button>");
  });

  describe("a change of an application of several parts", () => {
    const HEAD = "c".repeat(40);
    const part = (setup: string, more: Partial<ChangeReceiptPart> = {}): ChangeReceiptPart => ({
      setup,
      previewHostname: `${setup}stage`,
      deploy: "ok",
      deployedAt: "2026-10-14T21:06:00Z",
      workspaceClean: true,
      deployedCommit: HEAD,
      verified: true,
      ...more,
    });
    const at = "2026-10-14T21:10:00Z";

    it("A one-part app shows no part name, no part count and no receipt", () => {
      const today = render(open, files);
      for (const pull of [open, { ...open, receipt: { at, parts: [part("app")] } }]) {
        const html = render(pull, files);
        expect(html).toBe(today);
        expect(textOf(html)).not.toContain("Parts");
        expect(textOf(html)).not.toContain("appstage");
      }
    });

    it("Merge warns on a stale, uncommitted or failed preview and never blocks", () => {
      const { deployedCommit: _commit, ...failed } = part("worker", {
        deploy: "failed",
        verified: false,
      });
      const html = render(
        {
          ...open,
          receipt: {
            at,
            parts: [part("web", { deployedCommit: "a".repeat(40) }), part("api"), failed],
          },
        },
        files,
      );
      expect(textOf(html)).toContain(
        "Parts 3 web · webstage · from aaaaaaa, the change is at ccccccc · verified api · apistage · from ccccccc · verified worker · workerstage · deploy failed",
      );
      expect(textOf(footOf(html))).toContain(
        "Not tried at this change: web (older commit), worker (failed). Adds this change",
      );
      expect(html).toMatch(/data-safe="true" data-zerops-primary-action="Merge"/u);
    });
  });

  describe("a change mirrored to a pull request on GitHub", () => {
    const pullRequest = { number: 14, url: "https://github.com/acme/tea-shop/pull/14" };
    const prLink = (html: string) =>
      /<a[^>]*href="https:\/\/github.com\/acme\/tea-shop\/pull\/14"[^>]*>(.*?)<\/a>/u.exec(
        html,
      )?.[1] ?? null;

    it.each([
      [{ state: "open", checks: "passing" }, "PR #14 on GitHub · open · checks passing"],
      [{ state: "open" }, "PR #14 on GitHub · open"],
    ] as const)("links its pull request by its title: %o", (state, words) => {
      const html = render({ ...open, pullRequest: { ...pullRequest, ...state } }, files);
      const link = prLink(html);
      expect(link === null ? null : textOf(link)).toBe(words);
    });

    it("says its Merge merges it on GitHub", () => {
      const html = render(
        { ...open, pullRequest: { ...pullRequest, state: "open", checks: "passing" } },
        files,
        { stage: "appstage" },
      );
      expect(textOf(footOf(html))).toContain("Merge on GitHub");
      expect(textOf(footOf(html))).not.toContain("Merge to appstage");
    });

    it("a merged pull request shows as merged on GitHub", () => {
      const html = render(merged({}), files);
      expect(prLink(html)).toBeNull();
      const mirrored = render(
        { ...merged({}), pullRequest: { ...pullRequest, state: "merged" } },
        files,
      );
      expect(textOf(prLink(mirrored) ?? "")).toBe("PR #14 on GitHub · merged");
    });

    it("a change mirrored to no pull request names none, and merges as ever", () => {
      const html = render(open, files, { stage: "appstage" });
      expect(prLink(html)).toBeNull();
      expect(textOf(footOf(html))).toContain("Merge to appstage");
    });
  });

  // Guide 0.8: a verb this person cannot finish is not offered.
  it("offers neither where HQ's rule does not, and says what merging takes", () => {
    const html = render(open, files, {
      offers: { ...DEVELOPS, merge: false, close: false, redeploy: false },
    });
    expect(footOf(html)).not.toContain("<button");
    expect(textOf(html)).toContain(
      "You need more than Read access to one of this project's Zerops projects to do this.",
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
  ready: true,
  comments: 0,
};

describe("ZeropsChangeReview: a change its project's flow does not hold yet", () => {
  afterEach(() => {
    account.changes.clear();
    account.flowPull = undefined;
    account.readError = null;
    account.reads.length = 0;
    account.verbs.length = 0;
    account.answer = { ok: true };
    detail.readout = { kind: "reading" };
    offers.held.current = DEVELOPS;
    vi.unstubAllGlobals();
  });

  /** The review of API_CHANGE, mounted; `test` reads what it drew, and presses what it may. */
  async function reviewed(
    test: (host: TestNode, rerender: () => Promise<void>) => void | Promise<void>,
  ): Promise<void> {
    account.changes.set("group-orchard/apidev#1", API_CHANGE);
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const host = document.createElement("div") as unknown as TestNode;
    const root = createRoot(host as unknown as Element);
    const data = reviewAccount(({ link }) => hq.api.metadata(link));
    const rerender = () =>
      act(async () => {
        root.render(
          createElement(
            RegistryContext.Provider,
            { value: data.registry },
            createElement(
              AccountDataContext,
              { value: data.data },
              createElement(ZeropsChangeReview, {
                target: {
                  kind: "change",
                  groupId: "group-orchard",
                  repository: "apidev",
                  number: 1,
                },
                titleId: "t",
                onClose: noop,
              }),
            ),
          ),
        );
      });
    await rerender();
    await test(host, rerender);
    await act(async () => {
      root.unmount();
    });
    data.registry.dispose();
  }

  it("holds its application's detail while it is drawn, and lets it go when it closes", async () => {
    await reviewed(() => {
      expect(detailHeld.now).toEqual(["group-orchard"]);
    });
    expect(detailHeld.now).toEqual([]);
  });

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

  it.each([
    [404, "refused", true, "apidev has no change #1"],
    [403, "refused", false, "This change could not be read"],
    [503, "unavailable", true, "This change could not be read"],
  ] as const)(
    "shows a %s outcome and offers Read again only where allowed",
    async (status, kind, again, words) => {
      account.readError = new HqError({
        kind,
        status,
        code: "test",
        message: "HQ answered this read.",
      });
      await reviewed(async (host) => {
        expect(account.reads).toHaveLength(1);
        expect(host.textContent).toContain(words);
        expect(host.textContent).not.toContain("Reading this change");
        expect(buttonsOf(host, "Read again")).toHaveLength(again ? 1 : 0);
        if (again) {
          account.readError = null;
          await pressed(host, "Read again");
          expect(account.reads).toHaveLength(2);
          expect(host.textContent).toContain("Rebuild the full API on the new schema");
        }
      });
    },
  );

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
        ["close", "group-orchard", { repository: "apidev", number: 1 }, "d".repeat(40)],
      ]);
      expect(host.textContent).toContain("Closed without merging");
    });
  });

  it("withholds a previously readable change after HQ explicitly refuses read access", async () => {
    detail.readout = READ_DETAIL;
    await reviewed(async (host, rerender) => {
      expect(host.textContent).toContain(API_CHANGE.title);
      offers.held.current = {
        ...DEVELOPS,
        read: false,
        comment: false,
        merge: false,
        close: false,
        readRefused: true,
        why: { read: "You no longer have access to this project." },
      };
      await rerender();
      expect(host.textContent).toContain("You no longer have access to this project.");
      expect(host.textContent).not.toContain(API_CHANGE.title);
      expect(host.textContent).not.toContain("src/api.ts");
      expect(buttonsOf(host, "Merge")).toHaveLength(0);
      expect(account.verbs).toEqual([]);
    });
  });

  it("a colleague merges while the review is open", async () => {
    account.flowPull = merged({
      repository: "apidev",
      number: 1,
      merged: false,
      state: "open",
      headSha: API_CHANGE.head ?? undefined,
    });
    detail.readout = READ_DETAIL;
    await reviewed(async (host, rerender) => {
      expect(buttonsOf(host, "Merge")).toHaveLength(1);
      account.flowPull = {
        ...account.flowPull!,
        merged: true,
        state: "merged",
        mergedAt: new Date(NOW).toISOString(),
      };
      await rerender();
      expect(host.textContent).toContain("Merged into main");
      expect(buttonsOf(host, "Merge")).toHaveLength(0);
      expect(account.verbs).toEqual([]);
    });
  });

  it("a colleague merge ends an open Close confirmation without claiming a local close", async () => {
    account.flowPull = merged({
      repository: "apidev",
      number: 1,
      merged: false,
      state: "open",
      headSha: API_CHANGE.head ?? undefined,
    });
    detail.readout = READ_DETAIL;
    await reviewed(async (host, rerender) => {
      await pressed(host, "Close without merging…");
      expect(host.textContent).toContain("Close #1 without merging?");
      account.flowPull = {
        ...account.flowPull!,
        merged: true,
        state: "merged",
        mergedAt: new Date(NOW).toISOString(),
      };
      await rerender();
      expect(host.textContent).toContain("Merged into main");
      expect(host.textContent).not.toContain("Close #1 without merging?");
      expect(host.textContent).not.toContain("Closed without merging");
      expect(buttonsOf(host, "Merge")).toHaveLength(0);
      expect(buttonsOf(host, "Close without merging…")).toHaveLength(0);
      expect(account.verbs).toEqual([]);
    });
  });

  it("a reader can review but cannot merge", async () => {
    detail.readout = READ_DETAIL;
    offers.held.current = {
      ...DEVELOPS,
      merge: false,
      close: false,
      why: {
        merge:
          "You need more than Read access to one of this project's Zerops projects to do this.",
      },
    };
    await reviewed((host) => {
      expect(host.textContent).toContain("src/api.ts");
      expect(host.textContent).toContain("You need more than Read access");
      expect(buttonsOf(host, "Merge")).toHaveLength(0);
      expect(account.verbs).toEqual([]);
    });
  });

  it("requires another Close confirmation after a newer head is shown", async () => {
    account.flowPull = merged({
      repository: "apidev",
      number: 1,
      merged: false,
      state: "open",
      headSha: API_CHANGE.head ?? undefined,
    });
    detail.readout = READ_DETAIL;
    await reviewed(async (host, rerender) => {
      await pressed(host, "Close without merging…");
      expect(host.textContent).toContain("Close #1 without merging?");
      account.flowPull = { ...account.flowPull!, headSha: "e".repeat(40) };
      await rerender();
      expect(host.textContent).not.toContain("Close #1 without merging?");
      expect(account.verbs).toEqual([]);
      await pressed(host, "Close without merging…");
      expect(host.textContent).toContain("Close #1 without merging?");
    });
  });

  it("a newer push cancels Close confirmation; closing the reviewed head keeps its branch", async () => {
    account.flowPull = merged({
      repository: "apidev",
      number: 1,
      merged: false,
      state: "open",
      headSha: API_CHANGE.head ?? undefined,
    });
    detail.readout = READ_DETAIL;
    await reviewed(async (host, rerender) => {
      await pressed(host, "Close without merging…");
      expect(host.textContent).toContain("Close #1 without merging?");
      const newerHead = "e".repeat(40);
      account.flowPull = { ...account.flowPull!, headSha: newerHead };
      await rerender();
      expect(host.textContent).not.toContain("Close #1 without merging?");
      expect(account.verbs).toEqual([]);
      await pressed(host, "Close without merging…");
      expect(host.textContent).toContain("Close #1 without merging?");
      await pressed(host, "Close without merging");
      expect(account.verbs).toEqual([
        ["close", "group-orchard", { repository: "apidev", number: 1 }, newerHead],
      ]);
      expect(host.textContent).toContain("Closed without merging");
      expect(buttonsOf(host, "Merge")).toHaveLength(0);
      expect(buttonsOf(host, "Close without merging…")).toHaveLength(0);
      // The real close endpoint's branch retention is pinned by merge.test.ts:
      // "a developer closes a change without merging: its branch stays, and takes no pushes".
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
    offers.held.current = { ...DEVELOPS, comment: false };
    await reviewed((host) => {
      expect(host.textContent).toContain("Rebuild the full API on the new schema");
      expect(elementsOf(host, "textarea")).toHaveLength(0);
    });
  });
});

describe("the one question after the first merge", () => {
  const FIRST = merged({ firstCodeMerge: true });
  const asking: Partial<ChangeReviewViewProps> = {
    environments: [],
    press: { kind: "done" },
    productionHeld: false,
    addable: { stage: true, production: true },
  };

  it("asks where the code should run, with an equal button for each tier and a Not now", () => {
    const text = textOf(render(FIRST, [changed("a.ts")], asking));
    expect(text).toContain("Only Wren's preview runs it, for trying it out.");
    expect(text).toContain("Add stage");
    expect(text).toContain("Put it live");
    expect(text).toContain("Not now");
  });

  // A run 2 follow-up: Add stage and Put it live stood as equals with nothing said between them.
  it("says beside its buttons what each answer gives", () => {
    const foot = textOf(footOf(render(FIRST, [changed("a.ts")], asking)));
    expect(foot).toContain("A stage is a copy to try changes on before they go live.");
    expect(foot).toContain("Put it live gives it its own public address.");
  });

  it.each([
    ["it was not the first code merge", merged({ firstCodeMerge: false }), asking],
    ["the review is only reopened", FIRST, { ...asking, press: { kind: "idle" } as const }],
    ["a production is held", FIRST, { ...asking, productionHeld: true }],
    [
      "the person may add nothing",
      FIRST,
      { ...asking, addable: { stage: false, production: false } },
    ],
  ])("is not asked when %s", (_name, pull, over) => {
    expect(textOf(render(pull, [changed("a.ts")], over))).not.toContain("preview runs it");
  });

  // A run 2 follow-up: Merge's press put words under the title's line, then the question above the
  // description: the body under the person's eye dropped 24 px, then 98 px.
  it("asks it in the foot, in the buttons' place, so nothing above moves", () => {
    const html = render(FIRST, [changed("a.ts")], asking);
    const foot = textOf(footOf(html));
    for (const words of ["Only Wren's preview runs it", "Add stage", "Put it live", "Not now"]) {
      expect(foot).toContain(words);
    }
    expect(textOf(html).split("Only Wren's preview runs it")).toHaveLength(2);
  });

  it.each([
    ["merging", { press: { kind: "running" } as const }, merged({ merged: false, state: "open" })],
    ["merged", asking, FIRST],
  ])("says it is %s on the title's line, with nothing coming in under it", (_case, over, pull) => {
    const document = new Window().document;
    document.body.innerHTML = render(pull, [changed("a.ts")], { ...over, environments: [] });
    const header = document.querySelector("header");
    expect(header?.querySelectorAll("p, div")).toHaveLength(1);
  });
});

describe("ChangeReviewView: current pipeline evidence and terminal facts", () => {
  const open = merged({ merged: false, state: "open" });
  it.each([
    ["required", "running", "Required checks running", false],
    ["required", "failed", "Required checks failed", false],
    ["advisory", "failed", "Ready to merge", true],
    ["unknown", "failed", "Ready to merge", true],
  ] as const)(
    "shows %s %s checks with their identity and holds only required checks",
    (requirement, state, title, enabled) => {
      const html = render(
        {
          ...open,
          pipeline: {
            head: open.headSha!,
            requirements: "known",
            checks: [{ id: "unit", name: "Unit tests", requirement, state }],
          },
        },
        [],
      );
      const document = new Window().document;
      document.body.innerHTML = html;
      expect(document.body.textContent).toContain(title);
      expect(document.body.textContent).toContain("Unit tests");
      expect(document.body.textContent).toContain(
        requirement === "required"
          ? "Required by repository"
          : requirement === "advisory"
            ? "Advisory"
            : "Requirement unknown",
      );
      const button = document.querySelector('[data-zerops-primary-action="Merge"]');
      expect(button).not.toBeNull();
      expect(button?.hasAttribute("disabled")).toBe(!enabled);
    },
  );
  it("shows unknown repository requirements for a ready clean change", () => {
    expect(textOf(render(open, []))).toContain("Repository check requirements are unknown.");
  });
  it("keeps an authoritative terminal outcome when an old local press and lost offers remain", () => {
    const html = render(merged({ merged: false, state: "closed" }), [], {
      press: { kind: "done" },
      closing: { kind: "asked" },
      offers: {
        ...DEVELOPS,
        merge: false,
        close: false,
        why: { merge: "No permission to merge." },
      },
    });
    expect(textOf(html)).toContain("Closed without merging");
    expect(textOf(html)).not.toContain("Merged into main");
    expect(textOf(html)).not.toContain("No permission to merge.");
    expect(html).not.toContain("data-review-primary");
  });
});

describe("ChangeReviewView: its code in the Git browser", () => {
  const APP = "group-orchard";
  const HEAD = "c".repeat(40);
  const SQUASH = "d".repeat(40);
  const open = merged({ state: "open", merged: false, mergedAt: undefined });
  /** Every link into the Git browser: its words and its address. */
  const gitLinks = (html: string) => {
    const document = new Window().document;
    document.body.innerHTML = html;
    return [...document.querySelectorAll("a")]
      .filter((link) => link.getAttribute("href")?.startsWith("/git?") === true)
      .map((link) => [link.textContent?.replace(/\s+/gu, " ").trim(), link.getAttribute("href")]);
  };
  const deletes = (path: string): ChangeFile => ({
    ...changed(path),
    added: 0,
    deleted: 3,
    hunks: `diff --git a/${path} b/${path}\ndeleted file mode 100644\n--- a/${path}\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-a\n-b\n-c`,
  });

  it("an open change browses its files at its head", () => {
    expect(gitLinks(render(open, [], { appId: APP }))).toEqual([
      ["Browse files", `/git?appId=${APP}&repo=appdev&rev=${HEAD}&view=code`],
    ]);
  });

  it("a merged change opens the commit it added to main", () => {
    expect(gitLinks(render(merged({ mergeCommitSha: SQUASH }), [], { appId: APP }))).toEqual([
      ["Commit on main", `/git?appId=${APP}&repo=appdev&rev=${SQUASH}&view=commit`],
    ]);
  });

  it.each([
    ["a file it edits", changed("src/mail.ts"), "src%2Fmail.ts"],
    [
      "a binary file, whose diff has nothing to read here",
      { ...changed("logo.png"), added: null, deleted: null, binary: true },
      "logo.png",
    ],
    ["a file it deletes, which its head no longer has", deletes("src/old.ts"), undefined],
  ] as const)("an opened file offers the whole file at the head: %s", (_case, file, path) => {
    const html = render(open, [file], { appId: APP, initiallyOpen: [file.path] });
    expect(gitLinks(html).filter(([words]) => words === "Open file")).toEqual(
      path === undefined
        ? []
        : [
            [
              "Open file",
              `/git?appId=${APP}&repo=appdev&rev=${HEAD}&view=code&kind=file&path=${path}`,
            ],
          ],
    );
  });

  it("a file its description names opens at the head, on the line it names", () => {
    const html = render({ ...open, description: "The form posts to `src/mail.ts:12`." }, [], {
      appId: APP,
    });
    expect(gitLinks(html)).toContainEqual([
      "mail.ts · L12",
      `/git?appId=${APP}&repo=appdev&rev=${HEAD}&view=code&kind=file&path=src%2Fmail.ts&lines=L12`,
    ]);
  });

  it("links nothing into the browser where it does not know the change's application", () => {
    const html = render({ ...open, description: "See `src/mail.ts`." }, [changed("src/mail.ts")], {
      initiallyOpen: ["src/mail.ts"],
    });
    expect(gitLinks(html)).toEqual([]);
  });
});

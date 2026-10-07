import { ZEROPS_GIT_REMOTE_DETAIL_MAX_CHARS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  gitCheckoutHostnames,
  environmentForBranch,
  gitActionAllowed,
  gitBlock,
  gitCheckoutLine,
  gitTrouble,
  gitVerdict,
  mateChangeIn,
  pullRequestBlocked,
  type GitBlockEvidence,
  type GitChangeState,
  type GitCheckoutState,
} from "./gitTab.ts";
import type { MergeabilityKind } from "./changeMergeability.ts";
import type { GroupEnvironment } from "./groupEnvironments.ts";
import { mateNextStep } from "./mateNextStep.ts";
import { changeState, type FlowPullRequest } from "./projectFlow.ts";

const DECLARATIONS: ReadonlyArray<GroupEnvironment> = [
  { name: "stage", tier: "stage", project: "p1", sources: ["main"] },
  {
    name: "stage-client-x",
    tier: "stage",
    project: "p2",
    sources: ["main", "feature/invoices"],
  },
  { name: "production", tier: "production", project: "p3", sources: "release" },
];

function checkout(overrides: Partial<GitCheckoutState> = {}): GitCheckoutState {
  return {
    repository: "api",
    isRepo: true,
    hasRemote: true,
    headRef: "main",
    aheadCount: 0,
    behindCount: 0,
    hasUpstream: true,
    changed: [],
    ...overrides,
  };
}

function changes(overrides: Partial<GitChangeState> = {}): GitChangeState {
  return { read: true, change: undefined, ...overrides };
}

/** The Mate's change `api #12` in HQ, as the flow carries it. */
function change(
  mergeability: MergeabilityKind,
  overrides: Partial<FlowPullRequest> = {},
): FlowPullRequest {
  return {
    repository: "api",
    number: 12,
    title: "Invoices",
    kind: "code",
    mateProjectId: "p1",
    url: "https://hq.example/changes/g1/api/12",
    mergeability,
    behind: false,
    merged: false,
    mergedAt: undefined,
    state: "open",
    headSha: "abc",
    baseBranch: "main",
    line: "api #12",
    updatedAt: undefined,
    ...overrides,
  };
}

const LANDED = { state: "closed", merged: true } as const;

const FILE = { path: "server.js", insertions: 12, deletions: 1 };
const OTHER = { path: "public/app.css", insertions: 2, deletions: 2 };

const EVIDENCE = { remoteReachable: true } as const;

const block = (
  checkoutState: GitCheckoutState,
  changeState: GitChangeState = changes(),
  evidence: GitBlockEvidence = EVIDENCE,
) =>
  gitBlock({ checkout: checkoutState, changes: changeState, declarations: DECLARATIONS, evidence });

describe("which environment picks a branch up", () => {
  it.each([
    { name: "the one stage following it", branch: "main", expected: "stage" },
    { name: "the first of several", branch: "feature/invoices", expected: "stage-client-x" },
    { name: "a branch nothing follows", branch: "chore/typo", expected: undefined },
    { name: "no branch at all", branch: null, expected: undefined },
  ])("finds $name", ({ branch, expected }) => {
    expect(environmentForBranch(DECLARATIONS, branch)).toBe(expected);
  });

  it("never answers with the production, whose source is a release", () => {
    expect(environmentForBranch(DECLARATIONS, "release")).toBeUndefined();
  });
});

describe("the line under the name", () => {
  it.each([
    {
      name: "a branch ahead, with a dirty tree",
      state: checkout({ headRef: "feature/invoices", aheadCount: 3, changed: [FILE, OTHER] }),
      expected: "feature/invoices ↑3 · 2 files changed",
    },
    {
      name: "one file, singular",
      state: checkout({ changed: [FILE] }),
      expected: "main · 1 file changed",
    },
    {
      name: "a branch behind as well as ahead",
      state: checkout({ headRef: "feature/invoices", aheadCount: 3, behindCount: 2 }),
      expected: "feature/invoices ↑3 ↓2",
    },
    {
      // `↑0 ↓0` is the one case where the arrows carry nothing: a person reads
      // two zeros and learns what the absence of arrows would have told them.
      name: "a checkout level with its remote, which spends no arrows saying so",
      state: checkout(),
      expected: "main",
    },
    {
      name: "a branch that was never pushed",
      state: checkout({ headRef: "feature/invoices", hasUpstream: false }),
      expected: "feature/invoices · never pushed",
    },
    {
      name: "a service with no repository at all",
      state: checkout({ isRepo: false }),
      expected: "no repository yet",
    },
    {
      name: "a detached head, which is a state and not a branch name",
      state: checkout({ headRef: null }),
      expected: "detached",
    },
  ])("writes $name", ({ state, expected }) => {
    expect(gitCheckoutLine(state)).toBe(expected);
  });

  it("counts the files it was handed rather than a number beside them", () => {
    expect(gitCheckoutLine(checkout({ changed: [FILE, OTHER] }))).toContain("2 files changed");
  });

  // A project id inside a ref is a machine name and nothing a reader can use; a branch a person
  // named means what they named it.
  it.each([
    { name: "HQ's branch of a Mate", ref: "mate/0bPLTRRSSTuV54WMpcLoww", named: "Theo's branch" },
    {
      name: "main's branch of a Mate",
      ref: "mate/mate-0bPLTRRSSTuV54WMpcLoww",
      named: "Theo's branch",
    },
    { name: "a branch a person named", ref: "feature/invoices", named: "feature/invoices" },
    {
      name: "a branch named like a Mate's but not one",
      ref: "mate/feature",
      named: "mate/feature",
    },
  ])("names $name", ({ ref, named }) => {
    expect(gitCheckoutLine(checkout({ headRef: ref }), "Theo")).toBe(named);
  });

  it("says the Mate's branch when it does not know the Mate's name", () => {
    expect(gitCheckoutLine(checkout({ headRef: "mate/0bPLTRRSSTuV54WMpcLoww" }))).toBe(
      "the Mate's branch",
    );
  });

  it("never repeats the repository, which is the name it sits under", () => {
    expect(gitCheckoutLine(checkout())).not.toContain("api");
  });
});

describe("where the work stands", () => {
  it.each([
    {
      name: "no repository at all",
      answer: block(checkout({ isRepo: false, hasRemote: false })),
      tone: "off",
      text: "No code here yet.",
    },
    {
      name: "a codebase nobody has touched",
      answer: block(checkout()),
      tone: "off",
      text: "Nothing new here.",
    },
    {
      name: "a branch that has never been pushed",
      answer: block(checkout({ headRef: "feature/invoices", hasUpstream: false })),
      tone: "busy",
      text: "This branch has never been pushed.",
    },
    {
      name: "commits sitting in the container",
      answer: block(checkout({ headRef: "feature/invoices", aheadCount: 3 })),
      tone: "busy",
      text: "3 commits here are not pushed yet.",
    },
    {
      name: "one commit, singular",
      answer: block(checkout({ headRef: "feature/invoices", aheadCount: 1 })),
      tone: "busy",
      text: "1 commit here is not pushed yet.",
    },
    {
      name: "a branch somebody else has pushed to",
      answer: block(checkout({ headRef: "feature/invoices", behindCount: 4 })),
      tone: "attention",
      text: "4 commits on the remote are not in this checkout yet.",
    },
    {
      // Grey, not green: no signal about it is not a good signal.
      name: "a pull request waiting on a person",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        changes({ change: change("mergeable") }),
      ),
      tone: "off",
      text: "Nothing is stopping it.",
    },
    {
      name: "a change HQ has not said yet whether it merges",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        changes({ change: change("checking") }),
      ),
      tone: "busy",
      text: "Checking whether it merges cleanly.",
    },
    {
      name: "a pull request main already has all of",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        changes({ change: change("empty") }),
      ),
      tone: "off",
      text: "Main already has all of it.",
    },
    {
      // The state that offers no verb: without a sentence, the row is a change
      // that looks fine and cannot move.
      name: "a change that will not merge",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        changes({ change: change("conflicting") }),
      ),
      tone: "attention",
      text: "It no longer merges cleanly.",
    },
    {
      name: "work that has landed",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        changes({ change: change("checking", LANDED) }),
      ),
      tone: "ok",
      text: "Merged into main.",
    },
  ] as const)("says $name", ({ answer, tone, text }) => {
    expect(answer.verdict).toMatchObject({ tone, text });
  });

  it.each([
    {
      name: "a branch nobody has pushed",
      answer: block(checkout({ headRef: "feature/invoices", hasUpstream: false })),
      ask: "Your work on api has never been pushed. Push the branch.",
    },
    {
      name: "commits sitting in the container",
      answer: block(checkout({ headRef: "feature/invoices", aheadCount: 3 })),
      ask: "3 commits on api are not pushed. Push them.",
    },
    {
      name: "a change that no longer merges",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        changes({ change: change("conflicting") }),
      ),
      ask: "Change #12 no longer merges cleanly. Merge main into it, resolve the conflicts, and deliver it again.",
    },
  ] as const)("hands $name back in words the Mate can act on", ({ answer, ask }) => {
    expect(answer.verdict?.ask).toBe(ask);
  });

  it.each([
    {
      name: "work that has landed",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        changes({ change: change("checking", LANDED) }),
      ),
    },
    { name: "a repository nobody has touched", answer: block(checkout()) },
    {
      // The verb is right there and it is the person's to press; asking the
      // Mate to do it as well would be two ways to the same place.
      name: "a branch the person can update themselves",
      answer: block(checkout({ headRef: "feature/invoices", behindCount: 4 })),
    },
    {
      name: "a change with nothing wrong with it",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        changes({ change: change("mergeable") }),
      ),
    },
  ])("asks nothing of $name", ({ answer }) => {
    expect(answer.verdict?.ask).toBeUndefined();
  });

  it("says what was proved wrong before anything it would have guessed", () => {
    const answer = block(checkout({ headRef: "feature/invoices", aheadCount: 3 }), changes(), {
      remoteReachable: false,
      remoteDetail: "remote: Repository not found.",
    });
    expect(answer.verdict).toEqual({
      tone: "failed",
      text: "remote: Repository not found.",
      ask: undefined,
    });
  });

  it("is a sentence, so it can be read aloud beside the others", () => {
    for (const state of [
      checkout(),
      checkout({ isRepo: false }),
      checkout({ headRef: "feature/invoices", aheadCount: 2 }),
      checkout({ headRef: "feature/invoices", behindCount: 2 }),
    ]) {
      expect(block(state).verdict?.text).toMatch(/\.$/u);
    }
  });

  it("says nothing at all until HQ has told its changes", () => {
    // Measured on the live account, 2026-09-19: the tab opened on "No code
    // here yet.", listed five of the Mate's commits under that sentence, and
    // then replaced the whole panel with "#11 · Nothing is stopping it." and a
    // *Merge*. Changes not told yet are not no changes.
    const unread = gitBlock({
      checkout: checkout({ headRef: "mate/mate-x", aheadCount: 3 }),
      changes: changes({ read: false }),
      declarations: DECLARATIONS,
      evidence: { remoteReachable: true },
    });
    expect(unread.state).toBe("unread");
    expect(unread.verdict).toBeUndefined();
    // Nor a verb, nor a destination: both would be withdrawn a moment later.
    expect(unread.action).toBeUndefined();
    expect(unread.destination).toBe("");
  });

  it("still says a repository is missing once HQ has told its changes", () => {
    const answered = gitBlock({
      checkout: checkout({ isRepo: false, headRef: null }),
      changes: changes(),
      declarations: DECLARATIONS,
      evidence: { remoteReachable: true },
    });
    expect(answered.state).toBe("no-repository");
    expect(answered.verdict?.text).toBe("No code here yet.");
  });

  it("says what was proved wrong even before HQ answers", () => {
    // A remote that refused is a different read, and it is proved. It is the
    // one thing worth saying while HQ is still out.
    const refused = gitBlock({
      checkout: checkout({ headRef: "mate/mate-x" }),
      changes: changes({ read: false }),
      declarations: DECLARATIONS,
      evidence: { remoteReachable: false, remoteDetail: "remote: access denied" },
    });
    expect(refused.verdict?.tone).toBe("failed");
  });

  it("can be asked directly, without a block around it", () => {
    expect(
      gitVerdict({
        state: "merged",
        checkout: checkout({ headRef: "feature/invoices" }),
        pullRequestNumber: 12,
        mergeability: "mergeable",
        baseBranch: "trunk",
        trouble: "",
      }),
    ).toEqual({ tone: "ok", text: "Merged into trunk.", ask: undefined });
  });
});

describe("every state of a block", () => {
  it("a dev pair with no repository yet says so, and offers nothing", () => {
    const answer = block(checkout({ isRepo: false, hasRemote: false }));
    expect(answer.state).toBe("no-repository");
    expect(answer.action).toBeUndefined();
    expect(answer.destination).toBe("");
  });

  it("a codebase the Mate has not touched shows main and nothing else", () => {
    const answer = block(checkout());
    expect(answer.state).toBe("untouched");
    expect(answer.action).toBeUndefined();
    expect(answer.pullRequestNumber).toBeUndefined();
    // `main` is a stage's source, so the row still says where this branch runs.
    expect(answer.destination).toBe("stage runs this branch");
  });

  it("an unpushed branch offers Push, and only Push", () => {
    const answer = block(checkout({ headRef: "feature/invoices", hasUpstream: false }));
    expect(answer.state).toBe("unpushed");
    expect(answer.action).toEqual({
      kind: "push",
      label: "Push",
      running: "Pushing…",
      ownerOnly: true,
    });
  });

  it("commits ahead of the remote are unpushed too", () => {
    expect(block(checkout({ headRef: "feature/invoices", aheadCount: 3 })).action?.kind).toBe(
      "push",
    );
  });

  it("a branch behind main offers Update from main once there is nothing to push", () => {
    const answer = block(checkout({ headRef: "feature/invoices", behindCount: 4 }));
    expect(answer.state).toBe("behind");
    expect(answer.action).toEqual({
      kind: "update-from-main",
      label: "Update from main",
      running: "Updating…",
      ownerOnly: true,
    });
  });

  it("pushing comes before updating: a branch both ahead and behind pushes first", () => {
    expect(
      block(checkout({ headRef: "feature/invoices", aheadCount: 1, behindCount: 4 })).action?.kind,
    ).toBe("push");
  });

  it("a pushed branch with no change open offers nothing: a Mate's push opens its change", () => {
    expect(block(checkout({ headRef: "feature/invoices" })).action).toBeUndefined();
    expect(block(checkout({ headRef: "main" })).action).toBeUndefined();
  });

  it("a change open says its number, where it is, and where it lands", () => {
    const answer = block(
      checkout({ headRef: "feature/invoices" }),
      changes({ change: change("mergeable") }),
    );
    expect(answer.state).toBe("in-review");
    expect(answer.pullRequestNumber).toBe(12);
    expect(answer.pullRequestUrl).toBe("https://hq.example/changes/g1/api/12");
    expect(answer.destination).toBe("stage picks it up on merge");
  });

  it.each(["mergeable", "conflicting", "checking"] as const)(
    "offers the review of an open change whatever is said of it (%s)",
    (mergeability) => {
      const open = block(
        checkout({ headRef: "feature/invoices" }),
        changes({ change: change(mergeability) }),
      );
      // The review says whether it merges, and carries Merge; the tab never merges itself.
      expect(open.action).toEqual({
        kind: "review",
        label: "Review",
        running: "Review",
        ownerOnly: false,
      });
    },
  );

  it("a merged change is HQ's business now, and offers nothing", () => {
    const answer = block(
      checkout({ headRef: "feature/invoices" }),
      changes({ change: change("checking", LANDED) }),
    );
    expect(answer.state).toBe("merged");
    expect(answer.action).toBeUndefined();
    // Not "runs this branch": after a merge the branch on the line above is
    // not what the stage runs, and saying so put two contradictions on one row.
    expect(answer.destination).toBe("stage runs it");
  });
});

describe("the fact that has to be proved", () => {
  it.each([
    {
      name: "nothing asked yet says nothing",
      evidence: { remoteReachable: undefined },
      expected: "",
    },
    // A Mate's checkout's origin is its application's repository in HQ.
    {
      name: "a remote that did not answer",
      evidence: { remoteReachable: false },
      expected: "HQ did not answer for this repository.",
    },
    {
      name: "a remote proved fine, which is still not a claim",
      evidence: { remoteReachable: true },
      expected: "",
    },
  ])("says, for $name", ({ evidence, expected }) => {
    expect(gitTrouble(evidence)).toBe(expected);
  });

  it("says what git said, when git said anything", () => {
    expect(
      gitTrouble({
        remoteReachable: false,
        remoteDetail: "remote: Gitea: user does not have permission",
      }),
    ).toBe("remote: Gitea: user does not have permission");
  });

  it("caps git's line where the probe caps it", () => {
    expect(
      gitTrouble({
        remoteReachable: false,
        remoteDetail: `remote: ${"x".repeat(500)}`,
      }),
    ).toHaveLength(ZEROPS_GIT_REMOTE_DETAIL_MAX_CHARS);
  });
});

describe("a setup proved broken offers no verb that would fail", () => {
  const evidence = (overrides: Partial<GitBlockEvidence> = {}): GitBlockEvidence => ({
    remoteReachable: true,
    ...overrides,
  });

  it.each([
    {
      name: "a branch nobody has pushed",
      state: checkout({ headRef: "feature/invoices", hasUpstream: false }),
      changeState: changes(),
      offered: "push",
    },
    {
      name: "a branch behind main",
      state: checkout({ behindCount: 2 }),
      changeState: changes(),
      offered: "update-from-main",
    },
    {
      name: "a change that merges",
      state: checkout({ headRef: "feature/invoices" }),
      changeState: changes({ change: change("mergeable") }),
      offered: "review",
    },
  ] as const)(
    "$name keeps its verb while nothing is proved wrong",
    ({ state, changeState, offered }) => {
      expect(block(state, changeState, evidence()).action?.kind).toBe(offered);
    },
  );

  it.each([
    {
      name: "a remote that did not answer",
      broken: evidence({ remoteReachable: false }),
    },
  ])("with $name, a container verb is not offered", ({ broken }) => {
    expect(block(checkout({ hasUpstream: false }), changes(), broken).action).toBeUndefined();
    expect(block(checkout({ behindCount: 2 }), changes(), broken).action).toBeUndefined();
  });

  it.each([
    {
      name: "a remote that did not answer",
      broken: evidence({ remoteReachable: false }),
    },
  ])("with $name, the review is still offered", ({ broken }) => {
    expect(
      block(
        checkout({ headRef: "feature/invoices" }),
        changes({ change: change("mergeable") }),
        broken,
      ).action?.kind,
    ).toBe("review");
  });
});

describe("the owner-only gate on checkout verbs", () => {
  it.each([
    {
      name: "Push",
      action: { kind: "push", label: "Push", running: "Pushing…", ownerOnly: true } as const,
    },
    {
      name: "Update from main",
      action: {
        kind: "update-from-main",
        label: "Update from main",
        running: "Updating…",
        ownerOnly: true,
      } as const,
    },
  ])("$name runs only for the Mate's owner", ({ action }) => {
    expect(gitActionAllowed(action, { isOwner: true })).toBe(true);
    expect(gitActionAllowed(action, { isOwner: false })).toBe(false);
  });

  it("Review opens the review, which polices what it offers, so anyone here may press it", () => {
    const review = {
      kind: "review",
      label: "Review",
      running: "Review",
      ownerOnly: false,
    } as const;
    expect(gitActionAllowed(review, { isOwner: false })).toBe(true);
  });

  it("no verb is nothing to press", () => {
    expect(gitActionAllowed(undefined, { isOwner: true })).toBe(false);
  });
});

describe("gitCheckoutHostnames", () => {
  it("lists the dev half of each pair and never its stage, nor a data service", () => {
    // The owner's run of 2026-09-17: "appstage · no repository yet" — a stage
    // gets its dev partner's compiled code deployed and is never a checkout.
    const services = [
      { hostname: "appdev", group: "runtimes" },
      { hostname: "appstage", group: "runtimes" },
      { hostname: "api", group: "runtimes" },
      { hostname: "db", group: "data" },
      { hostname: "zcp", group: "infrastructure" },
    ] as const;
    expect(gitCheckoutHostnames(services)).toEqual(["appdev", "api"]);
  });

  it("lists a service expanded from a single one as the dev half, never its stage", () => {
    // Dara's `todoapp` (2026-09-17), made in simple mode and expanded into a
    // pair: the dev half keeps its hostname, the stage is `todoappstage`.
    expect(
      gitCheckoutHostnames([
        { hostname: "todoapp", group: "runtimes" },
        { hostname: "todoappstage", group: "runtimes" },
        { hostname: "tododb", group: "data" },
      ]),
    ).toEqual(["todoapp"]);
  });

  it("keeps a runtime whose name ends in stage when it has no dev partner", () => {
    expect(
      gitCheckoutHostnames([
        { hostname: "backstage", group: "runtimes" },
        { hostname: "cachestage", group: "data" },
        { hostname: "cachedev", group: "runtimes" },
      ]),
    ).toEqual(["backstage", "cachedev"]);
  });
});

describe("gitBlock base branch", () => {
  it("is main, which every change in HQ goes onto", () => {
    expect(block(checkout({ headRef: "mate/mate-x" })).baseBranch).toBe("main");
    expect(
      block(checkout({ headRef: "mate/mate-x" }), changes({ change: change("mergeable") }))
        .baseBranch,
    ).toBe("main");
  });
});

describe("mateChangeIn: the Mate's newest change in a repository", () => {
  const open = change("mergeable", { number: 14 });
  const landed = change("mergeable", { number: 12, ...LANDED });
  const flow = {
    pullRequests: [open, change("mergeable", { number: 15, mateProjectId: "p2" })],
    merged: [landed, change("mergeable", { number: 3, repository: "web", ...LANDED })],
  };
  it.each<[string, string, string, FlowPullRequest | undefined, typeof flow]>([
    ["its open change, newer than the landed one", "p1", "api", open, flow],
    ["its landed one where none is open", "p1", "api", landed, { ...flow, pullRequests: [] }],
    ["nothing in a repository it has no change in", "p1", "cache", undefined, flow],
    ["nothing of another Mate's", "p3", "api", undefined, flow],
  ])("is %s", (_name, mate, repository, expected, of) => {
    expect(mateChangeIn(of, mate, repository)).toBe(expected);
  });
});

describe("what is on disk and not committed", () => {
  it("reaches a block file by file, not as a number", () => {
    expect(block(checkout({ changed: [FILE, OTHER] })).changed).toEqual([FILE, OTHER]);
  });

  it("is empty for a clean checkout rather than absent", () => {
    expect(block(checkout()).changed).toEqual([]);
  });
});

describe("a Mate's own branch, wherever it is read", () => {
  it("reaches a block through the name its caller was given", () => {
    const answer = gitBlock({
      checkout: checkout({ headRef: "mate/mate-0bPLTRRSSTuV54WMpcLoww" }),
      changes: changes(),
      declarations: DECLARATIONS,
      evidence: EVIDENCE,
      mateName: "Theo",
    });
    expect(answer.checkoutLine).toBe("Theo's branch");
    // The branch itself is untouched: a verb runs against the ref, not the label.
    expect(answer.branch).toBe("mate/mate-0bPLTRRSSTuV54WMpcLoww");
  });
});

describe("one answer on every surface (DESIGN §4.7)", () => {
  /** The composer's top over a project holding only this change: its review, or nothing. */
  function bannerOf(flow: FlowPullRequest) {
    const step = mateNextStep({ pullRequests: [flow], mateProjectId: "p1", mateName: "Iris" });
    return step.kind === "review" ? step : undefined;
  }

  /** The Git tab, the conversation's banner and the change's row, over one Mate's change. */
  function surfaces(flow: FlowPullRequest) {
    return {
      tab: gitBlock({
        checkout: checkout({ headRef: "mate/mate-p1" }),
        changes: changes({ change: flow }),
        declarations: DECLARATIONS,
        evidence: EVIDENCE,
      }),
      banner: bannerOf(flow),
      row: changeState(flow),
      blocked: pullRequestBlocked(flow),
    };
  }

  it.each(["mergeable", "checking", "conflicting", "empty"] as const)(
    "Git tab, banner and row agree on a change that is %s",
    (mergeability) => {
      const seen = surfaces(change(mergeability));
      // The tab's door is the review's, on every open change; the review decides.
      expect(seen.tab.action?.kind).toBe("review");
      expect(seen.banner !== undefined).toBe(mergeability === "mergeable");
      expect(seen.tab.verdict?.tone).toBe(seen.row?.tone);
      expect(seen.tab.verdict?.ask).toBe(seen.blocked?.ask);
      const rebase = {
        tab: /no longer merges/.test(seen.tab.verdict?.text ?? ""),
        row: seen.row?.word === "Conflicts with main",
      };
      expect(rebase.tab).toBe(rebase.row);
      expect(rebase.row).toBe(mergeability === "conflicting");
    },
  );

  it("a landed change is merged on the tab whatever was said of it", () => {
    expect(surfaces(change("conflicting", LANDED)).tab.state).toBe("merged");
  });
});

it("does not call an unread working tree clean or claim it has no repository", () => {
  const unread = checkout({ read: false, isRepo: false, changed: [] });
  expect(gitCheckoutLine(unread)).toBe("Reading repository…");
  expect(block(unread).state).toBe("unread");
});

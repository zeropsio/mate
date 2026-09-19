import { ZEROPS_GIT_REMOTE_DETAIL_MAX_CHARS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  gitCheckoutHostnames,
  checkTone,
  environmentForBranch,
  gitActionAllowed,
  gitBlock,
  gitCheckoutLine,
  gitChecks,
  gitTrouble,
  gitVerdict,
  type GitBlockEvidence,
  type GitCheckoutState,
  type GitForgeState,
} from "./gitTab.ts";
import type { GiteaCommitStatus, GiteaPullRequest, GiteaRepository } from "./giteaClient.ts";
import type { GroupEnvironment } from "./groupEnvironments.ts";

const DECLARATIONS: ReadonlyArray<GroupEnvironment> = [
  { name: "stage", tier: "stage", project: "p1", sources: ["main"], deploy: "on-push" },
  {
    name: "stage-client-x",
    tier: "stage",
    project: "p2",
    sources: ["main", "feature/invoices"],
    deploy: "on-push",
  },
  { name: "production", tier: "production", project: "p3", sources: "release", deploy: undefined },
];

const REPOSITORY: GiteaRepository = {
  id: 1,
  name: "api",
  full_name: "acme/api",
  default_branch: "main",
  permissions: { admin: false, push: true, pull: true },
};

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

function forge(overrides: Partial<GitForgeState> = {}): GitForgeState {
  return { repository: REPOSITORY, pullRequest: undefined, checks: [], ...overrides };
}

function pull(overrides: Partial<GiteaPullRequest> = {}): GiteaPullRequest {
  return {
    number: 12,
    title: "Invoices",
    state: "open",
    html_url: "https://gitea.example/acme/api/pulls/12",
    head: { ref: "feature/invoices", sha: "abc" },
    base: { ref: "main" },
    ...overrides,
  };
}

function status(context: string, state: GiteaCommitStatus["state"]): GiteaCommitStatus {
  return { context, state };
}

const FILE = { path: "server.js", insertions: 12, deletions: 1 };
const OTHER = { path: "public/app.css", insertions: 2, deletions: 2 };

const EVIDENCE = { remoteReachable: true } as const;

const block = (
  checkoutState: GitCheckoutState,
  forgeState: GitForgeState = forge(),
  evidence: GitBlockEvidence = EVIDENCE,
) => gitBlock({ checkout: checkoutState, forge: forgeState, declarations: DECLARATIONS, evidence });

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

describe("the checks on a head", () => {
  it.each([
    { name: "nothing ran", statuses: [], expected: "none" },
    { name: "all green", statuses: [status("ci/test", "success")], expected: "passing" },
    {
      name: "one still going",
      statuses: [status("ci/test", "success"), status("ci/lint", "pending")],
      expected: "pending",
    },
    {
      name: "one red among greens",
      statuses: [status("ci/test", "success"), status("ci/lint", "failure")],
      expected: "failing",
    },
    {
      name: "only the broker's own deploy statuses, which are not checks",
      statuses: [status("mate/deploy/stage/api", "failure")],
      expected: "none",
    },
  ] as const)("reads $name", ({ statuses, expected }) => {
    expect(checkTone(statuses)).toBe(expected);
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

  it("names a Mate's own branch after the Mate, never after its project id", () => {
    // `mate/mate-PXGYIVK9RLWlE3eTL3Qwow` is a project id inside a bot login
    // inside a ref: three machine names and nothing a reader can use.
    const own = checkout({ headRef: "mate/mate-0bPLTRRSSTuV54WMpcLoww" });
    expect(gitCheckoutLine(own, "Theo")).toBe("Theo's branch");
    expect(gitCheckoutLine(own)).toBe("the Mate's branch");
    // A branch a person named means what they named it.
    expect(gitCheckoutLine(checkout({ headRef: "feature/invoices" }), "Theo")).toBe(
      "feature/invoices",
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
      answer: block(
        checkout({ isRepo: false, hasRemote: false }),
        forge({ repository: undefined }),
      ),
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
      name: "a pull request waiting on a person",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        forge({ pullRequest: pull({ mergeable: true }), checks: [status("ci/test", "success")] }),
      ),
      tone: "ok",
      text: "The checks passed. Nothing is stopping it.",
    },
    {
      name: "a pull request whose checks are still going",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        forge({ pullRequest: pull({ mergeable: true }), checks: [status("ci/test", "pending")] }),
      ),
      tone: "busy",
      text: "Its checks are still running.",
    },
    {
      name: "a pull request whose checks went red",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        forge({ pullRequest: pull({ mergeable: true }), checks: [status("ci/test", "failure")] }),
      ),
      tone: "failed",
      text: "Its checks failed.",
    },
    {
      // The state that offers no verb: without a sentence, the row is a change
      // that looks fine and cannot move, which is the trap `changeVerdict` was
      // written to close.
      name: "a pull request the forge will not take",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        forge({ pullRequest: pull({ mergeable: false }) }),
      ),
      tone: "attention",
      text: "It no longer merges cleanly.",
    },
    {
      name: "work that has landed",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        forge({ pullRequest: pull({ state: "closed", merged: true }) }),
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
        forge({ pullRequest: pull({ mergeable: false }) }),
      ),
      ask: "Pull request #12 no longer merges cleanly. Rebase it on main, resolve the conflicts, and push.",
    },
    {
      name: "checks the forge would let through anyway",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        forge({ pullRequest: pull({ mergeable: true }), checks: [status("ci/test", "failure")] }),
      ),
      ask: "The checks on pull request #12 are failing. Find out why, fix them, and push.",
    },
  ] as const)("hands $name back in words the Mate can act on", ({ answer, ask }) => {
    expect(answer.verdict.ask).toBe(ask);
  });

  it.each([
    {
      name: "work that has landed",
      answer: block(
        checkout({ headRef: "feature/invoices" }),
        forge({ pullRequest: pull({ state: "closed", merged: true }) }),
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
        forge({ pullRequest: pull({ mergeable: true }), checks: [status("ci/test", "success")] }),
      ),
    },
  ])("asks nothing of $name", ({ answer }) => {
    expect(answer.verdict.ask).toBeUndefined();
  });

  it("says what was proved wrong before anything it would have guessed", () => {
    const answer = block(checkout({ headRef: "feature/invoices", aheadCount: 3 }), forge(), {
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
      expect(block(state).verdict.text).toMatch(/\.$/u);
    }
  });

  it("says nothing ran rather than calling no signal a good one", () => {
    const answer = block(
      checkout({ headRef: "feature/invoices" }),
      forge({ pullRequest: pull({ mergeable: true }), checks: [] }),
    );
    expect(answer.verdict).toEqual({
      tone: "off",
      text: "No checks ran. Nothing is stopping it.",
      ask: undefined,
    });
  });

  it("can be asked directly, without a block around it", () => {
    expect(
      gitVerdict({
        state: "merged",
        checks: "none",
        checkout: checkout({ headRef: "feature/invoices" }),
        pullRequestNumber: 12,
        mergeable: true,
        baseBranch: "trunk",
        trouble: "",
      }),
    ).toEqual({ tone: "ok", text: "Merged into trunk.", ask: undefined });
  });
});

describe("every state of a block", () => {
  it("a dev pair with no repository yet says so, and offers nothing", () => {
    const answer = block(
      checkout({ isRepo: false, hasRemote: false }),
      forge({ repository: undefined }),
    );
    expect(answer.state).toBe("no-repository");
    expect(answer.action).toBeUndefined();
    expect(answer.destination).toBe("");
  });

  it("a codebase the Mate has not touched shows main and nothing else", () => {
    const answer = block(checkout());
    expect(answer.state).toBe("untouched");
    expect(answer.action).toBeUndefined();
    expect(answer.pullRequestNumber).toBeUndefined();
    expect(answer.checkWord).toBeUndefined();
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

  it("a pushed branch with no pull request offers to open one", () => {
    expect(block(checkout({ headRef: "feature/invoices" })).action).toEqual({
      kind: "open-pull-request",
      label: "Open pull request",
      running: "Opening…",
      ownerOnly: false,
    });
  });

  it("the default branch never offers a pull request into itself", () => {
    expect(block(checkout({ headRef: "main" })).action).toBeUndefined();
  });

  it("a pull request open with checks says its number, its checks and where it lands", () => {
    const answer = block(
      checkout({ headRef: "feature/invoices" }),
      forge({ pullRequest: pull(), checks: [status("ci/test", "success")] }),
    );
    expect(answer.state).toBe("in-review");
    expect(answer.pullRequestNumber).toBe(12);
    expect(answer.checks).toBe("passing");
    expect(answer.checkWord).toBe("Passing");
    expect(answer.destination).toBe("stage picks it up on merge");
  });

  it("offers a merge only where Gitea already said this person may", () => {
    const mergeable = block(
      checkout({ headRef: "feature/invoices" }),
      forge({ pullRequest: pull({ mergeable: true }) }),
    );
    expect(mergeable.action).toEqual({
      kind: "merge",
      label: "Merge",
      running: "Merging…",
      ownerOnly: false,
    });
    const blocked = block(
      checkout({ headRef: "feature/invoices" }),
      forge({ pullRequest: pull({ mergeable: false }) }),
    );
    expect(blocked.action).toBeUndefined();
  });

  it("a merged pull request is the broker's business now, and offers nothing", () => {
    const answer = block(
      checkout({ headRef: "feature/invoices" }),
      forge({ pullRequest: pull({ state: "closed", merged: true }) }),
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
    {
      name: "a remote that did not answer",
      evidence: { remoteReachable: false },
      expected: "Its remote did not answer.",
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
      forgeState: forge(),
      offered: "push",
    },
    {
      name: "a branch behind main",
      state: checkout({ behindCount: 2 }),
      forgeState: forge(),
      offered: "update-from-main",
    },
    {
      name: "a pushed branch with no pull request",
      state: checkout({ headRef: "feature/invoices" }),
      forgeState: forge(),
      offered: "open-pull-request",
    },
    {
      name: "a pull request Gitea says is mergeable",
      state: checkout({ headRef: "feature/invoices" }),
      forgeState: forge({ pullRequest: pull({ mergeable: true }) }),
      offered: "merge",
    },
  ] as const)(
    "$name keeps its verb while nothing is proved wrong",
    ({ state, forgeState, offered }) => {
      expect(block(state, forgeState, evidence()).action?.kind).toBe(offered);
    },
  );

  it.each([
    {
      name: "a remote that did not answer",
      broken: evidence({ remoteReachable: false }),
    },
  ])("with $name, a container verb is not offered", ({ broken }) => {
    expect(block(checkout({ hasUpstream: false }), forge(), broken).action).toBeUndefined();
    expect(block(checkout({ behindCount: 2 }), forge(), broken).action).toBeUndefined();
  });

  it.each([
    {
      name: "a remote that did not answer",
      broken: evidence({ remoteReachable: false }),
    },
  ])("with $name, a verb Gitea runs is still offered", ({ broken }) => {
    expect(block(checkout({ headRef: "feature/invoices" }), forge(), broken).action?.kind).toBe(
      "open-pull-request",
    );
    expect(
      block(
        checkout({ headRef: "feature/invoices" }),
        forge({ pullRequest: pull({ mergeable: true }) }),
        broken,
      ).action?.kind,
    ).toBe("merge");
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

  it.each([
    {
      name: "Open pull request",
      action: {
        kind: "open-pull-request",
        label: "Open pull request",
        running: "Opening…",
        ownerOnly: false,
      } as const,
    },
    {
      name: "Merge",
      action: {
        kind: "merge",
        label: "Merge",
        running: "Merging…",
        ownerOnly: false,
      } as const,
    },
  ])("$name is Gitea's to police, so anyone here may press it", ({ action }) => {
    expect(gitActionAllowed(action, { isOwner: false })).toBe(true);
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
  // The Git tab's "Open pull request" opens it onto this branch (2026-09-17:
  // the verb was wired to nothing, and the click did nothing).
  it("carries the repository's default branch, main until Gitea says", () => {
    const withRepository = gitBlock({
      checkout: checkout({ headRef: "mate/mate-x", hasUpstream: true }),
      forge: {
        repository: { ...REPOSITORY, default_branch: "trunk" },
        pullRequest: undefined,
        checks: [],
      },
      declarations: DECLARATIONS,
      evidence: { remoteReachable: true },
    });
    expect(withRepository.baseBranch).toBe("trunk");
    const unknown = gitBlock({
      checkout: checkout({ headRef: "mate/mate-x", hasUpstream: true }),
      forge: { repository: undefined, pullRequest: undefined, checks: [] },
      declarations: DECLARATIONS,
      evidence: { remoteReachable: true },
    });
    expect(unknown.baseBranch).toBe("main");
  });
});

describe("the checks, by name", () => {
  it("lists every check the forge reported, with its own word", () => {
    expect(
      gitChecks([
        status("ci/test", "success"),
        status("ci/lint", "pending"),
        status("ci/types", "failure"),
      ]),
    ).toEqual([
      { name: "ci/test", tone: "ok", word: "Passed" },
      { name: "ci/lint", tone: "busy", word: "Running" },
      { name: "ci/types", tone: "failed", word: "Failed" },
    ]);
  });

  it("keeps the broker's deploy statuses out, as the collapsed word does", () => {
    // They are what happened after a change landed, not a verdict on it.
    expect(gitChecks([status("mate/deploy/stage/api", "failure")])).toEqual([]);
  });

  it("says a state it does not know rather than guessing a colour for it", () => {
    expect(gitChecks([status("ci/test", "warning" as never)])).toEqual([
      { name: "ci/test", tone: "off", word: "Unknown" },
    ]);
  });

  it("reaches a block, so the panel never has to ask the forge itself", () => {
    const answer = block(
      checkout({ headRef: "feature/invoices" }),
      forge({ pullRequest: pull(), checks: [status("ci/test", "failure")] }),
    );
    expect(answer.checkRows).toEqual([{ name: "ci/test", tone: "failed", word: "Failed" }]);
    expect(answer.checks).toBe("failing");
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
      forge: forge(),
      declarations: DECLARATIONS,
      evidence: EVIDENCE,
      mateName: "Theo",
    });
    expect(answer.checkoutLine).toBe("Theo's branch");
    // The branch itself is untouched: a verb runs against the ref, not the label.
    expect(answer.branch).toBe("mate/mate-0bPLTRRSSTuV54WMpcLoww");
  });
});

import { ZEROPS_GIT_REMOTE_DETAIL_MAX_CHARS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  gitCheckoutHostnames,
  checkTone,
  environmentForBranch,
  gitActionAllowed,
  gitBlock,
  gitHeadLine,
  gitTrouble,
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
    changedFiles: 0,
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

describe("the first line", () => {
  it.each([
    {
      name: "a branch ahead, with a dirty tree",
      state: checkout({ headRef: "feature/invoices", aheadCount: 3, changedFiles: 2 }),
      expected: "api · feature/invoices ↑3 ↓0 · 2 files changed",
    },
    {
      name: "one file, singular",
      state: checkout({ changedFiles: 1 }),
      expected: "api · main ↑0 ↓0 · 1 file changed",
    },
    {
      name: "a clean checkout, which says nothing about files",
      state: checkout(),
      expected: "api · main ↑0 ↓0",
    },
    {
      name: "a branch that was never pushed",
      state: checkout({ headRef: "feature/invoices", hasUpstream: false }),
      expected: "api · feature/invoices not pushed",
    },
    {
      name: "a service with no repository at all",
      state: checkout({ isRepo: false }),
      expected: "api · no repository yet",
    },
  ])("writes $name", ({ state, expected }) => {
    expect(gitHeadLine(state)).toBe(expected);
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
    expect(answer.destination).toBe("stage runs this branch");
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

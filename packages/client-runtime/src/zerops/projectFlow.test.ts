import { COMPARE_COUNT_MAX, type HqChange } from "@t3tools/shared/hqChanges";
import type { HqNavigationChange } from "@t3tools/shared/hqStream";
import { describe, expect, it } from "vite-plus/test";

import { pullRequestBlocked, pullRequestBlockedReason } from "./gitTab.ts";
import { mateProjectOfBranch, mateProjectOfLogin } from "./mateIdentity.ts";

import type { MergeabilityKind } from "./changeMergeability.ts";
import {
  changeKindTag,
  changeShowsReview,
  changeState,
  pullRequestMergeLine,
  releaseContentsSentence,
  releaseContentsCommits,
  waitingForProduction,
  releaseContentsSummary,
  releaseWaitingLabel,
  flowChange,
  flowAppChanges,
  flowChanges,
  flowVerbKey,
  flowVerbLabel,
  isRecipeProposal,
  pullRequestLineWith,
  pullRequestsByMate,
  pullRequestsFolded,
  sidebarChangeLabel,
  type FlowPullRequest,
  changeLandedEvents,
  agentLastSpokeAt,
  agentNotesFor,
  agentTurnNotes,
  type ChangeLandedEvent,
} from "./projectFlow.ts";

const VERA = "tsXR3xnURPSvsy4zp1EaYA";
const FEN = "9lSt5lFxQ1mQ3v8b7c2d1e";

/** Vera's open `appdev #4` as the flow carries it. */
function row(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 4,
    title: "Add a due date to each todo",
    kind: "code",
    mateProjectId: VERA,
    url: "https://hq.example/changes/g1/appdev/4",
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    state: "open",
    headSha: "abc",
    baseBranch: "main",
    line: "appdev #4",
    updatedAt: "2026-09-17T18:00:00Z",
    ...over,
  };
}

describe("a Mate's changes in HQ, as the flow shows them", () => {
  const HQ = "https://hq-30db-8080.prg1.zerops.app";
  const SHA = "a".repeat(40);
  const change = (over: Partial<HqChange> = {}): HqChange => ({
    appId: "g1",
    repo: "appdev",
    number: 3,
    mateProjectId: VERA,
    title: "Add a due date to each todo",
    body: "",
    state: "open",
    head: SHA,
    mergedSha: null,
    landedHead: null,
    openedAt: "2026-10-02T09:00:00.000Z",
    mergedAt: null,
    closedAt: null,
    updatedAt: "2026-10-02T09:00:00.000Z",
    mergeability: "clean",
    behind: false,
    ready: true,
    comments: 0,
    ...over,
  });
  const flow = (changes: ReadonlyArray<HqChange>) => flowChanges({ changes, hqAddress: `${HQ}/` });

  it.each(["required", "advisory", "unknown"] as const)(
    "carries exact-head %s pipeline evidence into review",
    (requirement) => {
      const pipeline = {
        head: SHA,
        requirements: "known",
        checks: [{ id: "build", name: "Build", requirement, state: "running" }],
      } as const;
      expect(flowChange(change({ pipeline }), HQ).pipeline).toEqual(pipeline);
      expect(flowChange(change(), HQ).pipeline).toBeUndefined();
    },
  );

  // SPEC §3.2c: the recipe repository's change is a recipe change; its row wears the tag, so its
  // line is its number alone, and the one zcp titles is the Mate's proposal of the recipe.
  it("draws a change in the recipe repository as a recipe change, its proposal known by title", () => {
    const [proposal] = flow([
      change({ repo: "group", number: 6, title: "Mate: the group's import files" }),
    ]).pullRequests;
    expect(proposal).toMatchObject({ kind: "recipe", repository: "group", line: "#6" });
    expect(proposal !== undefined && isRecipeProposal(proposal)).toBe(true);
  });

  it("draws an open change its Mate pushed to as a row, at HQ's own address", () => {
    const pushed = change({ updatedAt: "2026-10-02T09:30:00.000Z" });
    expect(flow([pushed]).pullRequests).toEqual([
      {
        repository: "appdev",
        number: 3,
        title: "Add a due date to each todo",
        kind: "code",
        mateProjectId: VERA,
        url: `${HQ}/changes/g1/appdev/3`,
        mergeability: "mergeable",
        behind: false,
        merged: false,
        mergedAt: undefined,
        state: "open",
        headSha: SHA,
        baseBranch: "main",
        line: "appdev #3",
        // Its last push, edit of its words, or comment.
        updatedAt: "2026-10-02T09:30:00.000Z",
        headBranch: `mate/${VERA}/3`,
        description: undefined,
        commentCount: 0,
        ready: true,
      },
    ]);
  });

  it.each([
    ["as HQ counted them", 3, 3],
    ["none, from an HQ that counts none", null, undefined],
  ] as const)("carries how many comments were said on it: %s", (_case, comments, count) => {
    expect(flow([change({ comments })]).pullRequests[0]?.commentCount).toBe(count);
  });

  it.each([
    ["clean", "mergeable"],
    ["conflict", "conflicting"],
    ["empty", "empty"],
    ["unknown", "checking"],
  ] as const)("names how it merges as HQ last judged it: %s", (said, word) => {
    expect(flow([change({ mergeability: said })]).pullRequests[0]?.mergeability).toBe(word);
  });

  it.each([
    ["a change described at its head asks for review", true],
    ["a draft asks for nothing", false],
  ] as const)("%s", (_case, ready) => {
    expect(flow([change({ ready })]).pullRequests[0]?.ready).toBe(ready);
  });

  it("is behind main where HQ judged main moved past it", () => {
    expect(flow([change({ behind: true })]).pullRequests[0]?.behind).toBe(true);
  });

  it("carries its description where its Mate wrote one", () => {
    expect(flow([change({ body: "Adds the field." })]).pullRequests[0]?.description).toBe(
      "Adds the field.",
    );
  });

  it("never draws a change no push reached", () => {
    expect(flow([change({ head: null })]).pullRequests).toEqual([]);
  });

  it("lists the landed ones, newest first, with the commit they landed as", () => {
    const landed = (number: number, mergedAt: string) =>
      change({
        number,
        state: "merged",
        mergedSha: "m".repeat(39) + String(number),
        landedHead: SHA,
        mergedAt,
        updatedAt: mergedAt,
      });
    const { pullRequests, merged } = flow([
      landed(1, "2026-10-02T10:00:00.000Z"),
      landed(2, "2026-10-02T11:00:00.000Z"),
      change({ number: 4, state: "closed", closedAt: "2026-10-02T12:00:00.000Z" }),
    ]);
    expect(pullRequests).toEqual([]);
    expect(merged.map((entry) => [entry.number, entry.merged, entry.state])).toEqual([
      [2, true, "closed"],
      [1, true, "closed"],
    ]);
    expect(merged[0]).toMatchObject({
      mergedAt: "2026-10-02T11:00:00.000Z",
      mergeCommitSha: "m".repeat(39) + "2",
      updatedAt: "2026-10-02T11:00:00.000Z",
    });
  });
});

describe("an application's changes: the menu's rows, and its detail while a surface holds it", () => {
  const HQ = "https://hq-30db-8080.prg1.zerops.app";
  const SHA = "a".repeat(40);
  const menuRow = (over: Partial<HqNavigationChange> = {}): HqNavigationChange => ({
    repo: "appdev",
    number: 3,
    mateProjectId: VERA,
    title: "Add a due date to each todo",
    state: "open",
    hasHead: true,
    updatedAt: "2026-10-02T09:30:00.000Z",
    mergeability: "clean",
    ready: true,
    ...over,
  });

  it("draws each open change navigation lists that a push reached, without the detail", () => {
    expect(
      flowAppChanges({
        appId: "g1",
        open: [menuRow(), menuRow({ number: 4, hasHead: false })],
        detail: undefined,
        hqAddress: `${HQ}/`,
      }),
    ).toEqual({
      pullRequests: [
        {
          repository: "appdev",
          number: 3,
          title: "Add a due date to each todo",
          kind: "code",
          mateProjectId: VERA,
          url: `${HQ}/changes/g1/appdev/3`,
          mergeability: "mergeable",
          behind: false,
          merged: false,
          mergedAt: undefined,
          state: "open",
          headSha: undefined,
          baseBranch: "main",
          line: "appdev #3",
          updatedAt: "2026-10-02T09:30:00.000Z",
          headBranch: `mate/${VERA}/3`,
          ready: true,
        },
      ],
      merged: [],
    });
  });

  it("draws an open row from the held detail, and lists the landed ones only from it", () => {
    const detail: ReadonlyArray<HqChange> = [
      {
        appId: "g1",
        repo: "appdev",
        number: 3,
        mateProjectId: VERA,
        title: "Add a due date to each todo",
        body: "Adds the field.",
        state: "open",
        head: SHA,
        mergedSha: null,
        landedHead: null,
        openedAt: "2026-10-02T09:00:00.000Z",
        mergedAt: null,
        closedAt: null,
        updatedAt: "2026-10-02T09:30:00.000Z",
        mergeability: "clean",
        behind: true,
        ready: true,
        comments: 2,
      },
      {
        appId: "g1",
        repo: "appdev",
        number: 1,
        mateProjectId: VERA,
        title: "First page",
        body: "",
        state: "merged",
        head: SHA,
        mergedSha: "m".repeat(40),
        landedHead: SHA,
        openedAt: "2026-10-01T09:00:00.000Z",
        mergedAt: "2026-10-01T10:00:00.000Z",
        closedAt: null,
        updatedAt: "2026-10-01T10:00:00.000Z",
        mergeability: "clean",
        behind: false,
        ready: true,
        comments: 0,
      },
    ];
    const { pullRequests, merged } = flowAppChanges({
      appId: "g1",
      open: [menuRow()],
      detail,
      hqAddress: `${HQ}/`,
    });
    expect(pullRequests).toEqual([
      expect.objectContaining({
        number: 3,
        headSha: SHA,
        behind: true,
        description: "Adds the field.",
        commentCount: 2,
      }),
    ]);
    expect(merged.map(({ number }) => number)).toEqual([1]);
  });
});

describe("the one merge that was an application's first code", () => {
  const merged = (over: Partial<HqChange>): HqChange => ({
    appId: "g1",
    repo: "appdev",
    number: 3,
    mateProjectId: VERA,
    title: "First",
    body: "",
    state: "merged",
    head: "a".repeat(40),
    mergedSha: "m".repeat(40),
    landedHead: "a".repeat(40),
    openedAt: "2026-10-02T09:00:00.000Z",
    mergedAt: "2026-10-02T10:00:00.000Z",
    closedAt: null,
    updatedAt: "2026-10-02T10:00:00.000Z",
    mergeability: "clean",
    behind: false,
    ready: true,
    comments: 0,
    ...over,
  });
  it.each([
    ["HQ says it was", { firstCodeMerge: true }, true],
    ["HQ says it was not", { firstCodeMerge: false }, false],
    ["HQ says nothing", {}, undefined],
  ] as const)("%s", (_name, over, expected) => {
    expect(flowChange(merged(over), "https://hq/").firstCodeMerge).toBe(expected);
  });
});

describe("whose pull request it is", () => {
  it.each([
    { name: "main's zcp's branch", ref: `mate/mate-${VERA}`, expected: VERA },
    { name: "HQ's branch of a Mate", ref: `mate/${VERA}`, expected: VERA },
    { name: "a change's branch in HQ", ref: `mate/${VERA}/3`, expected: VERA },
    { name: "a person's branch", ref: "feature/invoices", expected: undefined },
    { name: "a branch named like a Mate's but not one", ref: "mate/feature", expected: undefined },
    { name: "no branch", ref: undefined, expected: undefined },
  ])("reads $name", ({ ref, expected }) => {
    expect(mateProjectOfBranch(ref)).toBe(expected);
  });

  it.each([
    { name: "the bot", login: `mate-${FEN}`, expected: FEN },
    { name: "a person", login: "u-iwbxltjisnogy3r7nj28bg", expected: undefined },
    { name: "nobody", login: undefined, expected: undefined },
  ])("reads $name", ({ login, expected }) => {
    expect(mateProjectOfLogin(login)).toBe(expected);
  });
});

describe("naming a change", () => {
  it("names the Mate on a row that does not sit under it", () => {
    expect(pullRequestLineWith(row(), "Vera")).toBe("appdev #4 · Vera");
    expect(pullRequestLineWith(row(), undefined)).toBe("appdev #4");
  });

  // HQ's word for a Mate's work is a change (design-system glossary): never a PR.
  it.each([
    { kind: "code", tag: "change" },
    { kind: "recipe", tag: "recipe" },
  ] as const)("tags a $kind change as $tag", ({ kind, tag }) => {
    expect(changeKindTag({ kind })).toBe(tag);
  });

  it("reads as its number and title in a menu row", () => {
    // Stripped to its number under its Mate the change lost its name, which
    // cost more than echoing the task above it did. The fork carries the
    // distinction instead.
    expect(sidebarChangeLabel(row())).toBe("#4 Add a due date to each todo");
  });
});

describe("sidebarChangeLabel: a Mate's changes in two repositories name their repository", () => {
  const change = (repository: string, number: number, title: string, mate: string) =>
    row({ repository, number, title, mateProjectId: mate, line: `${repository} #${number}` });
  const appdev = change("appdev", 1, "Build the storefront", VERA);
  const apidev = change("apidev", 1, "Rebuild the API", VERA);
  const fenApi = change("apidev", 2, "Add a health route", FEN);

  it.each([
    ["one repository: number and title", appdev, [appdev, fenApi], "#1 Build the storefront"],
    ["alone, nothing to tell apart", appdev, undefined, "#1 Build the storefront"],
    [
      "two repositories: each names its own",
      appdev,
      [appdev, apidev],
      "appdev #1 Build the storefront",
    ],
    [
      "two repositories, the other one",
      apidev,
      [appdev, apidev, fenApi],
      "apidev #1 Rebuild the API",
    ],
    [
      "another Mate's repository is not this Mate's",
      fenApi,
      [appdev, apidev, fenApi],
      "#2 Add a health route",
    ],
  ] as const)("%s", (_case, row, among, label) => {
    expect(sidebarChangeLabel(row, among)).toBe(label);
  });
});

describe("the pull requests of each Mate", () => {
  const vera = row();
  const veraRecipe = row({
    repository: "group",
    kind: "recipe",
    number: 6,
    title: "Mate: the group's import files",
    line: "#6",
  });
  const fen = row({
    number: 5,
    mateProjectId: FEN,
    line: "appdev #5",
    updatedAt: "2026-09-17T19:00:00Z",
  });
  it("puts each Mate's under it, newest first", () => {
    const older = row({ number: 3, line: "appdev #3", updatedAt: "2026-09-17T12:00:00Z" });
    const grouped = pullRequestsByMate([older, fen, vera, veraRecipe], [VERA, FEN]);
    // #4 and #6 moved at the same moment; the higher number is the newer one.
    expect(grouped.byMate.get(VERA)?.map((entry) => entry.number)).toEqual([6, 4, 3]);
    expect(grouped.byMate.get(FEN)?.map((entry) => entry.number)).toEqual([5]);
  });

  // HQ retains a change after its Mate disappears from the listing.
  it("keeps the changes of a Mate the caller no longer lists", () => {
    const grouped = pullRequestsByMate([vera], [FEN]);
    expect(grouped.byMate.get(FEN)).toEqual([]);
    expect(grouped.byMate.has(VERA)).toBe(false);
    expect(grouped.others).toEqual([vera]);
  });

  it("folds a Mate's pull requests only once there are more than three", () => {
    expect(pullRequestsFolded(0)).toBe(false);
    expect(pullRequestsFolded(3)).toBe(false);
    expect(pullRequestsFolded(4)).toBe(true);
  });
});

describe("a verb in flight", () => {
  it("keys each verb by its target, so one row's Merge is nobody else's", () => {
    const change = { groupId: "g1", repository: "appdev", number: 4 } as const;
    const merge4 = flowVerbKey({ kind: "merge", ...change });
    expect(merge4).toBe("merge g1/appdev#4");
    expect(merge4).not.toBe(flowVerbKey({ kind: "merge", ...change, number: 3 }));
    expect(merge4).not.toBe(flowVerbKey({ kind: "merge", ...change, groupId: "g2" }));
    expect(merge4).not.toBe(flowVerbKey({ kind: "close", ...change }));
    expect(flowVerbKey({ kind: "release", groupId: "g1" })).not.toBe(
      flowVerbKey({ kind: "roll-back", groupId: "g1", tag: "v0.1.0" }),
    );
  });

  it("keys a deploy asked again by its environment and service", () => {
    const api = { kind: "redeploy", groupId: "g1", projectId: "p-stage", service: "api" } as const;
    expect(flowVerbKey(api)).toBe("redeploy g1/p-stage/api");
    expect(flowVerbKey(api)).not.toBe(flowVerbKey({ ...api, service: "web" }));
    expect(flowVerbKey(api)).not.toBe(flowVerbKey({ ...api, projectId: "p-prod" }));
  });

  it("keys a service added by its environment and service, apart from its deploy asked again", () => {
    const cache = {
      kind: "add-service",
      groupId: "g1",
      projectId: "p-stage",
      service: "cache",
    } as const;
    expect(flowVerbKey(cache)).toBe("add-service g1/p-stage/cache");
    expect(flowVerbKey(cache)).not.toBe(flowVerbKey({ ...cache, kind: "redeploy" }));
  });

  it.each([
    ["merge", "Merge", "Merging…"],
    ["release", "Release", "Releasing…"],
    ["roll-back", "Roll back to this", "Rolling back…"],
    ["redeploy", "Run again", "Redeploying…"],
    ["add-service", "Add", "Adding…"],
  ] as const)("says what %s does, then that it is doing it", (kind, idle, running) => {
    expect(flowVerbLabel(kind, false)).toBe(idle);
    expect(flowVerbLabel(kind, true)).toBe(running);
  });
});

describe("pullRequestBlockedReason", () => {
  const cases: ReadonlyArray<[MergeabilityKind, string | null]> = [
    // Gitea says it merges: the verb is the whole answer.
    ["mergeable", null],
    // It does not, and the row says why rather than dropping its verb silently.
    ["conflicting", "conflicts with main"],
    // Gitea is still working it out after a push: nobody is asked to rebase.
    ["checking", "checking"],
    // Nothing in it main does not have: nobody is asked anything either.
    ["empty", "nothing to merge"],
  ];

  it.each(
    Array.from(cases, ([mergeability, expected]) => ({
      title: `${mergeability}: ${expected ?? "nothing to add"}`,
      mergeability,
      expected,
    })),
  )("$title", ({ mergeability, expected }) => {
    expect(pullRequestBlockedReason({ number: 4, mergeability })).toBe(expected);
  });

  it("tones each reason to itself", () => {
    expect(pullRequestBlocked({ number: 4, mergeability: "conflicting" })).toMatchObject({
      kind: "behind",
      word: "conflicts with main",
      tone: "attention",
    });
    expect(pullRequestBlocked({ number: 4, mergeability: "checking" })).toMatchObject({
      kind: "checking",
      word: "checking",
      tone: "busy",
    });
    expect(pullRequestBlocked({ number: 4, mergeability: "mergeable" })).toBeNull();
  });

  it("hands every refusal somebody can act on to the Mate, and names the change", () => {
    // Nobody reading the menu is going to rebase a branch they have not
    // checked out in a repository they have no session for. The Mate does it.
    const behind = pullRequestBlocked({ number: 4, mergeability: "conflicting" });
    // Shown verbatim on a change's page as well as written into a composer, so
    // it opens as a sentence does.
    expect(behind?.ask).toContain("Change #4");
    expect(behind?.ask).toContain("Merge main into it");
    // A merge still being worked out is the one refusal with nothing to ask
    // for: waiting is the correct move.
    expect(pullRequestBlocked({ number: 4, mergeability: "checking" })?.ask).toBeUndefined();
  });
});

/** One comparison HQ answered for the `app` repository: `commits` listed, `total` counted. */
function compared(
  commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>,
  total = commits.length,
) {
  return {
    repository: "app",
    services: ["app"],
    commits: commits.map((commit) => ({
      ...commit,
      authorName: "Ada",
      at: "2026-10-02T10:00:00.000Z",
      change: null,
    })),
    total,
    truncated: total > commits.length,
  };
}

describe("releaseContentsCommits", () => {
  it("lists each change once, in order, however many services take it", () => {
    const a = { sha: "a", subject: "Add a search box" };
    const b = { sha: "b", subject: "Fix the footer" };
    expect(releaseContentsCommits([{ commits: [a] }, { commits: [a, b] }])).toEqual([a, b]);
  });
});

describe("releaseContentsSummary", () => {
  const commit = (sha: string, subject: string) => ({ sha, subject });

  it("says what is going live in the words the person asked for it in", () => {
    const summary = releaseContentsSummary([
      compared([commit("a", "Add a search box above the list"), commit("b", "Rename the app")]),
    ]);
    expect(summary.subjects).toEqual(["Add a search box above the list", "Rename the app"]);
    expect(summary.more).toBe(0);
    expect(summary.total).toBe(2);
  });

  it("counts one change once, however many services take it", () => {
    const summary = releaseContentsSummary([
      compared([commit("a", "Add a search box")]),
      compared([commit("a", "Add a search box"), commit("b", "Fix the footer")]),
    ]);
    expect(summary.subjects).toEqual(["Add a search box", "Fix the footer"]);
    expect(summary.total).toBe(2);
  });

  it("lists as many as a hover has room for and counts the rest", () => {
    const summary = releaseContentsSummary(
      [compared([1, 2, 3, 4, 5, 6].map((n) => commit(`s${n}`, `Change ${n}`)))],
      4,
    );
    expect(summary.subjects).toHaveLength(4);
    expect(summary.more).toBe(2);
    expect(summary.total).toBe(6);
  });

  it("counts what HQ listed only in part by HQ's own count", () => {
    const summary = releaseContentsSummary(
      [compared([commit("a", "Add a search box"), commit("b", "Fix the footer")], 347)],
      4,
    );
    expect(summary).toEqual({
      subjects: ["Add a search box", "Fix the footer"],
      more: 345,
      total: 347,
      atLeast: false,
    });
  });

  it("says at least as many where HQ stopped counting", () => {
    const summary = releaseContentsSummary([
      compared([commit("a", "Add a search box")], COMPARE_COUNT_MAX),
    ]);
    expect(summary.atLeast).toBe(true);
    expect(summary.total).toBe(COMPARE_COUNT_MAX);
  });

  it("drops a commit whose message is only whitespace rather than showing a blank line", () => {
    const summary = releaseContentsSummary([
      compared([commit("a", "   "), commit("b", "Fix the footer")]),
    ]);
    expect(summary.subjects).toEqual(["Fix the footer"]);
  });

  it("says nothing about a release that carries nothing", () => {
    expect(releaseContentsSummary([])).toEqual({
      subjects: [],
      more: 0,
      total: 0,
      atLeast: false,
    });
    expect(releaseContentsSummary([compared([])]).total).toBe(0);
  });
});

describe("releaseContentsSentence", () => {
  it("says the count and the tasks in one line, for the places a hover cannot reach", () => {
    const summary = releaseContentsSummary([
      compared([
        { sha: "a", subject: "Add a search box" },
        { sha: "b", subject: "Fix the footer" },
      ]),
    ]);
    expect(releaseContentsSentence(summary)).toBe(
      "puts 2 changes live — Add a search box; Fix the footer",
    );
  });

  it("counts one change as one", () => {
    const summary = releaseContentsSummary([compared([{ sha: "a", subject: "Fix the footer" }])]);
    expect(releaseContentsSentence(summary)).toBe("puts 1 change live — Fix the footer");
  });

  it("still says how many where every message was blank", () => {
    const summary = releaseContentsSummary([compared([{ sha: "a", subject: "  " }])]);
    expect(releaseContentsSentence(summary)).toBe("puts 1 change live");
  });

  it("says at least as many where HQ stopped counting", () => {
    const summary = releaseContentsSummary([
      compared([{ sha: "a", subject: "Fix the footer" }], COMPARE_COUNT_MAX),
    ]);
    expect(releaseContentsSentence(summary)).toBe("puts 10000+ changes live — Fix the footer");
  });

  it("says nothing about a release that carries nothing", () => {
    expect(releaseContentsSentence(releaseContentsSummary([]))).toBeUndefined();
  });
});

describe("releaseWaitingLabel", () => {
  it("is short enough for a 256px row and still names what is waiting", () => {
    expect(releaseWaitingLabel(releaseContentsSummary([compared([])]))).toBeUndefined();
    expect(
      releaseWaitingLabel(releaseContentsSummary([compared([{ sha: "a", subject: "One" }])])),
    ).toBe("1 waiting");
    expect(
      releaseWaitingLabel(
        releaseContentsSummary([
          compared([
            { sha: "a", subject: "One" },
            { sha: "b", subject: "Two" },
          ]),
        ]),
      ),
    ).toBe("2 waiting");
  });

  it("says at least as many where HQ stopped counting", () => {
    expect(
      releaseWaitingLabel(
        releaseContentsSummary([compared([{ sha: "a", subject: "One" }], COMPARE_COUNT_MAX)]),
      ),
    ).toBe("10000+ waiting");
  });
});

describe("pullRequestMergeLine", () => {
  const base = { number: 4, baseBranch: "main" } as const;

  it.each([
    [{ mergeability: "mergeable" }, "Cleanly, into main"],
    [{ mergeability: "checking" }, "Still checking whether it can"],
    [{ mergeability: "conflicting" }, "Not until it is rebased on main"],
    [{ mergeability: "empty" }, "Nothing to merge into main"],
  ] as const)("answers merging in its own words", (pull, expected) => {
    expect(pullRequestMergeLine({ ...base, ...pull })).toBe(expected);
  });

  it("names the branch it would land on, so the row is not abstract", () => {
    expect(
      pullRequestMergeLine({ ...base, baseBranch: "trunk", mergeability: "mergeable" }),
    ).toContain("trunk");
  });
});

describe("changeState", () => {
  it("answers every row in one register, opening as a sentence does", () => {
    const words = [
      changeState({ number: 1, mergeability: "mergeable" }),
      changeState({ number: 2, mergeability: "conflicting" }),
      changeState({ number: 3, mergeability: "checking" }),
      changeState({ number: 4, mergeability: "empty" }),
    ].map((state) => state?.word);
    expect(words).toEqual([
      "Ready to merge",
      "Conflicts with main",
      "Checking",
      "Nothing to merge",
    ]);
    for (const word of words) expect(word?.charAt(0)).toBe(word?.charAt(0).toLocaleUpperCase());
  });

  // A draft is not ready to merge: its Mate has not described it as it is. What stops it from
  // landing still speaks first.
  it.each([
    ["a draft nothing else stops", { mergeability: "mergeable", ready: false }, "Draft"],
    [
      "a draft that conflicts",
      { mergeability: "conflicting", ready: false },
      "Conflicts with main",
    ],
    ["a described change", { mergeability: "mergeable", ready: true }, "Ready to merge"],
    ["a change from an HQ that knows no drafts", { mergeability: "mergeable" }, "Ready to merge"],
  ] as const)("names %s", (_case, pull, word) => {
    expect(changeState({ number: 1, ...pull })?.word).toBe(word);
  });

  it("carries the tone that means the word", () => {
    expect(changeState({ number: 4, mergeability: "conflicting" })?.tone).toBe("attention");
    expect(changeState({ number: 4, mergeability: "checking" })?.tone).toBe("busy");
  });

  it("names a change nothing stops rather than leaving the column blank: grey, not green", () => {
    expect(changeState({ number: 1, mergeability: "mergeable" })).toEqual({
      word: "Ready to merge",
      tone: "off",
    });
  });
});

describe("changeLandedEvents", () => {
  const landed = (over: Partial<FlowPullRequest>): FlowPullRequest =>
    ({
      repository: "appdev",
      number: 1,
      title: "Add the page",
      kind: "code",
      mateProjectId: "mate-1",
      url: undefined,
      mergeability: "conflicting",
      merged: true,
      mergedAt: "2026-09-20T10:03:00Z",
      headSha: undefined,
      baseBranch: "main",
      line: "appdev #1",
      updatedAt: undefined,
      ...over,
    }) as FlowPullRequest;

  it("places one event per landed change of this Mate, oldest first", () => {
    const events = changeLandedEvents(
      [
        landed({ number: 2, line: "appdev #2", mergedAt: "2026-09-20T11:00:00Z" }),
        landed({ number: 1, line: "appdev #1", mergedAt: "2026-09-20T10:00:00Z" }),
      ],
      "mate-1",
    );
    expect(events.map((event) => event.line)).toEqual(["appdev #1", "appdev #2"]);
    expect(events[0]?.key).toBe("change-landed:appdev#1");
    expect(events[0]?.landedAt).toBe("2026-09-20T10:00:00Z");
  });

  it("takes nothing that is another Mate's, still open, or has no moment to place", () => {
    expect(changeLandedEvents([landed({ mateProjectId: "mate-2" })], "mate-1")).toEqual([]);
    expect(changeLandedEvents([landed({ merged: false })], "mate-1")).toEqual([]);
    expect(changeLandedEvents([landed({ mergedAt: undefined })], "mate-1")).toEqual([]);
    // A conversation with no Mate of its own claims nothing.
    expect(changeLandedEvents([landed({})], undefined)).toEqual([]);
  });
});

describe("agentTurnNotes", () => {
  const event = (number: number, landedAt: string): ChangeLandedEvent => ({
    key: `change-landed:appdev#${String(number)}`,
    repository: "appdev",
    number,
    title: "Add the Harbor page",
    line: `appdev #${String(number)}`,
    landedAt,
  });

  it("says only what landed after the agent last spoke", () => {
    const notes = agentTurnNotes(
      [event(1, "2026-09-20T10:00:00Z"), event(2, "2026-09-20T12:00:00Z")],
      "2026-09-20T11:00:00Z",
    );
    expect(notes).toEqual(["appdev #2 landed: Add the Harbor page"]);
  });

  it("says nothing when the agent's last turn is unknown, rather than repeating itself", () => {
    // Without a moment to compare against, every landing looks new — and a
    // Mate told the same thing every turn is worse than one told late.
    expect(agentTurnNotes([event(1, "2026-09-20T10:00:00Z")], undefined)).toEqual([]);
  });

  it("says nothing when nothing landed since", () => {
    expect(agentTurnNotes([event(1, "2026-09-20T10:00:00Z")], "2026-09-20T11:00:00Z")).toEqual([]);
  });

  it("keeps the newest few, so a quiet Mate is not handed a feed", () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      event(index + 1, `2026-09-20T1${String(index)}:00:00Z`),
    );
    const notes = agentTurnNotes(many, "2026-09-20T09:00:00Z");
    expect(notes).toHaveLength(5);
    expect(notes[4]).toContain("#9");
  });
});

describe("agentNotesFor", () => {
  const notes = ["appdev #3 landed: Add the Harbor page"];

  it.each([
    { name: "a message carries the notes", text: "and the footer?", expected: notes },
    // An older Mate would put them in front of the command, and they would
    // be told again with the next message.
    { name: "a slash command carries none", text: "/compact", expected: [] },
    {
      name: "a message opening with a path carries them",
      text: "/var/www is full",
      expected: notes,
    },
  ])("$name", ({ text, expected }) => {
    expect(agentNotesFor(text, notes)).toEqual(expected);
  });
});

describe("agentLastSpokeAt", () => {
  const user = (text: string, createdAt: string) => ({ role: "user", text, createdAt });
  const agent = (createdAt: string) => ({ role: "assistant", text: "…", createdAt });

  it.each([
    { name: "nothing before the agent spoke", messages: [user("hi", "T1")], expected: undefined },
    {
      name: "the agent's last reply",
      messages: [user("hi", "T1"), agent("T2"), user("and?", "T3"), agent("T4")],
      expected: "T4",
    },
    {
      // A command's turn carries no notes, so its reply is not the agent
      // hearing them: what landed before it is still news.
      name: "the reply before a slash command's answer",
      messages: [user("hi", "T1"), agent("T2"), user("/context", "T3"), agent("T4")],
      expected: "T2",
    },
    {
      // No reply heard notes yet: its first reply still bounds them, so what
      // lands after it is told with the next message.
      name: "the first reply when only commands were answered",
      messages: [user("/mcp", "T1"), agent("T2"), user("/context", "T3"), agent("T4")],
      expected: "T2",
    },
    {
      name: "a reply to a message opening with a path",
      messages: [user("/var/www/app.ts is broken", "T1"), agent("T2")],
      expected: "T2",
    },
  ])("is $name", ({ messages, expected }) => {
    expect(agentLastSpokeAt(messages)).toBe(expected);
  });

  it("tells a landing after a conversation that opened with a command", () => {
    const messages = [user("/mcp", "2026-09-20T10:00:00Z"), agent("2026-09-20T10:00:05Z")];
    const landed: ChangeLandedEvent = {
      key: "change-landed:appdev#3",
      repository: "appdev",
      number: 3,
      title: "Add the Harbor page",
      line: "appdev #3",
      landedAt: "2026-09-20T10:05:00Z",
    };
    const notes = agentTurnNotes([landed], agentLastSpokeAt(messages));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("#3");
  });
});

describe("a Mate's proposal of the group's recipe", () => {
  it.each([
    {
      case: "zcp's proposal, on the group repo",
      repository: "group",
      title: "Mate: the group's import files",
      proposal: true,
    },
    {
      case: "another change to the recipe",
      repository: "group",
      title: "Add a stage tier",
      proposal: false,
    },
    {
      case: "its title, on a code repository",
      repository: "appdev",
      title: "Mate: the group's import files",
      proposal: false,
    },
  ])("tells $case", ({ repository, title, proposal }) => {
    const kind = repository === "group" ? "recipe" : "code";
    expect(isRecipeProposal(row({ repository, kind, number: 11, title }))).toBe(proposal);
  });
});

// e2e 2026-10-03 (t8 A22): B's change, merged with production on v0.1.0, said "it's on main": HQ
// had not compared main again, and the release listed nothing yet.
describe("waitingForProduction: how many changes wait for production once one merged", () => {
  const MERGE = "a".repeat(40);
  const EARLIER = "b".repeat(40);
  const merged = (mergedAt: string, mergeCommitSha: string | undefined = MERGE) => ({
    merged: true,
    mergedAt,
    mergeCommitSha,
  });
  it.each([
    {
      name: "the change just merged, before HQ lists it",
      listed: [],
      change: merged("2026-10-03T09:26:00Z"),
      liveSince: "2026-10-03T07:40:00Z",
      count: 1,
    },
    {
      name: "the change beside the ones listed before it",
      listed: [{ sha: EARLIER }],
      change: merged("2026-10-03T09:26:00Z"),
      liveSince: "2026-10-03T07:40:00Z",
      count: 2,
    },
    {
      name: "the change once HQ lists it: counted once",
      listed: [{ sha: MERGE }, { sha: EARLIER }],
      change: merged("2026-10-03T09:26:00Z"),
      liveSince: "2026-10-03T07:40:00Z",
      count: 2,
    },
    {
      name: "the change with no release production runs",
      listed: [],
      change: merged("2026-10-03T04:52:00Z"),
      liveSince: undefined,
      count: 1,
    },
    {
      name: "a change merged before the release production runs: there already",
      listed: [],
      change: merged("2026-10-03T07:00:00Z"),
      liveSince: "2026-10-03T07:40:00Z",
      count: 0,
    },
    {
      name: "a change not merged: what the release lists",
      listed: [{ sha: EARLIER }],
      change: { merged: false, mergedAt: undefined, mergeCommitSha: undefined },
      liveSince: "2026-10-03T07:40:00Z",
      count: 1,
    },
  ])("$name", ({ listed, change, liveSince, count }) => {
    expect(waitingForProduction({ listed, change, liveSince })).toBe(count);
  });
});

// D7: a change asks for review once its Mate described it at its head, and never while its Mate
// works in any of its chats. Every list a change stands in reads this one rule.
describe("changeShowsReview — one rule for every list a change stands in", () => {
  it.each([
    { case: "a draft, its Mate at rest", ready: false, mate: undefined, shows: false },
    { case: "a described change, its Mate at rest", ready: true, mate: undefined, shows: true },
    {
      case: "a described change, its Mate idle",
      ready: true,
      mate: { working: false },
      shows: true,
    },
    {
      case: "a described change, its Mate at work",
      ready: true,
      mate: { working: true },
      shows: false,
    },
    { case: "a draft, its Mate at work", ready: false, mate: { working: true }, shows: false },
  ])("$case: $shows", ({ ready, mate, shows }) => {
    expect(changeShowsReview({ ready }, mate)).toBe(shows);
  });
});

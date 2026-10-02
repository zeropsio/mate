import { describe, expect, it } from "vite-plus/test";

import { pullRequestBlocked, pullRequestBlockedReason } from "./gitTab.ts";
import { mateBotLogin, mateProjectOfBranch, mateProjectOfLogin } from "./mateIdentity.ts";

import type { MergeabilityKind } from "./forge/mergeState.ts";
import type { GiteaPullRequest } from "./giteaClient.ts";
import {
  changeAuthorName,
  changeState,
  pullRequestMergeLine,
  releaseContentsSentence,
  releaseContentsCommits,
  releaseContentsSummary,
  releaseWaitingLabel,
  flowPullRequest,
  flowVerbKey,
  flowVerbLabel,
  isRecipeProposal,
  pullRequestLineWith,
  pullRequestsByMate,
  pullRequestsFolded,
  sidebarChangeLabel,
  type FlowPullRequest,
  changeLandedEvents,
  agentTurnNotes,
  type ChangeLandedEvent,
} from "./projectFlow.ts";

const VERA = "tsXR3xnURPSvsy4zp1EaYA";
const FEN = "9lSt5lFxQ1mQ3v8b7c2d1e";

function pull(overrides: Partial<GiteaPullRequest> = {}): GiteaPullRequest {
  return {
    number: 4,
    title: "Add a due date to each todo",
    state: "open",
    html_url: "https://gitea.example/todo/appdev/pulls/4",
    mergeable: true,
    head: { ref: `mate/mate-${VERA}`, sha: "abc" },
    base: { ref: "main" },
    user: { login: `mate-${VERA}` },
    updated_at: "2026-09-17T18:00:00Z",
    ...overrides,
  };
}

describe("whose pull request it is", () => {
  it("names the bot after the project, the way the broker does", () => {
    expect(mateBotLogin(VERA)).toBe(`mate-${VERA}`);
  });

  it.each([
    { name: "zcp's branch", ref: `mate/mate-${VERA}`, expected: VERA },
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

describe("one pull request in the flow", () => {
  it("belongs to the Mate whose branch it is", () => {
    const row = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull(),
    });
    expect(row).toMatchObject({
      repository: "appdev",
      number: 4,
      kind: "code",
      mateProjectId: VERA,
      mergeability: "mergeable",
      baseBranch: "main",
      line: "appdev #4",
    });
  });

  it("carries what a review reads: the branch, its size and its base", () => {
    const row = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull({
        head: { ref: `mate/mate-${VERA}`, sha: "head-sha" },
        base: { ref: "main", sha: "main-sha" },
        additions: 42,
        deletions: 3,
        changed_files: 3,
        merge_base: "mb-sha",
      }),
    });
    expect(row).toMatchObject({
      headBranch: `mate/mate-${VERA}`,
      additions: 42,
      deletions: 3,
      changedFiles: 3,
      mergeBase: "mb-sha",
      baseSha: "main-sha",
    });
  });

  it.each([
    [
      "its description as it was written",
      { body: "Adds a /status page.\n\n![The page](x)" },
      "Adds a /status page.\n\n![The page](x)",
    ],
    ["no description where the body is empty", { body: "" }, undefined],
    ["no description where the body is only blank lines", { body: "\n  \n" }, undefined],
    ["no description where Gitea sent none", {}, undefined],
  ] as const)("carries %s", (_case, over, description) => {
    const row = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull(over),
    });
    expect(row.description).toBe(description);
  });

  it.each([
    ["how many comments it has, which a review holds the room of", { comments: 3 }, 3],
    ["none said", { comments: 0 }, 0],
    ["no count where Gitea sent none", {}, undefined],
  ] as const)("carries %s", (_case, over, count) => {
    const row = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull(over),
    });
    expect(row.commentCount).toBe(count);
  });

  it("carries the commit it landed as, which a release names it by", () => {
    const row = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull({ state: "closed", merged: true, merge_commit_sha: "abc123" }),
    });
    expect(row.mergeCommitSha).toBe("abc123");
  });

  it.each(["open", "closed"] as const)("carries whether it is %s", (state) => {
    const row = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull({ state }),
    });
    expect(row.state).toBe(state);
  });

  it("leaves a review's reads unknown where Gitea did not send them, never zero", () => {
    const row = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull(),
    });
    expect(row.additions).toBeUndefined();
    expect(row.changedFiles).toBeUndefined();
  });

  it("belongs to the Mate whose bot opened it when a person renamed the branch", () => {
    const row = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull({ head: { ref: "due-dates", sha: "abc" } }),
    });
    expect(row.mateProjectId).toBe(VERA);
  });

  it("belongs to nobody's Mate when a person opened it from their own branch", () => {
    const row = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull({ head: { ref: "feature/x", sha: "abc" }, user: { login: "ada" } }),
    });
    expect(row.mateProjectId).toBeUndefined();
    expect(row.line).toBe("appdev #4 · ada");
  });

  it("is a recipe change on the group repo, whoever opened it", () => {
    const row = flowPullRequest({
      mergeability: "mergeable",
      repository: "group",
      pull: pull(),
    });
    expect(row.kind).toBe("recipe");
    // The row wears the "recipe" tag; the line does not say it twice.
    expect(row.line).toBe("#4");
  });

  it("names the Mate on a row that does not sit under it, and a person once", () => {
    const vera = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull(),
    });
    expect(pullRequestLineWith(vera, "Vera")).toBe("appdev #4 · Vera");
    expect(pullRequestLineWith(vera, undefined)).toBe("appdev #4");
    const ada = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull({ head: { ref: "feature/x", sha: "abc" }, user: { login: "ada" } }),
    });
    expect(pullRequestLineWith(ada, "Vera")).toBe("appdev #4 · ada");
  });

  it("carries the mergeability its reads came to, never one answer of Gitea's", () => {
    for (const mergeability of ["checking", "mergeable", "conflicting"] as const) {
      for (const mergeable of [true, false, undefined]) {
        expect(
          flowPullRequest({
            repository: "appdev",
            pull: pull({ mergeable }),
            mergeability,
          }).mergeability,
        ).toBe(mergeability);
      }
    }
  });

  it("reads as its number and title in a menu row, a person's own naming them", () => {
    const mine = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull(),
    });
    expect(mine.mateProjectId).toBe(VERA);
    // Stripped to its number under its Mate the change lost its name, which
    // cost more than echoing the task above it did. The fork carries the
    // distinction instead.
    expect(sidebarChangeLabel(mine)).toBe("#4 Add a due date to each todo");
    const ada = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull({ head: { ref: "feature/x", sha: "abc" }, user: { login: "ada" } }),
    });
    expect(ada.mateProjectId).toBeUndefined();
    expect(sidebarChangeLabel(ada)).toBe("#4 Add a due date to each todo · ada");
  });
});

describe("sidebarChangeLabel: a Mate's changes in two repositories name their repository", () => {
  const change = (repository: string, number: number, title: string, login: string) =>
    flowPullRequest({
      mergeability: "mergeable",
      repository,
      pull: pull({
        number,
        title,
        head: {
          ref: login.startsWith("mate-") ? login.replace("mate-", "mate/mate-") : "fix",
          sha: "abc",
        },
        user: { login },
      }),
    });
  const appdev = change("appdev", 1, "Build the storefront", `mate-${VERA}`);
  const apidev = change("apidev", 1, "Rebuild the API", `mate-${VERA}`);
  const fenApi = change("apidev", 2, "Add a health route", `mate-${FEN}`);
  const adaApp = change("appdev", 7, "Fix a typo", "ada");
  const adaApi = change("apidev", 8, "Tune the pool", "ada");

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
    [
      "a person's change in one repository",
      adaApp,
      [adaApp, appdev, apidev],
      "#7 Fix a typo · ada",
    ],
    [
      "a person's changes in two repositories",
      adaApi,
      [adaApp, adaApi],
      "apidev #8 Tune the pool · ada",
    ],
  ] as const)("%s", (_case, row, among, label) => {
    expect(sidebarChangeLabel(row, among)).toBe(label);
  });
});

describe("the pull requests of each Mate", () => {
  const vera = flowPullRequest({
    mergeability: "mergeable",
    repository: "appdev",
    pull: pull(),
  });
  const veraRecipe = flowPullRequest({
    mergeability: "mergeable",
    repository: "group",
    pull: pull({ number: 6, title: "Mate: the group's import files" }),
  });
  const fen = flowPullRequest({
    mergeability: "mergeable",
    repository: "appdev",
    pull: pull({
      number: 5,
      head: { ref: `mate/mate-${FEN}`, sha: "def" },
      user: { login: `mate-${FEN}` },
      updated_at: "2026-09-17T19:00:00Z",
    }),
  });
  const ada = flowPullRequest({
    mergeability: "mergeable",
    repository: "appdev",
    pull: pull({ number: 7, head: { ref: "feature/x", sha: "fff" }, user: { login: "ada" } }),
  });

  it("puts each Mate's under it, newest first, and the rest after the Mates", () => {
    const older = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull({ number: 3, updated_at: "2026-09-17T12:00:00Z" }),
    });
    const grouped = pullRequestsByMate([older, ada, fen, vera, veraRecipe], [VERA, FEN]);
    // #4 and #6 moved at the same moment; the higher number is the newer one.
    expect(grouped.byMate.get(VERA)?.map((entry) => entry.number)).toEqual([6, 4, 3]);
    expect(grouped.byMate.get(FEN)?.map((entry) => entry.number)).toEqual([5]);
    expect(grouped.others.map((entry) => entry.number)).toEqual([7]);
  });

  it("lists a pull request of a Mate the caller does not know among the rest", () => {
    const grouped = pullRequestsByMate([vera], [FEN]);
    expect(grouped.byMate.get(FEN)).toEqual([]);
    expect(grouped.others.map((entry) => entry.number)).toEqual([4]);
  });

  it("folds a Mate's pull requests only once there are more than three", () => {
    expect(pullRequestsFolded(0)).toBe(false);
    expect(pullRequestsFolded(3)).toBe(false);
    expect(pullRequestsFolded(4)).toBe(true);
  });
});

describe("a verb in flight", () => {
  it("keys each verb by its target, so one row's Merge is nobody else's", () => {
    const merge4 = flowVerbKey({ kind: "merge", slug: "todo", repository: "appdev", number: 4 });
    expect(merge4).toBe(
      flowVerbKey({ kind: "merge", slug: "todo", repository: "appdev", number: 4 }),
    );
    expect(merge4).not.toBe(
      flowVerbKey({ kind: "merge", slug: "todo", repository: "appdev", number: 3 }),
    );
    expect(flowVerbKey({ kind: "release", groupId: "g1" })).not.toBe(
      flowVerbKey({ kind: "roll-back", groupId: "g1", tag: "v0.1.0" }),
    );
  });

  it.each([
    ["merge", "Merge", "Merging…"],
    ["open", "Open pull request", "Opening…"],
    ["release", "Release", "Releasing…"],
    ["roll-back", "Roll back to this", "Rolling back…"],
  ] as const)("says what %s does, then that it is doing it", (kind, idle, running) => {
    expect(flowVerbLabel(kind, false)).toBe(idle);
    expect(flowVerbLabel(kind, true)).toBe(running);
  });
});

describe("types", () => {
  it("carries what every surface needs and nothing a surface decides", () => {
    const row: FlowPullRequest = flowPullRequest({
      mergeability: "mergeable",
      repository: "appdev",
      pull: pull(),
    });
    expect(Object.keys(row).sort()).toEqual(
      [
        "additions",
        "author",
        "baseBranch",
        "baseSha",
        "changedFiles",
        "commentCount",
        "deletions",
        "description",
        "headBranch",
        "headSha",
        "kind",
        "line",
        "mateProjectId",
        "mergeBase",
        "mergeCommitSha",
        "mergeability",
        "merged",
        "mergedAt",
        "number",
        "repository",
        "state",
        "title",
        "updatedAt",
        "url",
      ].sort(),
    );
  });
});

describe("pullRequestBlockedReason", () => {
  const cases: ReadonlyArray<[MergeabilityKind, string | null]> = [
    // Gitea says it merges: the verb is the whole answer.
    ["mergeable", null],
    // It does not, and the row says why rather than dropping its verb silently.
    ["conflicting", "needs a rebase"],
    // Gitea is still working it out after a push: nobody is asked to rebase.
    ["checking", "checking"],
  ];

  for (const [mergeability, expected] of cases) {
    it(`${mergeability}: ${expected ?? "nothing to add"}`, () => {
      expect(pullRequestBlockedReason({ number: 4, mergeability })).toBe(expected);
    });
  }

  it("tones each reason to itself", () => {
    expect(pullRequestBlocked({ number: 4, mergeability: "conflicting" })).toMatchObject({
      kind: "behind",
      word: "needs a rebase",
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
    expect(behind?.ask).toContain("Pull request #4");
    expect(behind?.ask).toContain("Rebase");
    // A merge still being worked out is the one refusal with nothing to ask
    // for: waiting is the correct move.
    expect(pullRequestBlocked({ number: 4, mergeability: "checking" })?.ask).toBeUndefined();
  });
});

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
      { commits: [commit("a", "Add a search box above the list"), commit("b", "Rename the app")] },
    ]);
    expect(summary.subjects).toEqual(["Add a search box above the list", "Rename the app"]);
    expect(summary.more).toBe(0);
    expect(summary.total).toBe(2);
  });

  it("counts one change once, however many services take it", () => {
    const summary = releaseContentsSummary([
      { commits: [commit("a", "Add a search box")] },
      { commits: [commit("a", "Add a search box"), commit("b", "Fix the footer")] },
    ]);
    expect(summary.subjects).toEqual(["Add a search box", "Fix the footer"]);
    expect(summary.total).toBe(2);
  });

  it("lists as many as a hover has room for and counts the rest", () => {
    const summary = releaseContentsSummary(
      [{ commits: [1, 2, 3, 4, 5, 6].map((n) => commit(`s${n}`, `Change ${n}`)) }],
      4,
    );
    expect(summary.subjects).toHaveLength(4);
    expect(summary.more).toBe(2);
    expect(summary.total).toBe(6);
  });

  it("drops a commit whose message is only whitespace rather than showing a blank line", () => {
    const summary = releaseContentsSummary([
      { commits: [commit("a", "   "), commit("b", "Fix the footer")] },
    ]);
    expect(summary.subjects).toEqual(["Fix the footer"]);
  });

  it("says nothing about a release that carries nothing", () => {
    expect(releaseContentsSummary([])).toEqual({ subjects: [], more: 0, total: 0 });
    expect(releaseContentsSummary([{ commits: [] }]).total).toBe(0);
  });
});

describe("releaseContentsSentence", () => {
  it("says the count and the tasks in one line, for the places a hover cannot reach", () => {
    const summary = releaseContentsSummary([
      {
        commits: [
          { sha: "a", subject: "Add a search box" },
          { sha: "b", subject: "Fix the footer" },
        ],
      },
    ]);
    expect(releaseContentsSentence(summary)).toBe(
      "puts 2 changes live — Add a search box; Fix the footer",
    );
  });

  it("counts one change as one", () => {
    const summary = releaseContentsSummary([
      { commits: [{ sha: "a", subject: "Fix the footer" }] },
    ]);
    expect(releaseContentsSentence(summary)).toBe("puts 1 change live — Fix the footer");
  });

  it("still says how many where every message was blank", () => {
    const summary = releaseContentsSummary([{ commits: [{ sha: "a", subject: "  " }] }]);
    expect(releaseContentsSentence(summary)).toBe("puts 1 change live");
  });

  it("says nothing about a release that carries nothing", () => {
    expect(releaseContentsSentence(releaseContentsSummary([]))).toBeUndefined();
  });
});

describe("releaseWaitingLabel", () => {
  it("is short enough for a 256px row and still names what is waiting", () => {
    expect(releaseWaitingLabel(releaseContentsSummary([{ commits: [] }]))).toBeUndefined();
    expect(
      releaseWaitingLabel(releaseContentsSummary([{ commits: [{ sha: "a", subject: "One" }] }])),
    ).toBe("1 waiting");
    expect(
      releaseWaitingLabel(
        releaseContentsSummary([
          {
            commits: [
              { sha: "a", subject: "One" },
              { sha: "b", subject: "Two" },
            ],
          },
        ]),
      ),
    ).toBe("2 waiting");
  });
});

describe("pullRequestMergeLine", () => {
  const base = { number: 4, baseBranch: "main" } as const;

  it.each([
    [{ mergeability: "mergeable" }, "Cleanly, into main"],
    [{ mergeability: "checking" }, "Still checking whether it can"],
    [{ mergeability: "conflicting" }, "Not until it is rebased on main"],
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
    ].map((state) => state?.word);
    expect(words).toEqual(["Ready to merge", "Needs a rebase", "Checking"]);
    for (const word of words) expect(word?.charAt(0)).toBe(word?.charAt(0).toLocaleUpperCase());
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

describe("changeAuthorName", () => {
  it("names the Mate, never the bot login a page has no business showing", () => {
    const pull = { author: "mate-0bPLTRRSSTuV54WMpcLoww", mateProjectId: "0bPLTRRSSTuV54WMpcLoww" };
    expect(changeAuthorName(pull, "Theo")).toBe("Theo");
  });

  it("says nothing rather than the bot login where the Mate cannot be named", () => {
    const pull = { author: "mate-abc", mateProjectId: "abc" };
    expect(changeAuthorName(pull, undefined)).toBeUndefined();
  });

  it("names a person by their login, which is their name here", () => {
    expect(changeAuthorName({ author: "ales", mateProjectId: undefined }, undefined)).toBe("ales");
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
      author: "otto",
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
    // A person's own branch belongs to no conversation.
    expect(changeLandedEvents([landed({ mateProjectId: undefined })], "mate-1")).toEqual([]);
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
    const change = flowPullRequest({
      mergeability: "mergeable",
      repository,
      pull: pull({ number: 11, title }),
    });
    expect(isRecipeProposal(change)).toBe(proposal);
  });
});

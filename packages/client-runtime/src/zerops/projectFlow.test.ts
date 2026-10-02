import type { HqChange } from "@t3tools/shared/hqChanges";
import { describe, expect, it } from "vite-plus/test";

import { pullRequestBlocked, pullRequestBlockedReason } from "./gitTab.ts";
import { mateBotLogin, mateProjectOfBranch, mateProjectOfLogin } from "./mateIdentity.ts";

import type { MergeabilityKind } from "./changeMergeability.ts";
import {
  changeState,
  pullRequestMergeLine,
  releaseContentsSentence,
  releaseContentsCommits,
  releaseContentsSummary,
  releaseWaitingLabel,
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
    ...over,
  });
  const flow = (changes: ReadonlyArray<HqChange>) => flowChanges({ changes, hqAddress: `${HQ}/` });

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
      },
    ]);
  });

  it.each([
    ["clean", "mergeable"],
    ["conflict", "conflicting"],
    ["empty", "empty"],
    ["unknown", "checking"],
  ] as const)("names how it merges as HQ last judged it: %s", (said, word) => {
    expect(flow([change({ mergeability: said })]).pullRequests[0]?.mergeability).toBe(word);
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

describe("naming a change", () => {
  it("names the Mate on a row that does not sit under it", () => {
    expect(pullRequestLineWith(row(), "Vera")).toBe("appdev #4 · Vera");
    expect(pullRequestLineWith(row(), undefined)).toBe("appdev #4");
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
    expect(grouped.get(VERA)?.map((entry) => entry.number)).toEqual([6, 4, 3]);
    expect(grouped.get(FEN)?.map((entry) => entry.number)).toEqual([5]);
  });

  // Only Mates open changes (SPEC §5.4): one whose Mate the caller does not list has no row.
  it("lists nothing of a Mate the caller does not know", () => {
    const grouped = pullRequestsByMate([vera], [FEN]);
    expect(grouped.get(FEN)).toEqual([]);
    expect(grouped.has(VERA)).toBe(false);
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

  it.each([
    ["merge", "Merge", "Merging…"],
    ["release", "Release", "Releasing…"],
    ["roll-back", "Roll back to this", "Rolling back…"],
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
    ["conflicting", "needs a rebase"],
    // Gitea is still working it out after a push: nobody is asked to rebase.
    ["checking", "checking"],
    // Nothing in it main does not have: nobody is asked anything either.
    ["empty", "nothing to merge"],
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
    expect(words).toEqual(["Ready to merge", "Needs a rebase", "Checking", "Nothing to merge"]);
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

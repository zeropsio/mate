import { describe, expect, it } from "vite-plus/test";

import { mateNextStep } from "./mateNextStep.ts";
import type { FlowPullRequest } from "./projectFlow.ts";

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "app",
    number: 1,
    title: "Greet with a fuller line",
    kind: "code",
    mateProjectId: "p-wren",
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    headSha: "abc",
    baseBranch: "main",
    line: "app #1",
    updatedAt: undefined,
    ...over,
  };
}

describe("mateNextStep", () => {
  // The composer's top (C3): what waits on the person, in the Mate's words,
  // and the one door to it — Review. Nothing merges from here.
  it.each<{
    readonly case: string;
    readonly pullRequests: ReadonlyArray<FlowPullRequest> | undefined;
    readonly mate: string | undefined;
    readonly mateName: string | undefined;
    readonly step:
      | { readonly title: string; readonly detail: string; readonly number: number }
      | "none";
  }>([
    {
      case: "its own change, waiting for the person's review",
      pullRequests: [pull()],
      mate: "p-wren",
      mateName: "Wren",
      step: {
        title: "Wren is waiting for your review",
        detail: "Greet with a fuller line",
        number: 1,
      },
    },
    {
      case: "a Mate whose name is not known yet",
      pullRequests: [pull()],
      mate: "p-wren",
      mateName: undefined,
      step: {
        title: "This Mate is waiting for your review",
        detail: "Greet with a fuller line",
        number: 1,
      },
    },
    // A release carries every Mate's merges and production is the project's:
    // both stay on the left, with the project, so the conversation reads only
    // this Mate's open changes.
    {
      case: "nothing waiting (testzcp)",
      pullRequests: [],
      mate: "p-rune",
      mateName: "Rune",
      step: "none",
    },
    {
      case: "another Mate's change",
      pullRequests: [pull()],
      mate: "p-juno",
      mateName: "Juno",
      step: "none",
    },
    // The conversation's header counts it, so the strip lists it too, under its review's words
    // (below).
    {
      case: "its own change that does not merge",
      pullRequests: [pull({ mergeability: "conflicting" })],
      mate: "p-wren",
      mateName: "Wren",
      step: {
        title: "Wren is waiting for your review",
        detail: "Greet with a fuller line",
        number: 1,
      },
    },
    {
      case: "its own change HQ is still checking",
      pullRequests: [pull({ mergeability: "checking" })],
      mate: "p-wren",
      mateName: "Wren",
      step: {
        title: "Wren is waiting for your review",
        detail: "Greet with a fuller line",
        number: 1,
      },
    },
    {
      case: "its own landed change HQ still calls mergeable",
      pullRequests: [pull({ merged: true })],
      mate: "p-wren",
      mateName: "Wren",
      step: "none",
    },
    // A draft asks for nothing: the Mate has not described it at its head yet.
    {
      case: "its own change it has not described yet",
      pullRequests: [pull({ ready: false })],
      mate: "p-wren",
      mateName: "Wren",
      step: "none",
    },
    {
      case: "its own draft beside a described change: only the described one waits",
      pullRequests: [
        pull({ number: 2, ready: false, title: "Tune images" }),
        pull({ number: 1, ready: true }),
      ],
      mate: "p-wren",
      mateName: "Wren",
      step: {
        title: "Wren is waiting for your review",
        detail: "Greet with a fuller line",
        number: 1,
      },
    },
    {
      case: "a recipe change of its own",
      pullRequests: [pull({ repository: "group", kind: "recipe" })],
      mate: "p-wren",
      mateName: "Wren",
      step: "none",
    },
    {
      case: "a project not read yet",
      pullRequests: undefined,
      mate: "p-wren",
      mateName: "Wren",
      step: "none",
    },
    {
      case: "a conversation that is no Mate's",
      pullRequests: [pull()],
      mate: undefined,
      mateName: "Wren",
      step: "none",
    },
  ])("$case", ({ pullRequests, mate, mateName, step }) => {
    const next = mateNextStep({ pullRequests, mateProjectId: mate, mateName });
    expect(
      next.kind === "review"
        ? { title: next.title, detail: next.detail, number: next.pull.number }
        : next.kind,
    ).toEqual(step);
  });

  // D7, the rule every list of changes reads (`changeShowsReview`): while the Mate works, its
  // described change asks for nothing yet.
  it.each([
    { case: "at rest", working: false, kind: "review" },
    { case: "at work", working: true, kind: "none" },
  ])("reads its own described change, its Mate $case: $kind", ({ working, kind }) => {
    expect(
      mateNextStep({ pullRequests: [pull()], mateProjectId: "p-wren", mateName: "Wren", working })
        .kind,
    ).toBe(kind);
  });
});

// The owner's pick on the "Composer Strips" board (S6, 2026-10-12): "A colleague's Mate shows its
// change like yours", the same section over the read-along line, waiting for a review, not yours.
describe("mateNextStep: a colleague's Mate", () => {
  it.each([
    { case: "one change", pulls: [pull()], title: "Rosa is waiting for a review" },
    {
      case: "two changes",
      pulls: [pull(), pull({ repository: "api", number: 2 })],
      title: "Rosa is waiting for a review of 2 changes",
    },
  ])("asks for a review, never the viewer's: $case", ({ pulls, title }) => {
    const step = mateNextStep({
      pullRequests: pulls,
      mateProjectId: "p-wren",
      mateName: "Rosa",
      yours: false,
    });
    expect(step.kind === "review" ? step.title : null).toBe(title);
  });
});

describe("mateNextStep: every change of its own waiting, newest first", () => {
  const at = (hour: number) => `2026-09-30T${String(hour).padStart(2, "0")}:00:00Z`;
  const app1 = pull({ repository: "appdev", number: 1, title: "Build the site", updatedAt: at(9) });
  const api1 = pull({
    repository: "apidev",
    number: 1,
    title: "Rebuild the API",
    updatedAt: at(10),
  });
  const app2 = pull({ repository: "appdev", number: 2, title: "Add a footer", updatedAt: at(11) });
  const app3 = pull({ repository: "appdev", number: 3, title: "Tune images", updatedAt: at(12) });
  const app4 = pull({ repository: "appdev", number: 4, title: "Fix the menu", updatedAt: at(13) });

  it.each([
    ["one: the change itself, no list", [app1], "Wren is waiting for your review", [], 0],
    [
      "two: a count, then each in its own line",
      [app1, api1],
      "Wren is waiting for your review of 2 changes",
      ["apidev #1 Rebuild the API", "appdev #1 Build the site"],
      0,
    ],
    [
      "three: every one",
      [app1, api1, app2],
      "Wren is waiting for your review of 3 changes",
      ["appdev #2 Add a footer", "apidev #1 Rebuild the API", "appdev #1 Build the site"],
      0,
    ],
    [
      "five: the newest three, and how many more",
      [app1, api1, app2, app3, app4],
      "Wren is waiting for your review of 5 changes",
      ["appdev #4 Fix the menu", "appdev #3 Tune images", "appdev #2 Add a footer"],
      2,
    ],
  ] as const)("%s", (_case, pullRequests, title, lines, more) => {
    const next = mateNextStep({ pullRequests, mateProjectId: "p-wren", mateName: "Wren" });
    expect(
      next.kind === "review"
        ? {
            title: next.title,
            lines: next.lines.map((line) => line.label),
            more: next.more,
          }
        : next.kind,
    ).toEqual({ title, lines, more });
  });
});

// Several changes per Mate, one per branch (the owner, D-7, 2026-10-25): a conversation offers all
// of its Mate's waiting changes, the one on the branch its lease is bound to first — never
// another Mate's — and says it in the same words.
describe("mateNextStep: the conversation's own branch first", () => {
  const at = (hour: number) => `2026-10-25T${String(hour).padStart(2, "0")}:00:00Z`;
  const previews = pull({
    repository: "appsdev",
    number: 2,
    title: "Pool previews",
    branch: "pool-previews",
    updatedAt: at(12),
  });
  const stamp = pull({
    repository: "appsdev",
    number: 7,
    title: "Build stamp",
    branch: "build-stamp",
    updatedAt: at(11),
  });
  const badge = pull({
    repository: "appsdev",
    number: 6,
    title: "Test badge",
    branch: "badge",
    updatedAt: at(9),
  });
  const theirs = pull({
    repository: "appsdev",
    number: 8,
    title: "Their badge",
    branch: "badge-2",
    mateProjectId: "p-juno",
    updatedAt: at(13),
  });

  it.each([
    [
      "its bound lease's branch leads, the rest newest first",
      [previews, stamp, badge],
      "badge",
      ["#6 Test badge", "#2 Pool previews", "#7 Build stamp"],
    ],
    [
      "bound to no lease: newest first",
      [previews, stamp, badge],
      undefined,
      ["#2 Pool previews", "#7 Build stamp", "#6 Test badge"],
    ],
    [
      "a branch with no change of its own waiting: newest first",
      [previews, stamp, badge],
      "wip",
      ["#2 Pool previews", "#7 Build stamp", "#6 Test badge"],
    ],
    [
      "its branch's change still a draft asks nothing: newest first",
      [previews, stamp, { ...badge, ready: false }],
      "badge",
      ["#2 Pool previews", "#7 Build stamp"],
    ],
    [
      "another Mate's change on the branch is never offered",
      [previews, { ...theirs, branch: "badge" }],
      "badge",
      [],
    ],
  ] as const)("%s", (_case, pullRequests, boundBranch, lines) => {
    const step = mateNextStep({
      pullRequests,
      mateProjectId: "p-wren",
      mateName: "Wren",
      boundBranch,
    });
    expect(step.kind === "review" ? step.lines.map((line) => line.label) : null).toEqual(
      lines.length === 0 ? [] : lines,
    );
    if (step.kind === "review" && lines.length > 0) {
      expect(step.detail).toBe(lines[0]!.replace(/^#\d+ /u, ""));
      expect(step.title).toBe(`Wren is waiting for your review of ${String(lines.length)} changes`);
    }
  });

  it("a lone change on its branch reads as the one change, in the same words", () => {
    const step = mateNextStep({
      pullRequests: [badge],
      mateProjectId: "p-wren",
      mateName: "Wren",
      boundBranch: "badge",
    });
    expect(step.kind === "review" ? [step.title, step.detail, step.pull.number] : null).toEqual([
      "Wren is waiting for your review",
      "Test badge",
      6,
    ]);
  });
});

// The rehearsal of 2026-10-25: the conversation's header read "Review 2" while the composer listed
// one change — the other conflicted with main and was left out. The strip lists every change of
// its Mate's the header counts, under one count: one that merges with its Review, one that does
// not merge as it stands after the ones that do, under the words its review leads with and with
// the fix that review offers — the Mate's to make, the person's to ask for.
describe("mateNextStep: every change the header counts, one that does not merge under its review's words", () => {
  const at = (hour: number) => `2026-10-25T${String(hour).padStart(2, "0")}:00:00Z`;
  const notes = pull({
    repository: "appdev",
    number: 3,
    title: "Add rehearsal notes",
    branch: "rh-two",
    behind: true,
    updatedAt: at(16),
  });
  const pools = pull({
    repository: "appdev",
    number: 4,
    title: "Add an api part and dev pools",
    branch: "api-info",
    mergeability: "conflicting",
    behind: true,
    updatedAt: at(17),
  });
  const lineOf = (line: { readonly pull: FlowPullRequest; readonly verdict?: unknown }) => ({
    number: line.pull.number,
    verdict: line.verdict,
  });
  const resolve = {
    title: "Behind main",
    fix: {
      label: "Ask Wren to resolve it",
      problem: {
        what: "Change #4 no longer merges cleanly into main",
        ask: "Merge main into it, resolve the conflicts, and deliver it again.",
      },
    },
  };

  it("lists a change that conflicts with main after the one that merges, under one count, with the fix its review offers", () => {
    const step = mateNextStep({
      pullRequests: [notes, pools],
      mateProjectId: "p-wren",
      mateName: "Wren",
    });
    expect(
      step.kind === "review"
        ? {
            title: step.title,
            lead: step.pull.number,
            lines: step.lines.map(lineOf),
            waiting: step.waiting,
          }
        : step.kind,
    ).toEqual({
      title: "Wren is waiting for your review of 2 changes",
      lead: 3,
      lines: [
        { number: 3, verdict: undefined },
        { number: 4, verdict: resolve },
      ],
      waiting: 1,
    });
  });

  it("keeps the conversation's own branch first, even where its change does not merge", () => {
    const step = mateNextStep({
      pullRequests: [notes, pools],
      mateProjectId: "p-wren",
      mateName: "Wren",
      boundBranch: "api-info",
    });
    expect(
      step.kind === "review" ? { lead: step.pull.number, lines: step.lines.map(lineOf) } : null,
    ).toEqual({
      lead: 4,
      lines: [
        { number: 4, verdict: resolve },
        { number: 3, verdict: undefined },
      ],
    });
  });

  it.each([
    {
      case: "a lone change that conflicts: on its line, with the fix",
      over: { mergeability: "conflicting" },
      yours: true,
      verdict: {
        title: "Behind main",
        fix: {
          label: "Ask Wren to resolve it",
          problem: {
            what: "Change #1 no longer merges cleanly into main",
            ask: "Merge main into it, resolve the conflicts, and deliver it again.",
          },
        },
      },
    },
    {
      case: "a colleague's Mate's change that conflicts: its Review, never a fix",
      over: { mergeability: "conflicting" },
      yours: false,
      verdict: { title: "Behind main" },
    },
    {
      case: "one HQ is still checking: its Review, as HQ works it out",
      over: { mergeability: "checking" },
      yours: true,
      verdict: { title: "Checking whether it merges cleanly" },
    },
    {
      case: "one main already holds: its Review, nothing to merge",
      over: { mergeability: "empty" },
      yours: true,
      verdict: { title: "Nothing to merge" },
    },
  ] as const)("$case", ({ over, yours, verdict }) => {
    const step = mateNextStep({
      pullRequests: [pull(over)],
      mateProjectId: "p-wren",
      mateName: "Wren",
      yours,
    });
    expect(
      step.kind === "review"
        ? { lines: step.lines.map(lineOf), more: step.more, waiting: step.waiting }
        : step.kind,
    ).toEqual({ lines: [{ number: 1, verdict }], more: 0, waiting: 0 });
  });
});

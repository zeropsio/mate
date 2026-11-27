import { expect, it } from "vite-plus/test";

import type { ChangeAct } from "./changeAct.ts";
import type { ChangeStanding, ChangeStandingRead } from "./changeStanding.ts";
import { mateNextStep } from "./mateNextStep.ts";
import type { FlowPullRequest } from "./projectFlow.ts";
import { addingLine } from "./reviewVerdict.ts";

const AT = "2026-11-01T08:00:00Z";

const change = (
  number: number,
  mergeability: FlowPullRequest["mergeability"],
): FlowPullRequest => ({
  repository: "webdev",
  number,
  title: `Change ${number}`,
  kind: "code",
  mateProjectId: "m1",
  url: undefined,
  mergeability,
  behind: false,
  merged: false,
  mergedAt: undefined,
  headSha: undefined,
  baseBranch: "main",
  line: "",
  updatedAt: AT,
  state: "open",
  ready: true,
});

const pullRequests = [
  change(1, "mergeable"),
  change(2, "mergeable"),
  change(3, "conflicting"),
  change(4, "mergeable"),
  change(5, "mergeable"),
];

/** #4 the person already asked for; #5 is being merged; the rest wait for the person's ask. */
const standingOf = (pull: FlowPullRequest): ChangeStandingRead => {
  const standing: ChangeStanding =
    pull.number === 4 ? { kind: "waiting", by: "me", at: AT, mine: true } : { kind: "to-ask" };
  const act: ChangeAct | undefined = pull.number === 5 ? { kind: "merging" } : undefined;
  return { standing, word: "", who: "", ...(act === undefined ? {} : { act }) };
};

const queueOf = (yours: boolean) => {
  const step = mateNextStep({
    pullRequests,
    mateProjectId: "m1",
    mateName: "Nova",
    yours,
    standingOf,
  });
  return step.kind === "review" ? step.queue?.map((pull) => pull.number) : undefined;
};

// witness: packages/client-runtime/src/zerops/mateNextStep.ts | (entry) => merges(entry) && !busy(entry) && !asked.includes(entry) && !isTheirs(entry), → (entry) => merges(entry) && !asked.includes(entry) && !isTheirs(entry),
it("ZV141: Reviewing together takes every change waiting on the person, leaving out one that does not merge, one already asked for, one being merged and a colleague's Mate's", () => {
  expect(queueOf(true)).toEqual([2, 1]);
  expect(queueOf(false)).toEqual([]);
});

// witness: packages/client-runtime/src/zerops/mateNextStep.ts | if (act?.kind === "adding") return { pull: entry, label: act.line, act, ...theirs(entry) }; → if (act?.kind === "adding") return { pull: entry, label: entry.title, act, ...theirs(entry) };
it("ZV218: Of several drafts, each line goes by its title, and one HQ is adding says what its addition does in place of it; breaks: the line over the composer names the change by its number with only Adding after it", () => {
  const adding: FlowPullRequest = { ...change(8, "mergeable"), state: "adding" };
  const step = mateNextStep({
    pullRequests: [change(6, "mergeable"), adding],
    mateProjectId: "m1",
    mateName: "Abel",
  });
  // Newest first, and by number where they moved together.
  expect(step.kind === "review" ? step.lines.map((line) => line.label) : []).toEqual([
    addingLine(adding),
    "Change 6",
  ]);
});

import { expect, it } from "vite-plus/test";

import type { ChangeAct } from "./changeAct.ts";
import type { ChangeStanding, ChangeStandingRead } from "./changeStanding.ts";
import { mateNextStep } from "./mateNextStep.ts";
import type { FlowPullRequest } from "./projectFlow.ts";

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
it("ZV+11: Reviewing together takes every change waiting on the person, leaving out one that does not merge, one already asked for, one being merged and a colleague's Mate's", () => {
  expect(queueOf(true)).toEqual([2, 1]);
  expect(queueOf(false)).toEqual([]);
});

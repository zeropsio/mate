import { expect, it } from "vite-plus/test";

import {
  type ChangeReviewInput,
  changeMergeVerdict,
  changeReview,
  mergeCheckWait,
  addingVerdict,
  releaseReview,
} from "./reviewVerdict.ts";

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | const sameWait = held !== undefined && held.of === of; → const sameWait = held !== undefined && true;
it("ZV98: A merge check's wait starts when the review first sees that change unjudged at that head: asked again for the same one it keeps its start, and another change or a new head starts it again", () => {
  const started = 1_000_000;
  const later = started + 61_000;
  const held = { of: "app-1/webdev#32@4a786a65", since: started };

  expect(mergeCheckWait(held, "app-1/webdev#32@4a786a65", later)).toEqual({
    of: "app-1/webdev#32@4a786a65",
    since: started,
  });
  expect(mergeCheckWait(held, "app-1/webdev#32@db2c1673", later)).toEqual({
    of: "app-1/webdev#32@db2c1673",
    since: later,
  });
  expect(mergeCheckWait(held, "app-1/webdev#33@4a786a65", later)).toEqual({
    of: "app-1/webdev#33@4a786a65",
    since: later,
  });
  expect(mergeCheckWait(held, undefined, later)).toBeUndefined();
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | (input.outcome.kind === "failed" && input.productionMoved !== true); → (input.outcome.kind === "failed" && input.productionMoved === true);
it("ZV147: A failed release that moved nothing offers no roll back; one that moved some does", () => {
  const review = (productionMoved: boolean) =>
    releaseReview({
      tag: "v0.1.1",
      gate: { allowed: true },
      permission: { allowed: true },
      changes: 1,
      onStage: undefined,
      services: ["app"],
      replaces: { kind: "release", tag: "v0.1.0" },
      outcome: { kind: "failed", services: ["app"] },
      productionMoved,
      now: 0,
    });
  expect(review(false).ifWrong).toBeUndefined();
  expect(review(true).ifWrong).toContain("v0.1.0");
});

const HEAD = "4a786a65".repeat(5);

const openChange: ChangeReviewInput["pull"] = {
  number: 7,
  headSha: HEAD,
  kind: "code",
  baseBranch: "main",
  mergeability: "mergeable",
  merged: false,
  mergedAt: undefined,
  state: "open",
  behind: false,
  ready: true,
};

const reviewOf = (
  pull: ChangeReviewInput["pull"],
  readout: ChangeReviewInput["readout"],
  offered: ChangeReviewInput["offered"],
) =>
  changeReview({
    pull,
    mateName: "Nova",
    readout,
    downstream: { production: false, stage: false },
    offered,
    now: 0,
  });

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | pull.state === "adding" || pull.state === "merging" ? pull : { state: "adding" }, → pull.state === "adding" || pull.state === "merging" ? pull : { ...pull, state: "adding" },
it("ZV209: A newly accepted addition waits for its own result when the change stream still holds the previous one; breaks: an old failure is reported for the new attempt.", () => {
  const updatedAt = "2026-11-27T09:00:00Z";
  const review = changeReview({
    pull: {
      ...openChange,
      updatedAt,
      reviewBuild: { state: "failing", head: HEAD, at: updatedAt },
    },
    mateName: "Nova",
    readout: "read",
    downstream: { production: false, stage: false },
    offered: { merge: true, close: true },
    press: { kind: "done", adding: true, at: updatedAt },
    now: Date.parse(updatedAt),
  });
  expect(review.verdict.tone).toBe("busy");
  expect(review.verdict.state).toBe("merging");
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts |     input.readout !== "unread" && →     true &&
it("ZV149: Merge takes only the head whose change was shown", () => {
  const offered = { merge: true, close: false };
  expect(
    (["reading", "unread", "read"] as const).map(
      (readout) => reviewOf(openChange, readout, offered).primary?.enabled,
    ),
  ).toEqual([false, false, true]);
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts |     input.offered?.merge === true; →     input.offered?.merge !== false;
it("ZV150: Merge is offered only where HQ's rule offers merge_change, and is held while that is not yet asked", () => {
  expect(reviewOf(openChange, "read", { merge: false, close: false }).primary).toBeUndefined();
  expect(reviewOf(openChange, "read", undefined).primary?.enabled).toBe(false);
  expect(reviewOf(openChange, "read", { merge: true, close: false }).primary?.enabled).toBe(true);
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts |     (validation.head !== pull.headSha || validation.state !== "valid") →     (validation.state !== "valid")
it("ZV151: Pending or unavailable validation is never shown as passing", () => {
  const verdictAt = (head: string, state: "valid" | "unavailable") => {
    const { verdict, enabled } = changeMergeVerdict({
      pull: { ...openChange, kind: "recipe", recipeValidation: { head, state, problems: [] } },
      mateName: "Nova",
    });
    return [verdict.state, enabled];
  };
  expect(verdictAt("db2c1673".repeat(5), "valid")).toEqual(["checking", false]);
  expect(verdictAt(HEAD, "unavailable")).toEqual(["checks-unknown", false]);
  expect(verdictAt(HEAD, "valid")).toEqual(["ready", true]);
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | if (pull.landedWith !== undefined) return landedWithReview(base, pull.landedWith); → if (pull.landedWith !== undefined && pull.closedByMate === true) return landedWithReview(base, pull.landedWith);
it("ZV152: A change carried by another's landing reads merged as part of it, never closed without merging", () => {
  const carried = reviewOf({ ...openChange, state: "closed", landedWith: 12 }, "read", {
    merge: false,
    close: false,
  });
  expect(carried.verdict.title).toContain("#12");
  expect(carried.verdict.why).toContain("#12");
  expect(carried.primary).toBeUndefined();
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | now > Date.parse(pull.reviewBuild.until); → now < Date.parse(pull.reviewBuild.until);
it("ZV194: An addition's unanswered take becomes unavailable only after its deadline; breaks: an expired build still looks active.", () => {
  const at = "2026-11-26T20:00:00Z";
  const until = "2026-11-26T20:30:00Z";
  const pull = {
    state: "adding",
    reviewBuild: { state: "awaiting", head: HEAD, at, until },
  } as const;
  const deadline = Date.parse(until);
  expect([addingVerdict(pull, deadline)?.tone, addingVerdict(pull, deadline + 1)?.tone]).toEqual([
    "busy",
    "attention",
  ]);
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | if (!adding && !(pull.state === "open" && givenUp !== undefined)) return undefined; → if (!adding && !(pull.state === "open" && (givenUp !== undefined || pull.reviewBuild !== undefined))) return undefined;
it("ZV195: A stopped addition's retained result does not claim that an open draft is still being added; breaks: a person cannot add it again.", () => {
  const at = "2026-11-26T20:00:00Z";
  for (const state of ["awaiting", "failing", "unavailable", "passing"] as const) {
    const model = reviewOf({ ...openChange, reviewBuild: { state, at, head: HEAD } }, "read", {
      merge: true,
      close: false,
    });
    expect(model.verdict.state).toBe("ready");
    expect([model.primary?.enabled, model.primary?.safe]).toEqual([true, true]);
  }
  const handed = reviewOf({ ...openChange, checksGivenUp: { reason: "tries" } }, "read", {
    merge: true,
    close: false,
  });
  expect(handed.verdict.tone).toBe("attention");
  expect(handed.primary?.enabled).toBe(false);
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | return "No agent can work on this Mate: sign one in, then ask it to fix the check."; → return "Checks still fail after 3 tries; over to a person.";
it("ZV205: An addition handed to a person says whether its Mate ran out of tries, has no usable agent or reached a usage limit; breaks: the person cannot tell what to do next.", () => {
  const rows = [
    ["tries", "Checks still fail after 3 tries; over to a person."],
    ["no-agent", "No agent can work on this Mate: sign one in, then ask it to fix the check."],
    [
      "usage-limit",
      "Your agent is at its usage limit, so the failed check waits for you: ask again after the limit resets, or sign in another agent.",
    ],
  ] as const;
  for (const [reason, sentence] of rows) {
    const base = { ...openChange, checksGivenUp: { reason } };
    const build = changeMergeVerdict({
      pull: {
        ...base,
        state: "adding",
        reviewBuild: { state: "failing", head: HEAD, at: "2026-11-26T20:00:00Z" },
      },
      mateName: "Nova",
    });
    expect(build.verdict.why).toBe(sentence);
    const github = changeMergeVerdict({
      pull: {
        ...base,
        pullRequest: {
          state: "open",
          checks: "failing",
          url: "https://github.com/o/r/pull/7",
        },
      },
      mateName: "Nova",
    });
    expect(github.verdict.why).toBe(sentence);
  }
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | ...(pull.state === "adding" ? { secondary: STOP_ADDING } : {}), → ...(pull.state === "merging" ? { secondary: STOP_ADDING } : {}),
it("ZV207: An addition in progress keeps the draft open and offers Stop adding only until HQ claims the merge; breaks: a person is told the change merged early or can request a stop HQ cannot take.", () => {
  const offered = { merge: true, close: true };
  const adding = reviewOf({ ...openChange, state: "adding" }, "read", offered);
  expect(adding.verdict.state).toBe("merging");
  expect(adding.primary).toBeUndefined();
  expect([adding.secondary?.action, adding.secondary?.enabled]).toEqual(["stop-adding", true]);
  const merging = reviewOf({ ...openChange, state: "merging" }, "read", offered);
  expect(merging.verdict.state).toBe("merging");
  expect(merging.secondary).toBeUndefined();
  const reopened = reviewOf(
    { ...openChange, state: "open", addingError: "github_unreachable" },
    "read",
    offered,
  );
  expect(reopened.verdict.state).toBe("merge-refused");
  expect(reopened.primary?.enabled).toBe(true);
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | const failed = pull.state === "adding" && pull.reviewBuild?.state === "failing"; → const failed = pull.state === "adding" && pull.reviewBuild?.state === "passing";
it("ZV208: A failed addition and a handoff to a person are visible while the draft stays open; breaks: a person sees a build in progress after it failed or needs their help.", () => {
  const offered = { merge: true, close: true };
  const failed = reviewOf(
    {
      ...openChange,
      state: "adding",
      reviewBuild: { state: "failing", head: HEAD, at: "2026-11-27T09:00:00Z", try: 2 },
    },
    "read",
    offered,
  );
  expect(failed.verdict.state).toBe("merge-refused");
  expect(failed.verdict.tone).toBe("attention");
  expect(failed.secondary?.action).toBe("stop-adding");
  const givenUp = reviewOf(
    { ...openChange, state: "adding", checksGivenUp: { reason: "tries" } },
    "read",
    offered,
  );
  expect(givenUp.verdict.state).toBe("merge-refused");
  expect(givenUp.verdict.tone).toBe("attention");
  expect(givenUp.primary).toBeUndefined();
});

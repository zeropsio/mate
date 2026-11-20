import { expect, it } from "vite-plus/test";

import {
  type ChangeReviewInput,
  changeMergeVerdict,
  changeReview,
  mergeCheckWait,
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
it("ZV+17: A failed release that moved nothing offers no roll back; one that moved some does", () => {
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

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts |     input.readout !== "unread" && →     true &&
it("ZV+19: Merge takes only the head whose change was shown", () => {
  const offered = { merge: true, close: false };
  expect(
    (["reading", "unread", "read"] as const).map(
      (readout) => reviewOf(openChange, readout, offered).primary?.enabled,
    ),
  ).toEqual([false, false, true]);
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts |     input.offered?.merge === true; →     input.offered?.merge !== false;
it("ZV+20: Merge is offered only where HQ's rule offers merge_change, and is held while that is not yet asked", () => {
  expect(reviewOf(openChange, "read", { merge: false, close: false }).primary).toBeUndefined();
  expect(reviewOf(openChange, "read", undefined).primary?.enabled).toBe(false);
  expect(reviewOf(openChange, "read", { merge: true, close: false }).primary?.enabled).toBe(true);
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts |     (validation.head !== pull.headSha || validation.state !== "valid") →     (validation.state !== "valid")
it("ZV+21: Pending or unavailable validation is never shown as passing", () => {
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
it("ZV+22: A change carried by another's landing reads merged as part of it, never closed without merging", () => {
  const carried = reviewOf({ ...openChange, state: "closed", landedWith: 12 }, "read", {
    merge: false,
    close: false,
  });
  expect(carried.verdict.title).toContain("#12");
  expect(carried.verdict.why).toContain("#12");
  expect(carried.primary).toBeUndefined();
});

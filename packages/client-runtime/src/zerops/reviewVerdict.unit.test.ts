import { expect, it } from "vite-plus/test";

import {
  type ChangeReviewInput,
  changeMergeVerdict,
  changeReview,
  mergeCheckWait,
  reviewBuildVerdict,
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

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | now > Date.parse(build.until) → now < Date.parse(build.until)
it("ZV194: A Review build's take turns unavailable only after its deadline by the reader's clock, and each result keeps its own state and reason; breaks: a dead service leaves a change awaiting forever or a failed build reads passing", () => {
  const at = "2026-11-26T20:00:00Z";
  const until = "2026-11-26T20:30:00Z";
  const deadline = Date.parse(until);
  const taken = { head: HEAD, at, until, state: "awaiting" } as const;
  const rows = [
    [taken, deadline, undefined, "awaiting", "Awaiting Review build"],
    [taken, deadline + 1, undefined, "unavailable", "Review build unavailable (no result arrived)"],
    [
      { head: HEAD, at, state: "failing" },
      deadline,
      true,
      "failing",
      "Review build failed · over to you",
    ],
    [
      { head: HEAD, at, state: "unavailable", reason: "stage moved" },
      deadline,
      undefined,
      "unavailable",
      "Review build unavailable (stage moved)",
    ],
    [{ head: HEAD, at, state: "passing" }, deadline, undefined, "passing", "Review build passed"],
    [
      { head: HEAD, at, state: "passing" },
      deadline,
      true,
      "passing",
      "Review build passed · over to you",
    ],
  ] as const;
  for (const [build, now, givenUp, state, word] of rows) {
    expect(reviewBuildVerdict(build, now, givenUp)).toEqual({ state, word });
  }
  expect(reviewBuildVerdict(undefined, deadline)).toBeUndefined();
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | const url = part.probe?.url ?? `https://${part.stage}`; → const url = `https://${part.stage}`;
it("ZV199: Each passed Review build part offers its probed public address, or its public stage hostname when unprobed; failed, unavailable and private parts offer none; breaks: a person cannot open a passed stage or is offered a stage that did not pass", () => {
  const at = "2026-11-26T20:00:00Z";
  const probed = {
    setup: "web",
    stage: "web.example",
    outcome: "ok" as const,
    probe: { url: "https://web.example/health", status: 200, at },
  };
  const fallback = { setup: "docs", stage: "docs.example", outcome: "ok" as const };
  const failed = { ...probed, setup: "failed", outcome: "failed" as const };
  const unavailable = { ...probed, setup: "unavailable", outcome: "unavailable" as const };
  const privatePart = { setup: "private", stage: "worker", outcome: "ok" as const };
  const privateProbed = { ...probed, setup: "private-probed", stage: "worker" };
  const unsafe = { ...probed, setup: "unsafe", probe: { url: "javascript:alert(1)", at } };

  expect(
    reviewBuildVerdict({ state: "passing", head: HEAD, at, parts: [probed, fallback] }, undefined)
      ?.links,
  ).toEqual([
    { setup: "web", url: "https://web.example/health" },
    { setup: "docs", url: "https://docs.example" },
  ]);
  expect(
    reviewBuildVerdict(
      {
        state: "failing",
        head: HEAD,
        at,
        parts: [probed, failed, unavailable, privatePart, privateProbed, unsafe],
      },
      undefined,
    )?.links,
  ).toEqual([{ setup: "web", url: "https://web.example/health" }]);
  for (const part of [failed, unavailable, privatePart, privateProbed, unsafe]) {
    expect(
      reviewBuildVerdict({ state: "unavailable", head: HEAD, at, parts: [part] }, undefined)?.links,
    ).toBeUndefined();
  }
});

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | if (reviewBuild?.state === "awaiting" || reviewBuild?.state === "failing") { → if (reviewBuild?.state === "failing") {
it("ZV195: The review leaves Merge available and plain while a Review build awaits, fails or is unavailable, recommends it when the build passes, and retains GitHub's checks; breaks: an awaiting build reads ready or Merge is recommended over a failed build", () => {
  const at = "2026-11-26T20:00:00Z";
  const pullRequest = {
    state: "open",
    checks: "passing",
    url: "https://example.test/pull/7",
  } as const;
  const rows = [
    ["awaiting", "Awaiting Review build", true],
    ["failing", "Review build failed", true],
    ["unavailable", "Ready to merge", true],
    ["passing", "Ready to merge", false],
  ] as const;
  for (const [state, title, plain] of rows) {
    const model = reviewOf(
      { ...openChange, pullRequest, reviewBuild: { state, at, head: HEAD } },
      "read",
      { merge: true, close: false },
    );
    expect(model.verdict.title).toBe(title);
    expect(model.primary?.enabled).toBe(true);
    expect(model.primary?.plain === true).toBe(plain);
    expect(model.primary?.safe).toBe(!plain);
    expect(model.githubChecks?.state).toBe("passing");
  }
  const both = reviewOf(
    {
      ...openChange,
      pullRequest: { ...pullRequest, checks: "failing" },
      reviewBuild: { state: "failing", at, head: HEAD },
      checksGivenUp: true,
    },
    "read",
    { merge: true, close: false },
  );
  expect(both.verdict.title).toBe("Review build failed · over to you");
  expect(both.githubChecks?.words).toBe("GitHub's checks failed on its latest push");
  expect(both.verdict.fix?.verb).toBe("fix them");
  expect(both.primary?.plain).toBe(true);
});

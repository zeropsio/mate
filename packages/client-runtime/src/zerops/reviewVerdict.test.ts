// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import { describe, expect, it } from "vite-plus/test";

import type { GitCheckRow } from "./gitTab.ts";
import { RELEASE_NOT_A_RELEASER, RELEASE_NOTHING_NEW_ON_MAIN } from "./release.ts";
import {
  changeReview,
  crewTaskReview,
  releaseReview,
  reviewAge,
  rollbackReview,
  type ChangeReviewInput,
  type CrewTaskReviewInput,
  type ReleaseReviewInput,
  type RollbackReviewInput,
} from "./reviewVerdict.ts";

const NOW = Date.parse("2026-09-29T10:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const check = (name: string, tone: GitCheckRow["tone"], description?: string): GitCheckRow => ({
  name,
  tone,
  word: tone,
  ...(description === undefined ? {} : { description }),
});

function change(over: Partial<ChangeReviewInput> = {}): ChangeReviewInput {
  return {
    pull: {
      number: 2,
      kind: "code",
      baseBranch: "main",
      mergeability: "mergeable",
      checks: "passing",
      checkRows: [check("build", "ok", "pnpm build · 34s")],
      merged: false,
      mergedAt: undefined,
      mergeBase: "mb",
      baseSha: "mb",
    },
    mateName: "Nova",
    commits: 1,
    downstream: { production: true, stage: true },
    now: NOW,
    ...over,
  };
}

const pull = (over: Partial<ChangeReviewInput["pull"]>) => ({ ...change().pull, ...over });

describe("changeReview: the verdict comes first (R2)", () => {
  it.each<[string, Partial<ChangeReviewInput>, Record<string, unknown>]>([
    [
      "ready",
      {},
      {
        state: "ready",
        tone: "ok",
        title: "Ready to merge",
        why: "Checks passed · no conflicts with main · 1 commit",
        fix: undefined,
      },
    ],
    [
      "ready with nothing checked: grey, not green",
      { pull: pull({ checks: "none", checkRows: [] }), commits: 3 },
      {
        state: "unchecked",
        tone: "quiet",
        title: "Ready to merge",
        why: "No checks ran · no conflicts with main · 3 commits",
      },
    ],
    [
      "conflict, the files named",
      {
        pull: pull({ mergeability: "conflicting" }),
        conflict: {
          files: ["src/server/index.ts"],
          by: { subject: "Add the health routes (#5)", at: minutesAgo(20) },
        },
      },
      {
        state: "conflict",
        tone: "attention",
        title: "Conflicts with main in index.ts",
        why: "#5 changed it on main 20 minutes ago",
      },
    ],
    [
      "conflict in several files, by a commit with no number",
      {
        pull: pull({ mergeability: "conflicting" }),
        conflict: { files: ["a.ts", "b.ts", "c.ts"], by: { subject: "Tidy imports" } },
      },
      {
        state: "conflict",
        title: "Conflicts with main in 3 files",
        why: "“Tidy imports” changed them on main",
      },
    ],
    [
      "behind main: nothing overlapping read yet",
      { pull: pull({ mergeability: "conflicting" }) },
      {
        state: "behind",
        tone: "attention",
        title: "Behind main",
        why: "It no longer merges cleanly: main moved on since Nova branched",
      },
    ],
    [
      "behind main, and it still merges cleanly",
      { pull: pull({ mergeBase: "mb", baseSha: "newer" }), behindBy: 2 },
      {
        state: "behind-clean",
        tone: "attention",
        title: "Behind main",
        why: "2 changes landed on main since Nova branched · it still merges cleanly",
      },
    ],
    [
      "checks failing, named",
      {
        pull: pull({
          checks: "failing",
          checkRows: [check("build", "failed", "tsc exited 2 · 41s"), check("lint", "ok")],
        }),
      },
      {
        state: "checks-failed",
        tone: "failed",
        title: "Checks failing: build",
        why: "tsc exited 2 · 41s",
      },
    ],
    [
      "checks running",
      {
        pull: pull({
          checks: "pending",
          checkRows: [check("build", "busy"), check("e2e", "busy", "3 of 12 pages")],
        }),
      },
      {
        state: "checks-running",
        tone: "busy",
        title: "Checks running: build and e2e",
        why: "Merging waits for them",
        fix: undefined,
      },
    ],
    [
      "Gitea still working out whether it merges",
      { pull: pull({ mergeability: "checking" }) },
      {
        state: "checking",
        tone: "busy",
        title: "Checking whether it merges cleanly",
        fix: undefined,
      },
    ],
    [
      "merged",
      {
        pull: pull({ merged: true, mergedAt: minutesAgo(0) }),
        waiting: { count: 1, live: "v0.1.0" },
      },
      {
        state: "merged",
        tone: "done",
        title: "Merged into main",
        why: "Just now · 1 change now waits for production",
      },
    ],
  ])("%s", (_name, over, expected) => {
    expect(changeReview(change(over)).verdict).toMatchObject(expected);
  });

  it.each<[string, Partial<ChangeReviewInput>, string, string]>([
    [
      "a conflict",
      {
        pull: pull({ mergeability: "conflicting" }),
        conflict: { files: ["src/server/index.ts"], by: undefined },
      },
      "resolve it",
      "Rebase it on main, resolve the conflicts, and push.",
    ],
    [
      "failing checks",
      { pull: pull({ checks: "failing", checkRows: [check("build", "failed", "tsc exited 2")] }) },
      "fix it",
      "Find out why, fix them, and push.",
    ],
    [
      "a branch main moved past",
      { pull: pull({ baseSha: "newer" }) },
      "update it",
      "Bring it up to date with main, check it still works, and push.",
    ],
  ])("hands %s to the Mate, the problem written out", (_name, over, verb, ask) => {
    const fix = changeReview(change(over)).verdict.fix;
    expect(fix?.verb).toBe(verb);
    expect(fix?.problem.ask).toBe(ask);
    expect(fix?.problem.what).toMatch(/#2/u);
  });

  it("says the failing check's own words as the error the Mate reads", () => {
    const fix = changeReview(
      change({
        pull: pull({ checks: "failing", checkRows: [check("build", "failed", "tsc exited 2")] }),
      }),
    ).verdict.fix;
    expect(fix?.problem).toMatchObject({
      what: "The checks on pull request #2 are failing: build",
      error: "tsc exited 2",
    });
  });
});

describe("changeReview: the button says what will happen (R5)", () => {
  it.each<[string, Partial<ChangeReviewInput>, string, { enabled: boolean; safe: boolean }]>([
    [
      "one commit, a production downstream",
      {},
      "Squash-merges 1 commit into main. Production isn't touched until you release.",
      { enabled: true, safe: true },
    ],
    [
      "several commits, only a stage downstream",
      { commits: 3, downstream: { production: false, stage: true } },
      "Squash-merges 3 commits into main as one. The stage picks it up from main.",
      { enabled: true, safe: true },
    ],
    [
      "a recipe change",
      { pull: pull({ kind: "recipe" }), commits: undefined },
      "Squash-merges it into main. The project's environments change to match.",
      { enabled: true, safe: true },
    ],
    [
      "nothing downstream yet",
      { downstream: { production: false, stage: false } },
      "Squash-merges 1 commit into main.",
      { enabled: true, safe: true },
    ],
    [
      "a conflict",
      { pull: pull({ mergeability: "conflicting" }) },
      "Merging waits until the conflict is resolved.",
      { enabled: false, safe: false },
    ],
    [
      "failing checks",
      { pull: pull({ checks: "failing", checkRows: [check("build", "failed")] }) },
      "Merging waits until the checks pass.",
      { enabled: false, safe: false },
    ],
    [
      "running checks",
      { pull: pull({ checks: "pending", checkRows: [check("build", "busy")] }) },
      "Merging waits for the checks to finish.",
      { enabled: false, safe: false },
    ],
    [
      "behind main but clean",
      { pull: pull({ baseSha: "newer" }), behindBy: 2 },
      "Squash-merges 1 commit into main, on top of 2 changes it wasn't checked with. Production isn't touched until you release.",
      { enabled: true, safe: true },
    ],
  ])("%s", (_name, over, consequence, primary) => {
    const review = changeReview(change(over));
    expect(review.consequence).toBe(consequence);
    expect(review.primary).toMatchObject({ label: "Merge", ...primary });
  });

  it.each<[string, Partial<ChangeReviewInput>, string, string | undefined]>([
    [
      "production waiting: the next review is the release",
      {
        pull: pull({ merged: true, mergedAt: minutesAgo(1) }),
        waiting: { count: 1, live: "v0.1.0" },
        releaseOffered: true,
      },
      "Production still serves v0.1.0 until you release.",
      "Review release",
    ],
    [
      "no production: nothing more to press",
      {
        pull: pull({ merged: true, mergedAt: minutesAgo(1) }),
        downstream: { production: false, stage: true },
      },
      "The stage picks it up from main.",
      undefined,
    ],
  ])("after the merge, %s (R6)", (_name, over, consequence, next) => {
    const review = changeReview(change(over));
    expect(review.consequence).toBe(consequence);
    expect(review.primary?.label).toBe(next);
  });

  it.each<[string, ChangeReviewInput["press"], Record<string, unknown>, boolean]>([
    [
      "merging",
      { kind: "running" },
      { state: "merging", tone: "busy", title: "Merging into main" },
      false,
    ],
    [
      "refused",
      {
        kind: "refused",
        reason: "This pull request changed since you opened it — review it again.",
      },
      {
        state: "merge-refused",
        tone: "attention",
        title: "Not merged",
        why: "This pull request changed since you opened it — review it again.",
      },
      true,
    ],
  ])("while pressed: %s", (_name, press, verdict, enabled) => {
    const review = changeReview(change({ press }));
    expect(review.verdict).toMatchObject(verdict);
    expect(review.primary?.enabled).toBe(enabled);
  });
});

function release(over: Partial<ReleaseReviewInput> = {}): ReleaseReviewInput {
  return {
    tag: "v0.1.57",
    gate: { allowed: true },
    changes: 2,
    onStage: { total: 2, running: 2 },
    services: ["app", "api"],
    live: "v0.1.56",
    outcome: { kind: "offered" },
    now: NOW,
    ...over,
  };
}

describe("releaseReview", () => {
  it.each<[string, Partial<ReleaseReviewInput>, Record<string, unknown>]>([
    [
      "release ready",
      {},
      {
        state: "release-ready",
        tone: "ok",
        title: "Ready to release",
        why: "Stage runs both changes",
      },
    ],
    [
      "release ready, stage behind",
      { onStage: { total: 3, running: 1 } },
      { state: "release-ready", why: "Stage runs 1 of 3 changes" },
    ],
    [
      "release ready, no stage",
      { onStage: undefined, changes: 1 },
      { state: "release-ready", why: "1 change merged since v0.1.56" },
    ],
    [
      "not a releaser",
      { gate: { allowed: false, reason: RELEASE_NOT_A_RELEASER } },
      { state: "release-blocked", tone: "attention", title: "Only releasers can release" },
    ],
    [
      "nothing new",
      { gate: { allowed: false, reason: RELEASE_NOTHING_NEW_ON_MAIN } },
      { state: "release-blocked", tone: "done", title: "Nothing to release" },
    ],
    [
      "releasing",
      { outcome: { kind: "releasing", progress: "Building app · 1:12 · api waits for it" } },
      {
        state: "releasing",
        tone: "busy",
        title: "Releasing v0.1.57",
        why: "Building app · 1:12 · api waits for it",
      },
    ],
    [
      "released",
      { outcome: { kind: "released", at: minutesAgo(3) } },
      {
        state: "released",
        tone: "done",
        title: "Released v0.1.57",
        why: "Production runs it · 3 minutes ago",
      },
    ],
    [
      "release failed",
      {
        outcome: {
          kind: "failed",
          detail: "The build of app failed",
          service: "app",
          at: minutesAgo(2),
        },
      },
      {
        state: "release-failed",
        tone: "failed",
        title: "v0.1.57 didn't go out",
        why: "The build of app failed",
      },
    ],
  ])("%s", (_name, over, verdict) => {
    expect(releaseReview(release(over)).verdict).toMatchObject(verdict);
  });

  it("says what the tag does and what redeploys (R5)", () => {
    const review = releaseReview(release({ eta: "about 3 minutes" }));
    expect(review.consequence).toBe(
      "Tags main as v0.1.57. Production redeploys app and api from it, about 3 minutes.",
    );
    expect(review.primary).toEqual({ label: "Release v0.1.57", enabled: true, safe: true });
  });

  it.each<[string, Partial<ReleaseReviewInput>, string, boolean | undefined]>([
    [
      "blocked",
      { gate: { allowed: false, reason: RELEASE_NOT_A_RELEASER } },
      "Production keeps running v0.1.56.",
      false,
    ],
    [
      "releasing",
      { outcome: { kind: "releasing" } },
      "You can close this. Production's chip in the menu follows the release.",
      undefined,
    ],
    [
      "released",
      { outcome: { kind: "released", at: undefined } },
      "Production runs v0.1.57. If it misbehaves, roll back from production's menu.",
      undefined,
    ],
    [
      "failed",
      { outcome: { kind: "failed", detail: "The build of app failed" } },
      "Production still runs v0.1.56.",
      undefined,
    ],
  ])("when %s", (_name, over, consequence, enabled) => {
    const review = releaseReview(release(over));
    expect(review.consequence).toBe(consequence);
    expect(review.primary?.enabled).toBe(enabled);
  });

  it("hands a failed release to the person's Mate, with when and the error (S6)", () => {
    const fix = releaseReview(
      release({
        outcome: {
          kind: "failed",
          detail: "The build of app failed",
          service: "app",
          at: minutesAgo(2),
        },
      }),
    ).verdict.fix;
    expect(fix).toEqual({
      verb: "fix it",
      problem: {
        what: "Production's release v0.1.57 failed in app's deploy",
        at: minutesAgo(2),
        error: "The build of app failed",
        ask: "Find out why, fix it, and release again.",
      },
    });
  });
});

function rollback(over: Partial<RollbackReviewInput> = {}): RollbackReviewInput {
  return {
    tag: "v0.1.55",
    nextTag: "v0.1.58",
    live: "v0.1.57",
    services: ["app", "api"],
    mayRelease: true,
    outcome: { kind: "idle" },
    ...over,
  };
}

describe("rollbackReview: roll back gets the same review, naming where it goes back to", () => {
  it.each<[string, Partial<RollbackReviewInput>, Record<string, unknown>, string]>([
    [
      "rollback",
      {},
      {
        state: "rollback-ready",
        tone: "quiet",
        title: "Goes back to v0.1.55",
        why: "Production runs v0.1.57 now",
      },
      "Tags main as v0.1.58 with v0.1.55's commits. Production redeploys app and api from them.",
    ],
    [
      "not a releaser",
      { mayRelease: false },
      { state: "rollback-blocked", tone: "attention", title: "Only releasers can roll back" },
      "Production keeps running v0.1.57.",
    ],
    [
      "rolling back",
      { outcome: { kind: "running" } },
      { state: "rolling-back", tone: "busy", title: "Rolling back to v0.1.55" },
      "You can close this. Production's chip in the menu follows the release.",
    ],
    [
      "rolled back",
      { outcome: { kind: "done" } },
      { state: "rolled-back", tone: "done", title: "Rolled back to v0.1.55" },
      "Production runs v0.1.55's commits again, as v0.1.58.",
    ],
    [
      "refused",
      { outcome: { kind: "refused", reason: "Gitea would not create the tag." } },
      { state: "rollback-refused", tone: "attention", why: "Gitea would not create the tag." },
      "Production keeps running v0.1.57.",
    ],
  ])("%s", (_name, over, verdict, consequence) => {
    const review = rollbackReview(rollback(over));
    expect(review.verdict).toMatchObject(verdict);
    expect(review.consequence).toBe(consequence);
  });

  it("names the version in its button", () => {
    expect(rollbackReview(rollback()).primary).toEqual({
      label: "Roll back to v0.1.55",
      enabled: true,
      safe: true,
    });
  });
});

function task(over: Partial<CrewTaskReviewInput> = {}): CrewTaskReviewInput {
  return {
    ownerName: "Juno",
    state: "ready",
    check: { state: "passed", output: "" },
    diffStat: { insertions: 45, deletions: 3 },
    conflicts: [],
    waitingOn: [],
    landedCommit: null,
    ...over,
  };
}

describe("crewTaskReview: the same surface, with Land as its button", () => {
  it.each<
    [
      string,
      Partial<CrewTaskReviewInput>,
      Record<string, unknown>,
      Record<string, unknown> | undefined,
    ]
  >([
    [
      "crew task ready to land",
      {},
      {
        state: "land-ready",
        tone: "ok",
        title: "Ready to land",
        why: "Check passed · nothing waits on your edits",
      },
      { label: "Land", enabled: true, safe: true },
    ],
    [
      "still being worked on",
      { state: "working", check: null },
      { state: "land-now", tone: "quiet", title: "Juno is still on it" },
      { label: "Land now", enabled: true, safe: false },
    ],
    [
      "its copy conflicts",
      { conflicts: ["src/rig.ts"] },
      { state: "land-conflict", tone: "attention", title: "Conflicts with what landed in rig.ts" },
      { label: "Land", enabled: false, safe: false },
    ],
    [
      "its check failed",
      { check: { state: "failed", output: "build\nerror TS2322: nope\n" } },
      {
        state: "land-check-failed",
        tone: "failed",
        title: "Check failing",
        why: "error TS2322: nope",
      },
      { label: "Land", enabled: false, safe: false },
    ],
    [
      "landed",
      { state: "landed", landedCommit: "a1b2c3d4e5" },
      { state: "landed", tone: "done", title: "Landed as a1b2c3d" },
      undefined,
    ],
  ])("%s", (_name, over, verdict, primary) => {
    const review = crewTaskReview(task(over));
    expect(review.verdict).toMatchObject(verdict);
    if (primary === undefined) expect(review.primary).toBeUndefined();
    else expect(review.primary).toMatchObject(primary);
  });

  it("says what landing does", () => {
    expect(crewTaskReview(task()).consequence).toBe(
      "Lands Juno's work in your tree as one commit. Nothing is pushed until you deliver.",
    );
    expect(crewTaskReview(task({ state: "working" })).consequence).toBe(
      "Commits what Juno has so far and lands it in your tree. Nothing is pushed until you deliver.",
    );
  });
});

describe("reviewAge", () => {
  it.each([
    [minutesAgo(0), "Just now"],
    [minutesAgo(1), "1 minute ago"],
    [minutesAgo(20), "20 minutes ago"],
    [minutesAgo(60), "1 hour ago"],
    [minutesAgo(60 * 5), "5 hours ago"],
    [minutesAgo(60 * 24 * 3), "3 days ago"],
    ["not a date", undefined],
  ])("%s reads %s", (at, words) => {
    expect(reviewAge(at, NOW)).toBe(words);
  });
});

describe("crewTaskReview: only a landed task has landed (Land's answer is not its landing)", () => {
  it.each<[string, Partial<CrewTaskReviewInput>, Record<string, unknown>]>([
    [
      "Land accepted, the snapshot not moved yet: on its way",
      { state: "ready", press: { kind: "done" }, pressedAt: "ready" },
      { state: "landing", tone: "busy", title: "Landing" },
    ],
    [
      "Land accepted on a dirty tree: the task waits on the person's edits",
      {
        state: "waiting-on-you",
        waitingOn: ["src/hud.ts"],
        press: { kind: "done" },
        pressedAt: "ready",
      },
      { state: "land-waiting", tone: "attention", title: "Waits on your edits to hud.ts" },
    ],
    [
      "Land accepted and the task parked (frozen, lane gone, disk full)",
      {
        state: "parked",
        reason: "appdev is redeploying",
        press: { kind: "done" },
        pressedAt: "ready",
      },
      { state: "land-parked", tone: "attention", title: "Parked", why: "appdev is redeploying" },
    ],
    [
      "Land now whose merge-in or check failed: back to rework",
      {
        state: "rework",
        reason: "Its check failed: tsc exited 2",
        press: { kind: "done" },
        pressedAt: "working",
      },
      {
        state: "land-now",
        tone: "quiet",
        title: "Juno is reworking it",
        why: "Its check failed: tsc exited 2",
      },
    ],
    [
      "landed at last",
      { state: "landed", landedCommit: "a1b2c3d4e5", press: { kind: "done" }, pressedAt: "ready" },
      { state: "landed", tone: "done", title: "Landed as a1b2c3d" },
    ],
    [
      "refused, in the engine's own words",
      {
        state: "ready",
        press: {
          kind: "refused",
          reason: "A chat of this Mate is working; land between its turns.",
        },
      },
      {
        state: "land-refused",
        tone: "attention",
        title: "Not landed",
        why: "A chat of this Mate is working; land between its turns.",
      },
    ],
    [
      "reported and waiting for its review: landing accepts it",
      { state: "review" },
      {
        state: "land-review",
        tone: "ok",
        title: "Reported done",
        why: "Landing accepts it · check passed",
      },
    ],
  ])("%s", (_case, over, verdict) => {
    expect(crewTaskReview(task(over)).verdict).toMatchObject(verdict);
  });

  it.each<[string, Partial<CrewTaskReviewInput>, Record<string, unknown> | undefined]>([
    ["a ready task lands", { state: "ready" }, { label: "Land", enabled: true, safe: true }],
    [
      "a reported one lands, accepting it",
      { state: "review" },
      { label: "Land", enabled: true, safe: true },
    ],
    [
      "one waiting on the person's edits lands once they are committed",
      { state: "waiting-on-you", waitingOn: ["src/hud.ts"] },
      { label: "Land", enabled: true, safe: false },
    ],
    [
      "a working one lands now",
      { state: "working" },
      { label: "Land now", enabled: true, safe: false },
    ],
    ["a parked one offers nothing", { state: "parked", reason: "disk full" }, undefined],
  ])("its button: %s", (_case, over, primary) => {
    const review = crewTaskReview(task(over));
    if (primary === undefined) expect(review.primary).toBeUndefined();
    else expect(review.primary).toMatchObject(primary);
  });
});

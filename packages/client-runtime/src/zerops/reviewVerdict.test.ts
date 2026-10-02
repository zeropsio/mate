// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import { describe, expect, it } from "vite-plus/test";

import type { GitCheckRow } from "./gitTab.ts";
import type { RecipeReach } from "./recipeReach.ts";
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
    readout: "read",
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
      // Amber: still pressable, never pressed for the person — no focus, no ⌘↵.
      "behind main but clean",
      { pull: pull({ baseSha: "newer" }), behindBy: 2 },
      "Squash-merges 1 commit into main, on top of 2 changes it wasn't checked with. Production isn't touched until you release.",
      { enabled: true, safe: false },
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

describe("changeReview: a recipe change says what its merge does, and is never released", () => {
  const reach = (over: Partial<RecipeReach> = {}): RecipeReach => ({
    stages: 0,
    production: false,
    later: [],
    unused: [],
    declarations: false,
    ...over,
  });
  const recipe = (over: Partial<ChangeReviewInput["pull"]> = {}) =>
    pull({ kind: "recipe", checks: "none", checkRows: [], ...over });
  const merged = recipe({ merged: true, mergedAt: minutesAgo(0) });
  /** Where production waits for a release: a code change's review would offer it now. */
  const releasable = { releaseOffered: true, waiting: { count: 2, live: "v0.1.0" } } as const;

  it.each<[string, Partial<RecipeReach>, string, string]>([
    [
      "the stage made from a recipe it changes",
      { stages: 1 },
      "The stage gets any service added to its recipe, created empty; the services it has stay as they are.",
      "the stage gets any new service",
    ],
    [
      "every stage",
      { stages: 2 },
      "The stages get any service added to their recipe, created empty; the services they have stay as they are.",
      "the stages get any new service",
    ],
    [
      "production",
      { production: true },
      "Production gets any service added to its recipe, created empty; the services it has stay as they are.",
      "production gets any new service",
    ],
    [
      "the stage and production",
      { stages: 1, production: true },
      "The stage and production get any service added to their recipes, created empty; the services they have stay as they are.",
      "the stage and production get any new service",
    ],
    [
      "the stages and production, and a Mate added later",
      { stages: 2, production: true, later: ["mate"] },
      "The stages and production get any service added to their recipes, created empty; the services they have stay as they are. A Mate added later is made from the new recipe.",
      "the stages and production get any new service",
    ],
    [
      // The owner's case, 2026-09-30: a service added to these two, and a release offered for it.
      "recipes nothing in the project is made from",
      { unused: ["Remote (CDE)", "Local"] },
      "Nothing in this project is made from the Remote (CDE) or Local recipe, so no environment changes.",
      "no environment changes",
    ],
    [
      "production's recipe with no production yet",
      { later: ["production"] },
      "No environment changes. A production added later is made from the new recipe.",
      "no environment changes",
    ],
    [
      "the Mates' recipe",
      { later: ["mate"] },
      "No environment changes. A Mate added later is made from the new recipe.",
      "no environment changes",
    ],
    [
      "every recipe, in a project with nothing made from them yet",
      { later: ["mate", "stage", "production"], unused: ["Local"] },
      "No environment changes. A Mate, a stage or a production added later is made from the new recipe.",
      "no environment changes",
    ],
    [
      "the declarations",
      { declarations: true },
      "The project deploys to the environments it declares.",
      "the project deploys to what it declares",
    ],
    [
      "the stage's recipe and the declarations",
      { stages: 1, declarations: true },
      "The stage gets any service added to its recipe, created empty; the services it has stay as they are. The project deploys to the environments it declares.",
      "the stage gets any new service",
    ],
    [
      "nothing anything is made from: its READMEs",
      {},
      "No environment changes.",
      "no environment changes",
    ],
  ])("%s", (_case, over, sentence, next) => {
    const before = changeReview(change({ pull: recipe(), recipe: reach(over), ...releasable }));
    expect(before.consequence).toBe(`Squash-merges 1 commit into main. ${sentence}`);
    expect(before.primary).toEqual({ label: "Merge", enabled: true, safe: true });

    const after = changeReview(change({ pull: merged, recipe: reach(over), ...releasable }));
    expect(after.verdict).toMatchObject({
      state: "merged",
      tone: "done",
      title: "Merged into main",
      why: `Just now · ${next}`,
    });
    expect(after.consequence).toBe(sentence);
    expect(after.primary).toBeUndefined();
  });

  const UNREAD =
    "Each environment gets any service added to its recipe, created empty; the services it has stay as they are.";

  it("says what any recipe change does where its files could not be read", () => {
    const review = changeReview(change({ pull: recipe(), readout: "failed", ...releasable }));
    expect(review.consequence).toBe(
      `Squash-merges 1 commit into main without its files shown. ${UNREAD}`,
    );
  });

  it("says it is on main, and what any recipe change does, until the files of one merged are read", () => {
    const review = changeReview(change({ pull: merged, readout: "reading", ...releasable }));
    expect(review.verdict.why).toBe("Just now · it's on main");
    expect(review.consequence).toBe(UNREAD);
    expect(review.primary).toBeUndefined();
  });

  it("merged by its own press, offers no release either", () => {
    const review = changeReview(
      change({
        pull: recipe(),
        recipe: reach({ stages: 1 }),
        press: { kind: "done" },
        ...releasable,
      }),
    );
    expect(review.verdict.state).toBe("merged");
    expect(review.primary).toBeUndefined();
  });
});

function release(over: Partial<ReleaseReviewInput> = {}): ReleaseReviewInput {
  return {
    tag: "v0.1.57",
    gate: { allowed: true },
    changes: 2,
    onStage: { total: 2, running: 2 },
    services: ["app", "api"],
    replaces: { kind: "release", tag: "v0.1.56" },
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
    const review = releaseReview(release());
    expect(review.consequence).toBe(
      "Tags main as v0.1.57. Production redeploys app and api from it.",
    );
    // It reaches people outside the account: a deliberate press, never focus or ⌘↵.
    expect(review.primary).toEqual({ label: "Release v0.1.57", enabled: true, safe: false });
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
      "You can close this. The project's line in the menu follows the release.",
      undefined,
    ],
    [
      "released",
      { outcome: { kind: "released", at: undefined } },
      "Production runs v0.1.57. If it misbehaves, roll back to v0.1.56 from production's menu.",
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

  it.each<[string, ReleaseReviewInput["replaces"], string, string | undefined, string]>([
    [
      "the first release",
      { kind: "first" },
      "the first release · 2 changes",
      undefined,
      "Production runs v0.1.57.",
    ],
    [
      "after a release production runs in full",
      { kind: "release", tag: "v0.1.56" },
      "replaces v0.1.56 · 2 changes",
      "Roll back to v0.1.56 from production's menu. It gets its own review.",
      "Production runs v0.1.57. If it misbehaves, roll back to v0.1.56 from production's menu.",
    ],
    [
      "after releases none of which production runs in full",
      { kind: "unnamed" },
      "replaces what production runs · 2 changes",
      "Roll back from production's menu. It gets its own review.",
      "Production runs v0.1.57. If it misbehaves, roll back from production's menu.",
    ],
    [
      // Read after it landed: production runs the release itself, never a roll back to it.
      "naming itself",
      { kind: "release", tag: "v0.1.57" },
      "replaces v0.1.57 · 2 changes",
      "Roll back from production's menu. It gets its own review.",
      "Production runs v0.1.57. If it misbehaves, roll back from production's menu.",
    ],
  ])(
    "released, %s: the header, the roll back line and the foot",
    (_name, replaces, meta, ifWrong, foot) => {
      const review = releaseReview(
        release({ replaces, outcome: { kind: "released", at: undefined } }),
      );
      expect(review.meta.join(" · ")).toBe(meta);
      expect(review.ifWrong).toBe(ifWrong);
      expect(review.consequence).toBe(foot);
    },
  );

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
    press: { kind: "idle" },
    outcome: { kind: "offered" },
    now: NOW,
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
      "tagging",
      { press: { kind: "running" } },
      {
        state: "rolling-back",
        tone: "busy",
        title: "Rolling back to v0.1.55",
        why: "Tagging main as v0.1.58",
      },
      "You can close this. The project's line in the menu follows the release.",
    ],
    [
      // The tag existing is not production running it: the broker and the deploy still decide.
      "tagged, on its way",
      {
        press: { kind: "done" },
        outcome: { kind: "releasing", progress: "Production redeploys from v0.1.58 · 0:40" },
      },
      {
        state: "rolling-back",
        tone: "busy",
        title: "Rolling back to v0.1.55",
        why: "Production redeploys from v0.1.58 · 0:40",
      },
      "You can close this. The project's line in the menu follows the release.",
    ],
    [
      "rolled back once production runs it",
      { press: { kind: "done" }, outcome: { kind: "released", at: minutesAgo(3) } },
      {
        state: "rolled-back",
        tone: "done",
        title: "Rolled back to v0.1.55",
        why: "Production runs its commits again, as v0.1.58 · 3 minutes ago",
      },
      "Production runs v0.1.55's commits again, as v0.1.58.",
    ],
    [
      "the broker refused it, or its deploy failed",
      {
        press: { kind: "done" },
        outcome: { kind: "failed", detail: "The deploy of app failed", service: "app" },
      },
      {
        state: "rollback-failed",
        tone: "failed",
        title: "v0.1.58 didn't go out",
        why: "The deploy of app failed",
      },
      "Production still runs v0.1.57.",
    ],
    [
      "refused",
      { press: { kind: "refused", reason: "Gitea would not create the tag." } },
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
      safe: false,
    });
  });
});

function task(over: Partial<CrewTaskReviewInput> = {}): CrewTaskReviewInput {
  return {
    ownerName: "Juno",
    mateName: "Fen",
    state: "ready",
    check: { state: "passed", output: "" },
    diffStat: { insertions: 45, deletions: 3 },
    conflicts: [],
    waitingOn: [],
    landedCommit: null,
    ...over,
  };
}

describe("crewTaskReview: the same surface, with Add to Fen's code as its button", () => {
  it.each<
    [
      string,
      Partial<CrewTaskReviewInput>,
      Record<string, unknown>,
      Record<string, unknown> | undefined,
    ]
  >([
    [
      "crew task ready to go in",
      {},
      {
        state: "land-ready",
        tone: "ok",
        title: "Done, not in Fen's code yet",
        why: "Its checks pass · nothing waits on Fen's edits",
      },
      { label: "Add to Fen's code", enabled: true, safe: true },
    ],
    [
      "still being worked on",
      { state: "working", check: null },
      { state: "land-now", tone: "quiet", title: "Juno is still on it" },
      { label: "Add what it has", enabled: true, safe: false },
    ],
    [
      "its copy conflicts",
      { conflicts: ["src/rig.ts"] },
      {
        state: "land-conflict",
        tone: "attention",
        title: "Clashes with what's now in Fen's code, in rig.ts",
      },
      { label: "Add to Fen's code", enabled: false, safe: false },
    ],
    [
      "its check failed",
      { check: { state: "failed", output: "build\nerror TS2322: nope\n" } },
      {
        state: "land-check-failed",
        tone: "failed",
        title: "Its checks fail",
        why: "error TS2322: nope",
      },
      { label: "Add to Fen's code", enabled: false, safe: false },
    ],
    [
      "in the Mate's code",
      { state: "landed", landedCommit: "a1b2c3d4e5" },
      { state: "landed", tone: "done", title: "In Fen's code" },
      undefined,
    ],
  ])("%s", (_name, over, verdict, primary) => {
    const review = crewTaskReview(task(over));
    expect(review.verdict).toMatchObject(verdict);
    if (primary === undefined) expect(review.primary).toBeUndefined();
    else expect(review.primary).toMatchObject(primary);
  });

  it("says what adding it does, in the person's words", () => {
    expect(crewTaskReview(task()).consequence).toBe(
      "Adds Juno's work to Fen's code as one commit. Nothing is shipped until Fen ships it.",
    );
    expect(crewTaskReview(task({ state: "working" })).consequence).toBe(
      "Commits what Juno has so far and adds it to Fen's code. Nothing is shipped until Fen ships it.",
    );
  });

  it("never says the engine's words", () => {
    const states = ["ready", "working", "rework", "review", "landed", "parked", "discarded"];
    for (const state of states) {
      const review = crewTaskReview(task({ state, waitingOn: [] }));
      const said = [
        review.verdict.title,
        review.verdict.why,
        review.consequence,
        review.primary?.label,
      ];
      expect(said.join(" "), state).not.toMatch(/\bland(?:ed|ing|s)?\b|\btree\b|\bdeliver/iu);
    }
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

describe("crewTaskReview: only work that went in is in (the press's answer is not its going in)", () => {
  it.each<[string, Partial<CrewTaskReviewInput>, Record<string, unknown>]>([
    [
      "Add accepted, the snapshot not moved yet: on its way",
      { state: "ready", press: { kind: "done" }, pressedAt: "ready" },
      { state: "landing", tone: "busy", title: "Going into Fen's code" },
    ],
    [
      "Add accepted on the Mate's uncommitted edits: it waits for them",
      {
        state: "waiting-on-you",
        waitingOn: ["src/hud.ts"],
        press: { kind: "done" },
        pressedAt: "ready",
      },
      {
        state: "land-waiting",
        tone: "attention",
        title: "Waits for Fen's edits to hud.ts to be committed",
      },
    ],
    [
      "Add accepted and the task stopped (frozen, lane gone, disk full)",
      {
        state: "parked",
        reason: "appdev is redeploying",
        press: { kind: "done" },
        pressedAt: "ready",
      },
      { state: "land-parked", tone: "attention", title: "Stopped", why: "appdev is redeploying" },
    ],
    [
      "Add what it has whose merge-in or check failed: back to rework",
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
      "in at last",
      { state: "landed", landedCommit: "a1b2c3d4e5", press: { kind: "done" }, pressedAt: "ready" },
      { state: "landed", tone: "done", title: "In Fen's code" },
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
        title: "Not added",
        why: "A chat of this Mate is working; land between its turns.",
      },
    ],
    [
      "reported and waiting for its review: adding it accepts it",
      { state: "review" },
      {
        state: "land-review",
        tone: "ok",
        title: "Reported done",
        why: "Adding it accepts it · its checks pass",
      },
    ],
  ])("%s", (_case, over, verdict) => {
    expect(crewTaskReview(task(over)).verdict).toMatchObject(verdict);
  });

  it.each<[string, Partial<CrewTaskReviewInput>, Record<string, unknown> | undefined]>([
    [
      "a finished one goes in",
      { state: "ready" },
      { label: "Add to Fen's code", enabled: true, safe: true },
    ],
    [
      "a reported one goes in, accepting it",
      { state: "review" },
      { label: "Add to Fen's code", enabled: true, safe: true },
    ],
    [
      "one waiting on the Mate's edits goes in once they are committed",
      { state: "waiting-on-you", waitingOn: ["src/hud.ts"] },
      { label: "Add to Fen's code", enabled: true, safe: false },
    ],
    [
      "a working one goes in as it is",
      { state: "working" },
      { label: "Add what it has", enabled: true, safe: false },
    ],
    ["a stopped one offers nothing", { state: "parked", reason: "disk full" }, undefined],
  ])("its button: %s", (_case, over, primary) => {
    const review = crewTaskReview(task(over));
    if (primary === undefined) expect(review.primary).toBeUndefined();
    else expect(review.primary).toMatchObject(primary);
  });
});

describe("changeReview: a change closed without merging", () => {
  it("says so, and offers no Merge", () => {
    const review = changeReview(change({ pull: pull({ state: "closed", merged: false }) }));
    expect(review.verdict).toMatchObject({
      state: "closed",
      tone: "done",
      title: "Closed without merging",
    });
    expect(review.primary).toBeUndefined();
    expect(review.consequence).toBe("It never reached main; nothing merges from here.");
  });

  it.each([
    ["an open one", { state: "open" }, "ready"],
    ["a landed one", { state: "closed", merged: true, mergedAt: minutesAgo(5) }, "merged"],
  ] as const)("does not take %s for it", (_case, over, state) => {
    expect(changeReview(change({ pull: pull(over) })).verdict.state).toBe(state);
  });
});

describe("changeReview: Merge takes only a head whose change was shown", () => {
  it.each<
    [
      string,
      ChangeReviewInput["readout"],
      { enabled: boolean; safe: boolean; shortcut?: boolean },
      string,
    ]
  >([
    [
      "its files for this head still being read: off, with its reason, its keys and its place kept",
      "reading",
      { enabled: false, safe: false, shortcut: true },
      "Merging waits until its files are read.",
    ],
    [
      "its files for this head could not be read",
      "failed",
      { enabled: true, safe: false },
      "Squash-merges 1 commit into main without its files shown. Production isn't touched until you release.",
    ],
    [
      "its files for this head read",
      "read",
      { enabled: true, safe: true },
      "Squash-merges 1 commit into main. Production isn't touched until you release.",
    ],
  ])("%s", (_case, readout, primary, consequence) => {
    const review = changeReview(change({ readout }));
    expect(review.primary).toEqual({ label: "Merge", ...primary });
    expect(review.consequence).toBe(consequence);
  });

  it("keeps no keys for a change behind main while it is read: it never takes them", () => {
    const review = changeReview(
      change({
        pull: pull({ mergeBase: "old", baseSha: "new" }),
        behindBy: 2,
        readout: "reading",
      }),
    );
    expect(review.primary).toEqual({ label: "Merge", enabled: false, safe: false });
    expect(review.consequence).toBe("Merging waits until its files are read.");
  });

  it("keeps a blocked change's reason while its files are read", () => {
    expect(
      changeReview(change({ pull: pull({ mergeability: "conflicting" }), readout: "reading" }))
        .consequence,
    ).toBe("Merging waits until the conflict is resolved.");
  });
});

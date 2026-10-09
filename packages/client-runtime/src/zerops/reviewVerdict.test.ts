// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import { describe, expect, it } from "vite-plus/test";

import { isRecipeProposal } from "./projectFlow.ts";
import { recipeReach, type RecipeReach } from "./recipeReach.ts";
import { RELEASE_NOTHING_NEW_ON_MAIN, type ReleaseGate } from "./release.ts";

/** HQ's rule refusing the person the release, in its words (`releasePermission`). */
const NOT_A_RELEASER = {
  allowed: false,
  reason: "You need at least Basic user access to this project's production to release it.",
} as const;
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

function change(over: Partial<ChangeReviewInput> = {}): ChangeReviewInput {
  return {
    pull: {
      number: 2,
      kind: "code",
      baseBranch: "main",
      mergeability: "mergeable",
      merged: false,
      mergedAt: undefined,
      behind: false,
    },
    mateName: "Nova",
    readout: "read",
    commits: 1,
    downstream: { production: true, stage: true },
    offered: { merge: true, close: true },
    now: NOW,
    ...over,
  };
}

const pull = (over: Partial<ChangeReviewInput["pull"]>) => ({ ...change().pull, ...over });

describe("change and release reviews use HQ's release verdict", () => {
  it.each([true, false])(
    "keeps HQ's release gate when allowed is %s; Merge has ended",
    (allowed) => {
      const gate: ReleaseGate = allowed
        ? { allowed: true }
        : { allowed: false, reason: RELEASE_NOTHING_NEW_ON_MAIN };
      const dialog = releaseReview({
        tag: "v0.1.1",
        gate,
        permission: { allowed: true },
        changes: allowed ? 1 : 0,
        onStage: undefined,
        services: ["app"],
        replaces: { kind: "release", tag: "v0.1.0" },
        outcome: { kind: "offered" },
        now: NOW,
      });
      const footer = changeReview(
        change({
          pull: pull({ merged: true }),
          waiting: { count: allowed ? 1 : 0, live: "v0.1.0" },
          release: gate,
        }),
      );
      expect(dialog.verdict.title).toBe(allowed ? "Ready to release" : "Nothing to release");
      expect(footer.primary).toBeUndefined();
      if (!allowed) {
        expect(footer.consequence).toBe(RELEASE_NOTHING_NEW_ON_MAIN);
        expect(footer.verdict.why).not.toContain("waits for production");
      }
    },
  );
});

describe("changeReview: the verdict comes first (R2)", () => {
  it.each<[string, Partial<ChangeReviewInput>, Record<string, unknown>]>([
    [
      "ready: grey, not green",
      { commits: 3 },
      {
        state: "ready",
        tone: "quiet",
        title: "Ready to merge",
        why: "No conflicts with main · 3 commits",
        fix: undefined,
      },
    ],
    // Review of pass 42: a draft read "Ready to merge", its words written for
    // an earlier head as if they were current.
    [
      "a draft: its words are not of its latest work",
      { pull: pull({ ready: false }), commits: 3 },
      {
        state: "ready",
        tone: "quiet",
        title: "Draft",
        why: "Nova hasn't described its latest work · No conflicts with main · 3 commits",
        fix: undefined,
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
      { pull: pull({ behind: true }) },
      {
        state: "behind-clean",
        tone: "attention",
        title: "Behind main",
        why: "main moved on since Nova branched · it still merges cleanly",
      },
    ],
    [
      "nothing main does not have",
      { pull: pull({ mergeability: "empty" }) },
      {
        state: "empty",
        tone: "quiet",
        title: "Nothing to merge",
        why: "main already has all of it",
        fix: undefined,
      },
    ],
    [
      "HQ not having said yet whether it merges",
      { pull: pull({ mergeability: "checking" }) },
      {
        state: "checking",
        tone: "busy",
        title: "Checking whether it merges cleanly",
        why: "HQ works it out after every push",
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
      "Merge main into it, resolve the conflicts, and deliver it again.",
    ],
    [
      "a branch main moved past",
      { pull: pull({ behind: true }) },
      "update it",
      "Merge main into it, check it still works, and deliver it again.",
    ],
  ])("hands %s to the Mate, the problem written out", (_name, over, verb, ask) => {
    const fix = changeReview(change(over)).verdict.fix;
    expect(fix?.verb).toBe(verb);
    expect(fix?.problem.ask).toBe(ask);
    expect(fix?.problem.what).toMatch(/#2/u);
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
      "HQ not having said yet whether it merges",
      { pull: pull({ mergeability: "checking" }) },
      "Merging waits until HQ knows it merges cleanly.",
      { enabled: false, safe: false },
    ],
    [
      // Amber: still pressable, never pressed for the person — no focus, no ⌘↵.
      "behind main but clean",
      { pull: pull({ behind: true }) },
      "Squash-merges 1 commit into main, on top of changes it wasn't checked with. Production isn't touched until you release.",
      { enabled: true, safe: false },
    ],
  ])("%s", (_name, over, consequence, primary) => {
    const review = changeReview(change(over));
    expect(review.consequence).toBe(consequence);
    expect(review.primary).toMatchObject({ label: "Merge", ...primary });
  });

  it.each<[string, Partial<ChangeReviewInput>, string, string | undefined]>([
    [
      "production waiting: says so, and nothing more to press",
      {
        pull: pull({ merged: true, mergedAt: minutesAgo(1) }),
        waiting: { count: 1, live: "v0.1.0" },
        release: { allowed: true },
      },
      "Production still serves v0.1.0 until you release.",
      undefined,
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
    [
      "no production, whatever a stale gate allows: still nothing to press",
      {
        pull: pull({ merged: true, mergedAt: minutesAgo(1) }),
        downstream: { production: false, stage: true },
        release: { allowed: true },
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
    ...over,
  });
  const recipe = (over: Partial<ChangeReviewInput["pull"]> = {}) =>
    pull({ kind: "recipe", ...over });
  const merged = recipe({ merged: true, mergedAt: minutesAgo(0) });
  /** Where production waits for a release: a code change's review would offer it now. */
  const releasable = { release: { allowed: true }, waiting: { count: 2, live: "v0.1.0" } } as const;

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

  // zcp's second kind of recipe change modifies a tier — a host's verticalAutoscaling — rather
  // than adding one, and a person merges it: what the stage has keeps the scale it was made with.
  // A review reads no title, so it reads as any recipe change; it is no recipe proposal.
  it("a scale change to a tier says the stage's services stay as they are, and merges as any change", () => {
    const reached = recipeReach({
      files: [{ filename: "3 — Stage/import.yaml" }],
      environments: [{ tier: "stage" }],
    });
    const review = changeReview(change({ pull: recipe(), recipe: reached, ...releasable }));
    expect(review.consequence).toBe(
      "Squash-merges 1 commit into main. The stage gets any service added to its recipe, created empty; the services it has stay as they are.",
    );
    expect(review.primary).toEqual({ label: "Merge", enabled: true, safe: true });
    expect(
      isRecipeProposal({ kind: "recipe", title: "Mate: app's scale in the group recipe" }),
    ).toBe(false);
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
    permission: { allowed: true },
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
      "not a releaser, in HQ's words for who may",
      { gate: NOT_A_RELEASER, permission: NOT_A_RELEASER },
      {
        state: "release-blocked",
        tone: "attention",
        title: "Only releasers can release",
        why: "You need at least Basic user access to this project's production to release it",
      },
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
        why: "Production runs it · tagged 3 minutes ago",
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
      { gate: NOT_A_RELEASER, permission: NOT_A_RELEASER },
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
    comparisons: { leaving: "known", comingBack: "known" },
    tag: "v0.1.55",
    nextTag: "v0.1.58",
    live: "v0.1.57",
    services: ["app", "api"],
    permission: { allowed: true },
    press: { kind: "idle" },
    outcome: { kind: "offered" },
    now: NOW,
    ...over,
  };
}

describe("rollbackReview: roll back gets the same review, naming where it goes back to", () => {
  it.each(["leaving", "comingBack"] as const)(
    "waits for the %s comparison before offering confirmation",
    (side) => {
      const review = rollbackReview(
        rollback({ comparisons: { leaving: "known", comingBack: "known", [side]: "reading" } }),
      );
      expect(review.primary?.enabled).toBe(false);
      expect(review.verdict).toMatchObject({ state: "checking", title: "Comparing the rollback" });
    },
  );

  it("keeps a reported comparison failure distinct from a pending read", () => {
    const review = rollbackReview(
      rollback({ comparisons: { leaving: "failed", comingBack: "known" } }),
    );
    expect(review.primary?.enabled).toBe(true);
    expect(review.verdict.state).toBe("rollback-ready");
  });

  it("keeps following an accepted rollback while its comparisons change", () => {
    const review = rollbackReview(
      rollback({
        comparisons: { leaving: "reading", comingBack: "reading" },
        press: { kind: "done" },
        outcome: { kind: "releasing" },
      }),
    );
    expect(review.verdict.state).toBe("rolling-back");
  });

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
      "not a releaser, in HQ's words for who may",
      { permission: NOT_A_RELEASER },
      {
        state: "rollback-blocked",
        tone: "attention",
        title: "Only releasers can roll back",
        why: "You need at least Basic user access to this project's production to release it",
      },
      "Production keeps running v0.1.57.",
    ],
    [
      // HQ asks its rule again at the press, so a rule not asked yet holds nothing back.
      "while who may is not known yet",
      { permission: undefined },
      {
        state: "rollback-ready",
        tone: "quiet",
        title: "Goes back to v0.1.55",
        why: "Production runs v0.1.57 now",
      },
      "Tags main as v0.1.58 with v0.1.55's commits. Production redeploys app and api from them.",
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
      // The tag existing is not production running it: HQ's deploy still decides.
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
        why: "Production runs its commits again, as v0.1.58 · tagged 3 minutes ago",
      },
      "Production runs v0.1.55's commits again, as v0.1.58.",
    ],
    [
      "HQ refused it, or its deploy failed",
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
      "a newer release sits above the one it made",
      {
        press: { kind: "done" },
        outcome: { kind: "superseded", by: "v0.1.59", live: "v0.1.59" },
      },
      {
        state: "rollback-superseded",
        tone: "quiet",
        title: "v0.1.59 was tagged after v0.1.58",
        why: "Production runs v0.1.59",
      },
      "The project's line in the menu follows v0.1.59.",
    ],
    [
      "tagged, and HQ ended its follow without confirming a landing",
      { press: { kind: "done" }, outcome: { kind: "stalled", at: minutesAgo(34) } },
      {
        state: "rollback-stalled",
        tone: "attention",
        title: "Deploy status unknown for v0.1.58",
        why: "HQ couldn't confirm how the deploy ended",
      },
      "Check the deploy in Zerops.",
    ],
    [
      "refused",
      { press: { kind: "refused", reason: "HQ would not create the tag." } },
      { state: "rollback-refused", tone: "attention", why: "HQ would not create the tag." },
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

describe("changeReview: Merge, offered by HQ's rule (T8a)", () => {
  // A verb this person cannot finish is not offered (guide 0.8); the foot says what it takes, in
  // HQ's own refusal words.
  it("offers no Merge where merge_change is not offered, and says what it takes", () => {
    const review = changeReview(change({ offered: { merge: false, close: false } }));
    expect(review.verdict.state).toBe("ready");
    expect(review.primary).toBeUndefined();
    expect(review.consequence).toBe(
      "You need at least Basic user access to one of this project's Zerops projects to do this.",
    );
  });

  // Its facts not held yet — HQ has not placed the projects: Merge stands where it will, unpressed.
  it("holds Merge back while HQ's rule has not been asked", () => {
    const review = changeReview(change({ offered: undefined }));
    expect(review.primary).toMatchObject({ label: "Merge", enabled: false, safe: false });
    expect(review.consequence).toBe(
      "Squash-merges 1 commit into main. Production isn't touched until you release.",
    );
  });
});

describe("changeReview: Close without merging, the review its one confirmation (T8a)", () => {
  const ASKED = { kind: "asked" } as const;

  it.each<[string, Partial<ChangeReviewInput>, { label: string; enabled: boolean } | undefined]>([
    [
      "beside Merge, where close_change is offered",
      {},
      { label: "Close without merging…", enabled: true },
    ],
    ["nowhere close_change is not offered", { offered: { merge: true, close: false } }, undefined],
    // An owner or admin closes what they may not merge (an application with no project left).
    [
      "to a person who may close and not merge",
      { offered: { merge: false, close: true } },
      { label: "Close without merging…", enabled: true },
    ],
    ["while Merge runs", { press: { kind: "running" } }, undefined],
    [
      "after a refused Merge",
      { press: { kind: "refused", reason: "No." } },
      { label: "Close without merging…", enabled: true },
    ],
    ["on a merged change", { pull: pull({ merged: true, mergedAt: minutesAgo(1) }) }, undefined],
    ["on a closed one", { pull: pull({ state: "closed" }) }, undefined],
  ])("is offered %s", (_name, over, secondary) => {
    expect(changeReview(change(over)).secondary).toEqual(secondary);
  });

  it("asks before it closes, in the review's own words, never for ⌘↵", () => {
    const review = changeReview(change({ close: ASKED }));
    expect(review.verdict).toMatchObject({
      state: "close-confirm",
      tone: "attention",
      title: "Close #2 without merging?",
      why: "Nothing of it reaches main",
    });
    expect(review.consequence).toBe("Closes #2 for good; Nova's branch stays as it is.");
    expect(review.primary).toEqual({ label: "Close without merging", enabled: true, safe: false });
    expect(review.secondary).toEqual({ label: "Keep it open", enabled: true });
  });

  it.each<[string, ChangeReviewInput["close"], Record<string, unknown>, boolean, boolean]>([
    [
      "closing",
      { kind: "running" },
      { state: "closing", tone: "busy", title: "Closing #2", why: "Without merging" },
      false,
      false,
    ],
    [
      "refused: a deliberate press tries again",
      { kind: "refused", reason: "This change is merged or closed already." },
      {
        state: "close-refused",
        tone: "attention",
        title: "Not closed",
        why: "This change is merged or closed already.",
      },
      true,
      true,
    ],
  ])("while pressed: %s", (_name, close, verdict, enabled, keepOpen) => {
    const review = changeReview(change({ close }));
    expect(review.verdict).toMatchObject(verdict);
    expect(review.primary).toEqual({ label: "Close without merging", enabled, safe: false });
    expect(review.secondary !== undefined).toBe(keepOpen);
  });

  it("says it was closed once its close is done, before HQ's stream has it", () => {
    const review = changeReview(change({ close: { kind: "done" } }));
    expect(review.verdict).toMatchObject({
      state: "closed",
      tone: "done",
      title: "Closed without merging",
      why: "You closed it; its branch is still there",
    });
    expect(review.consequence).toBe("It never reached main; nothing merges from here.");
    expect(review.primary).toBeUndefined();
    expect(review.secondary).toBeUndefined();
  });
});

describe("changeReview: a change closed without merging", () => {
  it("says so, and offers no Merge", () => {
    const review = changeReview(change({ pull: pull({ state: "closed", merged: false }) }));
    expect(review.verdict).toMatchObject({
      state: "closed",
      tone: "done",
      title: "Closed without merging",
      why: "Somebody closed it; its branch is still there",
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
        pull: pull({ behind: true }),
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

it.each([undefined, true, false])(
  "an empty review offers only Close with merge permission %s",
  (merge) => {
    const model = changeReview(
      change({
        pull: pull({ mergeability: "empty" }),
        commits: 20,
        offered: merge === undefined ? undefined : { merge, close: true },
      }),
    );
    expect(model.verdict.state).toBe("empty");
    expect(model.consequence).toBe("Nothing to deliver: main already has this.");
    expect(model.primary).toBeUndefined();
    expect(model.secondary?.label).toBe(merge === undefined ? undefined : "Close without merging…");
  },
);

// The one question after the first code merge of an application with no production (MODEL §3,
// §9.3 – §9.5, §9.11): said once, in the review of the merge this person just finished, never on a
// reopen, never to somebody with nothing to answer it with.
describe("changeReview: where should it run (the one question)", () => {
  const both = { stage: true, production: true };
  const first = (over: Partial<ChangeReviewInput> = {}): ChangeReviewInput =>
    change({
      pull: pull({ merged: true, mergedAt: minutesAgo(1), firstCodeMerge: true }),
      press: { kind: "done" },
      downstream: { production: false, stage: false },
      productionHeld: false,
      addable: both,
      ...over,
    });

  it("asks it once, with an equal button for each tier the person may add", () => {
    expect(changeReview(first()).question).toEqual({
      text: "Your code is on main. Where should it run?",
      options: [
        { tier: "stage", label: "Add stage" },
        { tier: "production", label: "Add production" },
      ],
      dismiss: "Not now",
    });
  });

  it.each<[string, Partial<ChangeReviewInput>]>([
    [
      "it was not the application's first code merge",
      { pull: pull({ merged: true, firstCodeMerge: false }) },
    ],
    ["HQ said nothing of it being the first (an old row)", { pull: pull({ merged: true }) }],
    [
      "the merge is a recipe's",
      { pull: pull({ merged: true, kind: "recipe", firstCodeMerge: true }) },
    ],
    ["a production is held in any state (being made, failed)", { productionHeld: true }],
    ["the review is reopened: nobody pressed Merge here", { press: { kind: "idle" } }],
    ["the merge is still running", { press: { kind: "running" } }],
    ["the person may add neither", { addable: { stage: false, production: false } }],
    ["no tier is offered at all", { addable: undefined }],
  ])("asks nothing when %s", (_name, over) => {
    expect(changeReview(first(over)).question).toBeUndefined();
  });

  it.each<[string, ChangeReviewInput["addable"], ReadonlyArray<string>]>([
    ["only a stage may be added", { stage: true, production: false }, ["Add stage"]],
    ["only a production may be added", { stage: false, production: true }, ["Add production"]],
  ])("offers just the tier left where %s", (_name, addable, labels) => {
    expect(
      changeReview(first({ addable })).question?.options.map((option) => option.label),
    ).toEqual(labels);
  });
});

describe("changeReview: repository pipeline evidence", () => {
  const head = "a".repeat(40);
  const pipeline = (
    requirement: "required" | "advisory" | "unknown",
    state: "running" | "failed" | "passed" | "unknown",
  ) => ({
    head,
    requirements: "known" as const,
    checks: [{ id: "unit", name: "Unit tests", requirement, state }],
  });
  it.each([
    ["required", "running", false, "checks-running"],
    ["required", "failed", false, "checks-failed"],
    ["required", "unknown", false, "checks-unknown"],
    ["required", "passed", true, "ready"],
    ["advisory", "running", true, "ready"],
    ["advisory", "failed", true, "ready"],
    ["unknown", "failed", true, "ready"],
  ] as const)(
    "%s %s checks only hold Merge when the repository requires them",
    (requirement, state, enabled, verdict) => {
      const review = changeReview(
        change({ pull: pull({ headSha: head, pipeline: pipeline(requirement, state) }) }),
      );
      expect(review.verdict.state).toBe(verdict);
      expect(review.primary?.enabled).toBe(enabled);
      expect(review.pipeline?.checks).toEqual(pipeline(requirement, state).checks);
      if (!enabled) {
        expect(review.verdict.why).toContain("Unit tests");
        expect(review.primary?.safe).toBe(false);
      }
    },
  );
  it("does not infer known requirements or passed checks from a ready clean change", () => {
    const review = changeReview(change({ pull: pull({ ready: true }) }));
    expect(review.pipeline?.why).toBe("Repository check requirements are unknown.");
    expect(review.pipeline?.checks).toEqual([]);
    expect(review.primary?.enabled).toBe(true);
  });
  it("distinguishes a repository with no checks from unknown requirements", () => {
    const review = changeReview(
      change({
        pull: pull({ headSha: head, pipeline: { head, requirements: "known", checks: [] } }),
      }),
    );
    expect(review.pipeline?.why).toBe("No pipeline checks.");
    expect(review.primary?.enabled).toBe(true);
  });

  it.each(["passed", "failed", "running"] as const)(
    "does not apply %s checks from a different head",
    (state) => {
      const review = changeReview(
        change({ pull: pull({ headSha: "b".repeat(40), pipeline: pipeline("required", state) }) }),
      );
      expect(review.pipeline?.why).toBe("Pipeline checks have not been read for this head.");
      expect(review.pipeline?.checks[0]).toMatchObject({
        name: "Unit tests",
        requirement: "unknown",
        state: "unknown",
      });
      expect(review.primary?.enabled).toBe(true);
    },
  );
});

describe("changeReview: competing terminal outcomes and permissions", () => {
  it.each([
    [
      "merged",
      { merged: true },
      { kind: "refused", reason: "Already merged." },
      { kind: "running" },
    ],
    ["merged", { merged: true }, { kind: "idle" }, { kind: "done" }],
    ["closed", { state: "closed" }, { kind: "running" }, { kind: "asked" }],
    ["closed", { state: "closed" }, { kind: "done" }, { kind: "idle" }],
  ] as const)(
    "owner-proven %s ends pending or outdated local presses",
    (state, over, press, close) => {
      const review = changeReview(change({ pull: pull(over), press, close }));
      expect(review.verdict.state).toBe(state);
      expect(review.primary).toBeUndefined();
      expect(review.secondary).toBeUndefined();
      expect(review.verdict.why).not.toContain("You closed it");
    },
  );
  it.each([false, undefined] as const)(
    "cannot confirm or retry Close after permission becomes %s",
    (close) => {
      for (const kind of ["asked", "refused"] as const) {
        const review = changeReview(
          change({
            close: kind === "asked" ? { kind } : { kind, reason: "No access." },
            offered: close === undefined ? undefined : { merge: true, close },
          }),
        );
        expect(review.primary?.enabled).toBe(false);
        expect(review.primary?.safe).toBe(false);
        expect(review.consequence).toContain(
          close === undefined ? "HQ has not said" : "HQ no longer offers",
        );
      }
    },
  );
});

import {
  RELEASE_CHECKING,
  RELEASE_NOTHING_MERGED,
  RELEASE_NOTHING_NEW_ON_MAIN,
} from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  PUT_LIVE_LATER,
  PUT_LIVE_NO_ANSWER,
  PUT_LIVE_PATIENCE,
  putLiveAddress,
  putLiveCreation,
  putLiveHoldsRelease,
  putLiveLines,
  putLiveMergeGate,
  putLiveDeadline,
  putLiveNext,
  putLiveOffered,
  putLiveProgress,
  putLiveReleased,
  putLiveSettle,
  putLiveSheet,
  putLiveStep,
  startPutLive,
  type PutLiveChange,
  type PutLiveFacts,
  type PutLiveMergePull,
  type PutLiveRun,
} from "./putLive.logic";

const change = (over: Partial<PutLiveChange> = {}): PutLiveChange => ({
  repository: "app",
  number: 1,
  title: "Shop front: list, filter and order products",
  head: "a".repeat(40),
  merged: false,
  ...over,
});

const facts = (over: Partial<PutLiveFacts> = {}): PutLiveFacts => ({
  production: undefined,
  gate: { allowed: false, reason: "There is no production to release to." },
  releases: [],
  ...over,
});

const start = (over: Partial<PutLiveChange> = {}): PutLiveRun =>
  startPutLive({ orgId: "o1", groupId: "g1", project: "Tea Shop", change: change(over) });

describe("putting an app live", () => {
  it("Putting an app live for the first time creates production and releases it in one step", () => {
    // Pressed once on a merged change: production is made, then released, then it runs.
    let run = start({ merged: true });
    expect(run.phase).toBe("creating");
    expect(putLiveNext(run, facts())).toEqual({ kind: "wait" });

    run = putLiveStep(run, { kind: "created", productionId: "p-prod" });
    // HQ holds it and offers the release: the run releases without asking again.
    expect(putLiveNext(run, facts({ production: "p-prod", gate: { allowed: true } }))).toEqual({
      kind: "release",
    });

    run = putLiveStep(run, { kind: "released", tag: "v0.1.0" });
    expect(run.phase).toBe("releasing");
    expect(
      putLiveNext(
        run,
        facts({ production: "p-prod", releases: [{ tag: "v0.1.0", standing: undefined }] }),
      ),
    ).toEqual({ kind: "wait" });
    expect(
      putLiveNext(
        run,
        facts({ production: "p-prod", releases: [{ tag: "v0.1.0", standing: "live" }] }),
      ),
    ).toEqual({ kind: "live" });

    run = putLiveStep(run, { kind: "live", at: 1_000 });
    expect(run.phase).toBe("live");
    expect(putLiveProgress(run)).toEqual({ title: "Tea Shop is live", step: "Released v0.1.0" });
  });

  it("merges a change still waiting first, then makes production", () => {
    const run = start();
    expect(run.phase).toBe("merging");
    const merged = putLiveStep(run, { kind: "merged" });
    expect(merged.phase).toBe("creating");
    expect(merged.change?.merged).toBe(true);
  });

  it("releases only to the production it made, once HQ holds it", () => {
    const run = putLiveStep(start({ merged: true }), { kind: "created", productionId: "p-prod" });
    // Another production that came up meanwhile is not this run's.
    expect(putLiveNext(run, facts({ production: "p-other", gate: { allowed: true } }))).toEqual({
      kind: "wait",
    });
    // HQ still checking: waiting will change it.
    expect(
      putLiveNext(
        run,
        facts({ production: "p-prod", gate: { allowed: false, reason: RELEASE_CHECKING } }),
      ),
    ).toEqual({ kind: "wait" });
    // Nothing merged to release: waiting will not change it.
    expect(
      putLiveNext(
        run,
        facts({ production: "p-prod", gate: { allowed: false, reason: RELEASE_NOTHING_MERGED } }),
      ),
    ).toEqual({ kind: "failed", words: RELEASE_NOTHING_MERGED });
  });

  it.each([
    [
      "its deploy failed",
      { standing: "deploy-failed" as const },
      "v0.1.0 didn't go out: its deploy failed.",
    ],
    [
      "HQ refused it",
      { standing: undefined, verdict: "refused", detail: "Production is locked." },
      "Production is locked.",
    ],
  ])("says a release that did not go out when %s, with the cause", (_case, row, words) => {
    const run = putLiveStep(
      putLiveStep(start({ merged: true }), { kind: "created", productionId: "p-prod" }),
      { kind: "released", tag: "v0.1.0" },
    );
    expect(putLiveNext(run, facts({ releases: [{ tag: "v0.1.0", ...row }] }))).toEqual({
      kind: "failed",
      words,
    });
  });

  it("stops at the step that failed, with the one action that fixes it, and tries that step again", () => {
    const refusedMerge = putLiveStep(start(), { kind: "failed", words: "main moved on" });
    expect(refusedMerge.phase).toBe("failed");
    expect(refusedMerge.failure).toEqual({ words: "main moved on", action: "see-code" });

    const failedCreate = putLiveStep(start({ merged: true }), {
      kind: "failed",
      words: "Zerops needs more credit.",
    });
    expect(failedCreate.failure?.action).toBe("again");
    expect(putLiveProgress(failedCreate)).toEqual({
      title: "Tea Shop isn't live yet",
      step: "Zerops needs more credit.",
    });
    const again = putLiveStep(failedCreate, { kind: "again" });
    expect(again.phase).toBe("creating");
    expect(again.failure).toBeUndefined();

    // A production half made is finished from its project: never a second one from here.
    expect(
      putLiveStep(start({ merged: true }), { kind: "failed", words: "x", halfMade: true }).failure
        ?.action,
    ).toBe("project");

    // A release that did not go out is made again once production takes one.
    const released = putLiveStep(
      putLiveStep(start({ merged: true }), { kind: "created", productionId: "p-prod" }),
      { kind: "released", tag: "v0.1.0" },
    );
    const retried = putLiveStep(putLiveStep(released, { kind: "failed", words: "x" }), {
      kind: "again",
    });
    expect(retried).toMatchObject({ phase: "creating", productionId: "p-prod", tag: undefined });
  });

  it.each([
    ["merging", true],
    ["creating", true],
    ["releasing", false],
    ["live", false],
    ["failed", false],
  ] as const)(
    "offers no release door while it makes production, only once it releases (%s)",
    (phase, held) => {
      expect(putLiveHoldsRelease({ phase })).toBe(held);
    },
  );

  it("never moves a finished run back", () => {
    const live: PutLiveRun = { ...start({ merged: true }), phase: "live", tag: "v0.1.0" };
    expect(putLiveStep(live, { kind: "failed", words: "late" })).toBe(live);
    expect(putLiveStep(live, { kind: "merged" })).toBe(live);
  });
});

describe("Put it live is offered", () => {
  it.each([
    ["no production and the person may add one", false, { production: true }, true],
    ["a production held in any state", true, { production: true }, false],
    ["the person may not add production", false, { production: false }, false],
    ["HQ has not said what the person may add", false, undefined, false],
  ])("with %s: %s", (_case, productionHeld, addable, offered) => {
    expect(putLiveOffered({ productionHeld, addable })).toBe(offered);
  });
});

describe("the Put it live sheet", () => {
  it("says what goes live in the change's title and at most three plain lines, and where", () => {
    const sheet = putLiveSheet({
      project: "Tea Shop",
      changes: [
        {
          title: "Shop front",
          description: [
            "A small, phone-friendly shop front.",
            "",
            "## What it does",
            "- **Add** a recipe with a title and steps",
            "- **Browse** every recipe, listed A to Z",
            "- Search by `ingredient`",
            "- Tick off ingredients while you cook",
          ].join("\n"),
        },
      ],
      recipe: "present",
    });
    expect(sheet.title).toBe("Put Tea Shop live");
    expect(sheet.what).toEqual({
      title: "Shop front",
      lines: [
        "Add a recipe with a title and steps",
        "Browse every recipe, listed A to Z",
        "Search by ingredient",
      ],
    });
    expect(sheet.where.name).toBe("Production");
    expect(sheet.later).toBe(PUT_LIVE_LATER);
    expect(sheet.button).toBe("Put it live");
    expect(sheet.hold).toBeUndefined();
  });

  it.each([
    ["loading", "Reading how the project runs…"],
    ["absent", "The project has no setup files for production yet: ask the Mate to add them."],
    ["unreadable", "The project's setup files can't be read right now."],
  ] as const)("holds its button while the production recipe is %s, saying why", (recipe, hold) => {
    expect(putLiveSheet({ project: "Tea Shop", changes: [{ title: "x" }], recipe }).hold).toBe(
      hold,
    );
  });

  it("asked from the project, lists what is merged by title, and waits while nothing is", () => {
    const many = putLiveSheet({
      project: "Tea Shop",
      changes: [{ title: "Search" }, { title: "Browse" }, { title: "Add" }, { title: "Start" }],
      recipe: "present",
    });
    expect(many.what).toEqual({ title: "4 changes", lines: ["Search", "Browse", "Add"] });
    expect(many.hold).toBeUndefined();
    const none = putLiveSheet({ project: "Tea Shop", changes: [], recipe: "present" });
    expect(none.what).toEqual({ title: "Nothing is merged to put live yet.", lines: [] });
    // The button's line says the way on, never the sheet's own line again.
    expect(none.hold).toBe("Merge a change first: what is merged goes live.");
  });

  it("stands in for what goes live while what is merged is read, saying no reading words", () => {
    const sheet = putLiveSheet({ project: "Tea Shop", changes: undefined, recipe: "present" });
    expect(sheet.what).toBeUndefined();
    expect(sheet.hold).toBeUndefined();
    expect(sheet.title).toBe("Put Tea Shop live");
  });

  it("takes plain sentences where a description has no list, and skips pictures and code", () => {
    expect(
      putLiveLines(
        [
          "![home](https://hq/x.png)",
          "```",
          "npm start",
          "```",
          "Adds [search](https://x) to the box.",
        ].join("\n"),
      ),
    ).toEqual(["Adds search to the box."]);
    expect(putLiveLines(undefined)).toEqual([]);
  });
});

describe("the one wait row and the live card", () => {
  it("replaces its step words in place as the run moves on", () => {
    const run = start();
    expect(putLiveProgress(run)).toEqual({
      title: "Putting Tea Shop live",
      step: "Merging the change",
    });
    expect(putLiveProgress({ ...run, phase: "creating" }).step).toBe("Making production");
    expect(putLiveProgress({ ...run, phase: "releasing", tag: "v0.1.0" }).step).toBe(
      "Releasing v0.1.0",
    );
  });

  it("says when it was released: just now, then its age", () => {
    const live: PutLiveRun = { ...start(), phase: "live", tag: "v0.1.0", liveAt: 0 };
    expect(putLiveReleased(live, 20_000)).toBe("Released v0.1.0 · just now");
    expect(putLiveReleased(live, 5 * 60_000)).toBe("Released v0.1.0 · 5 min ago");
  });

  it("leads with production's address, without its scheme", () => {
    expect(
      putLiveAddress([{ url: "https://app-abcd-3000.prg1.zerops.app/" }, { url: "https://b" }]),
    ).toEqual({
      url: "https://app-abcd-3000.prg1.zerops.app/",
      host: "app-abcd-3000.prg1.zerops.app",
    });
    expect(putLiveAddress([])).toBeUndefined();
  });
});

describe("Put it live merges what the review would merge", () => {
  const HEAD = "a".repeat(40);
  const pull = (over: Partial<PutLiveMergePull> = {}): PutLiveMergePull => ({
    number: 1,
    headSha: HEAD,
    kind: "code",
    baseBranch: "main",
    mergeability: "mergeable",
    merged: false,
    mergedAt: undefined,
    behind: false,
    ...over,
  });
  const checks = (state: "running" | "failed" | "unknown" | "passed") => ({
    pipeline: {
      head: HEAD,
      requirements: "known" as const,
      checks: [{ id: "c1", name: "tests", requirement: "required" as const, state }],
    },
  });

  it.each([
    ["ready to merge", pull(), { kind: "open" }],
    ["merged already", pull({ merged: true, mergeability: "checking" }), { kind: "open" }],
    ["behind main, still merging cleanly", pull({ behind: true }), { kind: "open" }],
    ["its required checks passed", pull(checks("passed")), { kind: "open" }],
    [
      "its required checks failed",
      pull(checks("failed")),
      { kind: "held", words: "Required checks failed" },
    ],
    [
      "its required checks still run",
      pull(checks("running")),
      { kind: "held", words: "Required checks running" },
    ],
    [
      "its required checks unknown",
      pull(checks("unknown")),
      { kind: "held", words: "Required checks unknown" },
    ],
    [
      "HQ still works out whether it merges",
      pull({ mergeability: "checking" }),
      { kind: "held", words: "Checking whether it merges cleanly" },
    ],
    [
      "main already has all of it",
      pull({ mergeability: "empty" }),
      { kind: "held", words: "Nothing to merge" },
    ],
    [
      "it no longer merges cleanly",
      pull({ mergeability: "conflicting" }),
      { kind: "held", words: "Behind main" },
    ],
  ] as const)(
    "Put it live is one press only where the review would merge the change: %s",
    (_case, read, gate) => {
      expect(putLiveMergeGate({ pull: read })).toEqual(gate);
    },
  );
});

describe("a write that never answers", () => {
  it.each([
    ["merging", start(), "again"],
    ["creating", start({ merged: true }), "project"],
  ] as const)(
    "a write that rejects while %s ends the run in its failed state, with the way on",
    async (_phase, run, action) => {
      const event = await putLiveSettle(
        () => Promise.reject(new Error("socket hang up")),
        () => ({ kind: "merged" }),
        action,
      );
      const failed = putLiveStep(run, event);
      expect(failed.phase).toBe("failed");
      expect(failed.failure?.action).toBe(action);
      expect(failed.failure?.words).toBe(PUT_LIVE_NO_ANSWER);
      expect(failed.failure?.detail).toBe("socket hang up");
    },
  );

  it("tries a merge that rejected again from the same step", async () => {
    const failed = putLiveStep(
      start(),
      await putLiveSettle(
        () => Promise.reject(new Error("socket hang up")),
        () => ({ kind: "merged" }),
        "again",
      ),
    );
    expect(putLiveStep(failed, { kind: "again" }).phase).toBe("merging");
  });

  it("hands on what an answered write came to", async () => {
    expect(
      await putLiveSettle(
        () => Promise.resolve({ ok: true }),
        () => ({ kind: "merged" }),
        "again",
      ),
    ).toEqual({ kind: "merged" });
  });
});

describe("after production is made, the release it waits for", () => {
  const made = putLiveStep(start({ merged: true }), {
    kind: "created",
    productionId: "p-prod",
    at: 0,
  });
  const late = PUT_LIVE_PATIENCE + 1;
  const held = (reason: string) => ({ allowed: false as const, reason });

  it.each([
    [
      "someone else's release is under way: it waits for that one",
      facts({ production: "p-prod", gate: held("Releasing v0.1.0…") }),
      0,
      { kind: "adopt", tag: "v0.1.0" },
    ],
    [
      "someone else's release went live meanwhile: it is live on it",
      facts({
        production: "p-prod",
        gate: held(RELEASE_NOTHING_NEW_ON_MAIN),
        releases: [{ tag: "v0.1.0", standing: "live" }],
      }),
      0,
      { kind: "adopt", tag: "v0.1.0" },
    ],
    [
      "a repository's token is unusable: it stops with the fix",
      facts({
        production: "p-prod",
        gate: held("A repository has no usable token. Replace the token before releasing."),
      }),
      0,
      {
        kind: "failed",
        words: "A repository has no usable token. Replace the token before releasing.",
        action: "project",
      },
    ],
    [
      "HQ has not said whether it offers the release: it waits",
      facts({ production: "p-prod", gate: held("Release offer is unknown.") }),
      PUT_LIVE_PATIENCE,
      { kind: "wait" },
    ],
    [
      "HQ still has not said once its patience ran out: it stops, to try again",
      facts({ production: "p-prod", gate: held("Release offer is unknown.") }),
      late,
      {
        kind: "failed",
        words: "HQ didn't say whether production can take a release.",
        action: "again",
      },
    ],
    [
      "HQ still checks once its patience ran out: it stops with HQ's words",
      facts({ production: "p-prod", gate: held(RELEASE_CHECKING) }),
      late,
      { kind: "failed", words: RELEASE_CHECKING, action: "again" },
    ],
    [
      "HQ never listed the new production: it stops, to try again",
      facts(),
      late,
      { kind: "failed", words: "HQ hasn't listed the new production yet.", action: "again" },
    ],
  ] as const)("with %s", (_case, read, now, next) => {
    expect(putLiveNext(made, read, now)).toEqual(next);
  });

  it("waits no longer than its patience, from production or the last Try again", () => {
    expect(putLiveDeadline(made)).toBe(PUT_LIVE_PATIENCE);
    const again = putLiveStep(putLiveStep(made, { kind: "failed", words: "x" }), {
      kind: "again",
      at: 5_000,
    });
    expect(putLiveDeadline(again)).toBe(5_000 + PUT_LIVE_PATIENCE);
  });

  it("says a release it waits for as someone else's", () => {
    const adopted = putLiveStep(made, { kind: "released", tag: "v0.1.0", adopted: true });
    expect(adopted.phase).toBe("releasing");
    expect(putLiveProgress(adopted).step).toBe("Waiting for v0.1.0, already on its way");
  });
});

describe("while Put it live makes production", () => {
  const SLOW = "Zerops hasn't shown the new services ready after 10 minutes.";
  const accepted = putLiveStep(start({ merged: true }), {
    kind: "accepted",
    productionId: "p-prod",
  });
  const offered = facts({ production: "p-prod", gate: { allowed: true } });

  it("production made by Put it live counts from the moment the project exists", () => {
    expect(accepted).toMatchObject({ phase: "creating", productionId: "p-prod" });
    // Its services are still awaited: nothing is released to them yet, and the creation's own
    // bounded wait is what counts down.
    expect(putLiveNext(accepted, offered, PUT_LIVE_PATIENCE * 10)).toEqual({ kind: "wait" });
    expect(putLiveDeadline(accepted)).toBeUndefined();

    const made = putLiveStep(
      accepted,
      putLiveCreation(
        {
          kind: "ran",
          outcome: {
            ok: true,
            projectId: "p-prod",
            serviceName: undefined,
            awaitingAgent: false,
            deployments: [],
          },
        },
        7_000,
      ),
    );
    expect(made).toMatchObject({ phase: "creating", productionId: "p-prod", since: 7_000 });
    expect(putLiveDeadline(made)).toBe(7_000 + PUT_LIVE_PATIENCE);
    expect(putLiveNext(made, offered, 7_000)).toEqual({ kind: "release" });
  });

  it("Put it live never waits on production's services beyond its patience: it offers Retry and the project", () => {
    const event = putLiveCreation(
      {
        kind: "ran",
        outcome: {
          ok: false,
          projectId: "p-prod",
          failedStep: { kind: "await-ready", withAgent: false },
          error: SLOW,
          uncertain: true,
        },
      },
      9_000,
    );
    const stopped = putLiveStep(accepted, event);
    expect(stopped.phase).toBe("failed");
    expect(stopped.failure).toEqual({ words: SLOW, action: "again", alsoProject: true });
    expect(putLiveProgress(stopped)).toEqual({ title: "Tea Shop isn't live yet", step: SLOW });

    // Try again goes on from the production it made, to its release: never a second production.
    const again = putLiveStep(stopped, { kind: "again", at: 10_000 });
    expect(again).toMatchObject({ phase: "creating", productionId: "p-prod", since: 10_000 });
    expect(putLiveNext(again, offered, 10_000)).toEqual({ kind: "release" });
  });

  it.each([
    [
      "refused before anything was made",
      { kind: "refused", reason: "Zerops needs more credit." },
      { kind: "failed", words: "Zerops needs more credit." },
    ],
    [
      "refused without a reason",
      { kind: "refused", reason: null },
      { kind: "failed", words: "Production couldn't be made." },
    ],
    [
      "stopped at its registration, the project made",
      {
        kind: "ran",
        outcome: {
          ok: false,
          projectId: "p-prod",
          failedStep: { kind: "register" },
          error: "HQ refused it.",
        },
      },
      { kind: "failed", words: "HQ refused it.", halfMade: true },
    ],
    [
      "unsure whether the project was made",
      {
        kind: "ran",
        outcome: {
          ok: false,
          projectId: undefined,
          failedStep: { kind: "create-project", name: "Tea Shop", tagList: [] },
          error: "Zerops did not confirm the project was created.",
          uncertain: true,
        },
      },
      {
        kind: "failed",
        words: "Zerops did not confirm the project was created.",
        halfMade: true,
      },
    ],
    [
      "stopped before any project",
      {
        kind: "ran",
        outcome: {
          ok: false,
          projectId: undefined,
          failedStep: { kind: "create-project", name: "Tea Shop", tagList: [] },
          error: "Name taken.",
        },
      },
      { kind: "failed", words: "Name taken.", halfMade: false },
    ],
  ] as const)(
    "says what production's creation came to, never making a production twice (%s)",
    (_case, made, event) => {
      expect(putLiveCreation(made as Parameters<typeof putLiveCreation>[0], 1)).toEqual(event);
    },
  );
});

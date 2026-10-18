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
  putLiveSheetUnderWay,
  putLiveDeadline,
  putLiveNext,
  putLiveProgress,
  putLiveLandedAt,
  putLiveReleased,
  putLiveResumed,
  putLiveSettle,
  putLiveSheet,
  putLiveStep,
  startPutLive,
  type PutLiveEvent,
  type PutLiveFacts,
  type PutLiveFlowFacts,
  type PutLiveRun,
} from "./putLive.logic";

const facts = (over: Partial<PutLiveFacts> = {}): PutLiveFacts => ({
  production: undefined,
  gate: { allowed: false, reason: "There is no production to release to." },
  releases: [],
  ...over,
});

const start = (): PutLiveRun => startPutLive({ orgId: "o1", groupId: "g1", project: "Tea Shop" });

describe("putting an app live", () => {
  it("Putting an app live for the first time creates production and releases it in one step", () => {
    // Pressed once: production is made, then what is merged released to it, then it runs.
    let run = start();
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

  it("releases only to the production it made, once HQ holds it", () => {
    const run = putLiveStep(start(), { kind: "created", productionId: "p-prod" });
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
    const run = putLiveStep(putLiveStep(start(), { kind: "created", productionId: "p-prod" }), {
      kind: "released",
      tag: "v0.1.0",
    });
    expect(putLiveNext(run, facts({ releases: [{ tag: "v0.1.0", ...row }] }))).toEqual({
      kind: "failed",
      words,
    });
  });

  it("stops at the step that failed, with the one action that fixes it, and tries that step again", () => {
    const failedCreate = putLiveStep(start(), {
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
      putLiveStep(start(), { kind: "failed", words: "x", halfMade: true }).failure?.action,
    ).toBe("project");

    // A release that did not go out is made again once production takes one.
    const released = putLiveStep(
      putLiveStep(start(), { kind: "created", productionId: "p-prod" }),
      { kind: "released", tag: "v0.1.0" },
    );
    const retried = putLiveStep(putLiveStep(released, { kind: "failed", words: "x" }), {
      kind: "again",
    });
    expect(retried).toMatchObject({ phase: "creating", productionId: "p-prod", tag: undefined });
  });

  it.each([
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
    const live: PutLiveRun = { ...start(), phase: "live", tag: "v0.1.0" };
    expect(putLiveStep(live, { kind: "failed", words: "late" })).toBe(live);
    expect(putLiveStep(live, { kind: "again" })).toBe(live);
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

// A run 2 follow-up: right after the person's only press the sheet said "It's already on its
// way.", as if somebody had pressed before them.
describe("the Put it live sheet once a run is under way", () => {
  const sheet = putLiveSheet({ project: "Tea Shop", changes: [{ title: "x" }], recipe: "present" });

  it("says it is going live once pressed here, never that it was already on its way", () => {
    const pressed = putLiveSheetUnderWay(sheet, { pressedHere: true });
    expect(pressed.button).toBe("Putting it live…");
    expect(pressed.busy).toBe(true);
    expect(pressed.hold).toBeUndefined();
  });

  it("says a run somebody started before it opened is already on its way", () => {
    const before = putLiveSheetUnderWay(sheet, { pressedHere: false });
    expect(before.hold).toBe("It's already on its way.");
    expect(before.button).toBe("Put it live");
  });
});

describe("the one wait row and the live card", () => {
  it("replaces its step words in place as the run moves on", () => {
    const run = start();
    expect(putLiveProgress(run)).toEqual({
      title: "Putting Tea Shop live",
      step: "Making production",
    });
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

describe("a write that never answers", () => {
  it.each([["creating", start(), "project"]] as const)(
    "a write that rejects while %s ends the run in its failed state, with the way on",
    async (_phase, run, action) => {
      const event = await putLiveSettle(
        () => Promise.reject(new Error("socket hang up")),
        (): PutLiveEvent => ({ kind: "created", productionId: "p-prod" }),
        action,
      );
      const failed = putLiveStep(run, event);
      expect(failed.phase).toBe("failed");
      expect(failed.failure?.action).toBe(action);
      expect(failed.failure?.words).toBe(PUT_LIVE_NO_ANSWER);
      expect(failed.failure?.detail).toBe("socket hang up");
    },
  );

  it("tries a write that rejected again from the same step", async () => {
    const failed = putLiveStep(
      start(),
      await putLiveSettle(
        () => Promise.reject(new Error("socket hang up")),
        (): PutLiveEvent => ({ kind: "created", productionId: "p-prod" }),
        "again",
      ),
    );
    expect(putLiveStep(failed, { kind: "again" }).phase).toBe("creating");
  });

  it("hands on what an answered write came to", async () => {
    expect(
      await putLiveSettle(
        () => Promise.resolve({ ok: true }),
        (): PutLiveEvent => ({ kind: "created", productionId: "p-prod" }),
        "again",
      ),
    ).toEqual({ kind: "created", productionId: "p-prod" });
  });
});

describe("after production is made, the release it waits for", () => {
  const made = putLiveStep(start(), {
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
  const accepted = putLiveStep(start(), {
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

  it("counts how long the step under way has run, from that step's start", () => {
    const pressed = startPutLive({
      orgId: "o1",
      groupId: "g1",
      project: "Tea Shop",
      at: 1_000,
    });
    expect(putLiveProgress(pressed)).toEqual({
      title: "Putting Tea Shop live",
      step: "Making production",
      since: 1_000,
    });
    // Production's project taken is the same step going on: its clock keeps counting.
    const known = putLiveStep(pressed, { kind: "accepted", productionId: "p-prod" }, 6_000);
    expect(putLiveProgress(known).since).toBe(1_000);
    const live = putLiveStep(
      putLiveStep(
        putLiveStep(known, { kind: "created", productionId: "p-prod" }, 7_000),
        {
          kind: "released",
          tag: "v0.1.0",
        },
        8_000,
      ),
      { kind: "live", at: 9_000 },
      9_000,
    );
    expect(putLiveProgress(live).since).toBeUndefined();
  });
});

describe("after a reload, how Put it live ended", () => {
  const read = (over: Partial<PutLiveFlowFacts> = {}): PutLiveFlowFacts => ({
    ...facts({ production: "p-prod", gate: { allowed: true } }),
    inFlight: undefined,
    suggestion: "v0.1.0",
    ...over,
  });
  const resumed = (input: {
    readonly current?: PutLiveRun | undefined;
    readonly kept?: string | undefined;
    readonly facts: PutLiveFlowFacts | undefined;
  }) =>
    putLiveResumed({
      orgId: "o1",
      groupId: "g1",
      project: "Tea Shop",
      current: input.current,
      kept: input.kept,
      facts: input.facts,
    });

  it("production the person's Put it live made but never released says so, with Release one press away", () => {
    const shown = resumed({ kept: "p-prod", facts: read() });
    expect(shown.kind).toBe("stopped");
    if (shown.kind !== "stopped") return;
    expect(putLiveProgress(shown.run)).toEqual({
      title: "Tea Shop isn't live yet",
      step: "Production is made; v0.1.0 isn't released yet.",
    });
    expect(shown.run.failure?.action).toBe("release");
    // Release goes on from the production it made: it releases, it never makes another.
    const pressed = putLiveStep(shown.run, { kind: "again", at: 5 });
    expect(pressed).toMatchObject({ phase: "creating", productionId: "p-prod", since: 5 });
    expect(putLiveNext(pressed, read(), 5)).toEqual({ kind: "release" });
  });

  it("says a release whose deploy failed as that, with Release again", () => {
    const shown = resumed({
      kept: "p-prod",
      facts: read({
        releases: [{ tag: "v0.1.0", standing: "deploy-failed" }],
        suggestion: "v0.1.1",
      }),
    });
    expect(shown.kind === "stopped" ? putLiveProgress(shown.run).step : shown.kind).toBe(
      "v0.1.0 didn't go out: its deploy failed.",
    );
  });

  it("holds the strip's room while the project's flow is read, and says nothing it did not make", () => {
    expect(resumed({ kept: "p-prod", facts: undefined })).toEqual({ kind: "reading" });
    expect(resumed({ facts: undefined })).toEqual({ kind: "none" });
    expect(resumed({ facts: read() })).toEqual({ kind: "none" });
  });

  it.each([
    ["production is gone", read({ production: undefined })],
    ["another production stands", read({ production: "p-other" })],
  ])("forgets an attempt whose production it no longer finds (%s)", (_case, flow) => {
    expect(resumed({ kept: "p-prod", facts: flow })).toEqual({ kind: "forget" });
  });

  it("a release that went live while the page reloaded ends on the live card", () => {
    const shown = resumed({
      kept: "p-prod",
      facts: read({ releases: [{ tag: "v0.1.0", standing: "live" }] }),
    });
    expect(shown).toMatchObject({ kind: "follow", run: { phase: "live", tag: "v0.1.0" } });
  });

  it("A release started from the conversation is followed there to the live address", () => {
    const flow = read({
      inFlight: "v0.1.1",
      releases: [{ tag: "v0.1.1", standing: undefined, taggedAt: "1970-01-01T00:00:02.000Z" }],
    });
    const shown = resumed({ facts: flow });
    expect(shown).toMatchObject({
      kind: "follow",
      run: { phase: "releasing", tag: "v0.1.1", productionId: "p-prod", stepAt: 2_000 },
    });
    if (shown.kind !== "follow") return;
    expect(putLiveProgress(shown.run).step).toBe("Releasing v0.1.1");
    const live = putLiveNext(shown.run, read({ releases: [{ tag: "v0.1.1", standing: "live" }] }));
    expect(live).toEqual({ kind: "live" });
  });

  // The run's roll back read "Putting Tea Shop live", then "Released v0.1.2": a tag nobody asked
  // for. A roll back says what it goes back to, wherever a release says it is going live.
  it("A roll back followed in the conversation says it rolls back, and what it went back to", () => {
    const flow = read({
      inFlight: "v0.1.2",
      releases: [
        { tag: "v0.1.2", standing: undefined, rollbackOf: "v0.1.0" },
        { tag: "v0.1.1", standing: "live" },
        { tag: "v0.1.0", standing: undefined },
      ],
    });
    const shown = resumed({ facts: flow });
    if (shown.kind !== "follow") throw new Error("follow expected");
    expect(putLiveProgress(shown.run)).toMatchObject({
      title: "Rolling back to v0.1.0",
      step: "Releasing v0.1.2",
    });
    const live = putLiveStep(shown.run, { kind: "live", at: 0 }, 0);
    expect(putLiveReleased(live, 3 * 60_000)).toBe("Rolled back to v0.1.0 · 3 min ago");
    // One that went live while the page was away says it the same way.
    const away = resumed({
      kept: "p-prod",
      facts: read({ releases: [{ tag: "v0.1.2", standing: "live", rollbackOf: "v0.1.0" }] }),
    });
    if (away.kind !== "follow") throw new Error("follow expected");
    expect(putLiveReleased(away.run, 0)).toBe("Rolled back to v0.1.0");
  });

  // The run's conversation read "Released v0.1.2 · just now" for minutes: the age counted from when
  // this page saw it live, and a page that came back to it saw it live again. It counts from the
  // release itself, as its review's "released 3 minutes ago" does.
  it("A followed release's live card counts its age from the release, never from when the page saw it", () => {
    const tagged = "1970-01-01T00:02:00.000Z";
    const flow = read({
      inFlight: "v0.1.1",
      releases: [{ tag: "v0.1.1", standing: undefined, taggedAt: tagged }],
    });
    const shown = resumed({ facts: flow });
    if (shown.kind !== "follow") throw new Error("follow expected");
    const landed = read({ releases: [{ tag: "v0.1.1", standing: "live", taggedAt: tagged }] });
    const seenAt = 9 * 60_000;
    const live = putLiveStep(
      shown.run,
      { kind: "live", at: putLiveLandedAt(shown.run, landed, seenAt) },
      seenAt,
    );
    expect(putLiveReleased(live, 10 * 60_000)).toBe("Released v0.1.1 · 8 min ago");
    // Live while the page was away: the same age, from the same release.
    const away = resumed({ kept: "p-prod", facts: landed });
    if (away.kind !== "follow") throw new Error("follow expected");
    expect(putLiveReleased(away.run, 10 * 60_000)).toBe("Released v0.1.1 · 8 min ago");
    // A release with no time of its own counts from when it was seen.
    const untimed = read({ releases: [{ tag: "v0.1.1", standing: "live" }] });
    expect(putLiveLandedAt(shown.run, untimed, seenAt)).toBe(seenAt);
  });

  it("a stopped or finished row gives way to what happened since, never stays behind it", () => {
    const stopped = resumed({ kept: "p-prod", facts: read() });
    if (stopped.kind !== "stopped") throw new Error("stopped expected");
    // Released meanwhile from the project: the row follows that release.
    expect(
      resumed({ current: stopped.run, kept: "p-prod", facts: read({ inFlight: "v0.1.0" }) }),
    ).toMatchObject({ kind: "follow", run: { phase: "releasing", tag: "v0.1.0" } });
    // Live meanwhile: the row is the live card.
    expect(
      resumed({
        current: stopped.run,
        facts: read({ releases: [{ tag: "v0.1.0", standing: "live" }] }),
      }),
    ).toMatchObject({ kind: "follow", run: { phase: "live", tag: "v0.1.0" } });
    const live: PutLiveRun = { ...stopped.run, phase: "live", tag: "v0.1.0", failure: undefined };
    expect(
      resumed({ current: live, facts: read({ releases: [{ tag: "v0.1.0", standing: "live" }] }) }),
    ).toEqual({ kind: "none" });
    // A run under way is the host's to drive.
    expect(
      resumed({ current: { ...live, phase: "releasing" }, facts: read({ inFlight: "v0.1.1" }) }),
    ).toEqual({ kind: "none" });
  });
});

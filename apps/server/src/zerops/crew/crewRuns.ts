/**
 * crewRuns — a run (PRD §2.4, §4.8; ARCHITECTURE §4 *Run*): the person's
 * *Start*, which lets the crew start its own turns within a budget, a time
 * limit and a share of the usage window, each of which may be *No limit*.
 *
 * - **Start** records the run as running; *Pause*, *Resume*, *Stop* and
 *   *Finish* move it (`runTransition`). Whoever starts or resumes one then
 *   advances the crew (`crewRunFlow.advanceAll`). A limit reached pauses it with that
 *   limit as its reason; a dispatch admission refused pauses it as
 *   `refused`, with admission's words.
 * - **Pausing or stopping** interrupts every running crew turn: each ends
 *   with its WIP commit, so a run that stops leaves every copy committed.
 * - **Meters.** Spend is every crew turn's `totalCostUsd` while the run is
 *   on; time is wall time running, paused time excluded, recorded at every
 *   tick; usage is the fullest window of the crewmates' logins, from the
 *   provider's rate-limit events.
 * - **Budget.** A crew session starts with `maxBudgetUsd` = what the run has
 *   left (`crewDirectory.memberFor`); *No limit* never sets it.
 * - **Finish** is *Finish* pressed or the lead's `crew_finish`. Crewmates are
 *   standing, so their copies stay for the next run.
 *
 * @module crewRuns
 */
import {
  CommandId,
  CrewRunOptions,
  ThreadId,
  type CrewRun,
  type CrewRunReason,
  type SpiEvent,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import {
  asRefusal,
  DEFAULT_CREW_LOGIN,
  failureWords,
  principalUser,
  refuse,
  requireApplied,
  type AppliedCrew,
  type CrewCore,
} from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { runTransition, type RunEvent } from "./crewMachines.ts";
import { remember } from "./crewNotes.ts";
import type { CrewRunRow } from "./CrewStore.ts";

/** Why a turn stopped by a run's pause goes on when the run does. */
export const RUN_PAUSED = "The run was paused, which stopped your last turn; it goes on now.";

/** How often a running run records its time and checks its limits. */
const RUN_TICK = Duration.seconds(15);

const HOUR_MS = 3_600_000;

const decodeOptions = Schema.decodeUnknownOption(CrewRunOptions);

export const runOptionsOf = (run: CrewRunRow): CrewRunOptions | undefined =>
  Option.getOrUndefined(decodeOptions(run.options));

export interface RunLimitFacts {
  readonly budgetUsd: number | null;
  readonly spentUsd: number;
  readonly elapsedMs: number;
  readonly timeLimitHours: number | "unlimited";
  readonly usagePercent: number | null;
  readonly stopAtUsagePercent: number | null;
}

/** The limit a run has reached, budget first; `undefined` while it may go on. */
export const runLimitReached = (facts: RunLimitFacts): "budget" | "time" | "usage" | undefined =>
  facts.budgetUsd !== null && facts.spentUsd >= facts.budgetUsd
    ? "budget"
    : facts.timeLimitHours !== "unlimited" && facts.elapsedMs >= facts.timeLimitHours * HOUR_MS
      ? "time"
      : facts.stopAtUsagePercent !== null &&
          facts.usagePercent !== null &&
          facts.usagePercent >= facts.stopAtUsagePercent
        ? "usage"
        : undefined;

const amount = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

/**
 * Why a paused run cannot go on under these limits, in words the section
 * shows; `undefined` when it may. A limit that paused it and still stands
 * must be raised, or set to *No limit*, first.
 */
export const resumeRefusal = (facts: RunLimitFacts): string | undefined => {
  switch (runLimitReached(facts)) {
    case "budget":
      return `The run has spent its $${amount(facts.budgetUsd ?? 0)} budget — raise it or choose No limit to resume`;
    case "time":
      return `The run has used its ${amount(facts.timeLimitHours === "unlimited" ? 0 : facts.timeLimitHours)} h — raise the time limit or choose No limit to resume`;
    case "usage":
      return `The usage window is at ${amount(facts.usagePercent ?? 0)} % — raise the stop or turn it off to resume`;
    case undefined:
      return undefined;
  }
};

/**
 * A passed check goes to the lead's review first: a run is on, its landing
 * is *The lead lands after its review*, and the crew has a lead.
 */
export const leadReviews = (applied: AppliedCrew): boolean => {
  const run = applied.run;
  return (
    (run?.state === "running" || run?.state === "paused") &&
    runOptionsOf(run)?.landing === "lead" &&
    [...applied.members.values()].some((row) => row.kind === "lead")
  );
};

/** Wall time the run has run, paused time excluded, at `nowMs`. */
const elapsedMs = (core: CrewCore, run: CrewRunRow, nowMs: number): number =>
  run.wallMs +
  (run.state === "running" && core.memory.runningSince !== null
    ? Math.max(0, nowMs - core.memory.runningSince)
    : 0);

/** The fullest usage window of the crewmates' logins; `null` before any reading. */
export const usagePercentOf = (core: CrewCore, applied: AppliedCrew): number | null => {
  const readings = [...applied.members.values()].flatMap((row) => {
    const reading = core.memory.usage.get(row.login ?? DEFAULT_CREW_LOGIN);
    return reading === undefined ? [] : [reading];
  });
  return readings.length === 0 ? null : Math.max(...readings);
};

/** The run as the feed shows it; `null` before the crew's first run. */
export const runView = (core: CrewCore, applied: AppliedCrew, nowMs: number): CrewRun | null => {
  const run = applied.run;
  const options = run === undefined ? undefined : runOptionsOf(run);
  if (run === undefined || options === undefined) return null;
  return {
    id: run.run,
    state: run.state,
    reason: run.reason as CrewRunReason | null,
    reasonDetail: run.reasonDetail,
    startedBy: run.startedBy,
    startedAt: run.startedAt,
    elapsedMs: elapsedMs(core, run, nowMs),
    spentUsd: run.spentUsd,
    usagePercent: usagePercentOf(core, applied),
    options,
  };
};

/** Writes the run's new state and logs it. */
const saveRun = (core: CrewCore, run: CrewRunRow) =>
  Effect.gen(function* () {
    yield* asRefusal(core.store.putRun(run));
    yield* asRefusal(
      core.store.appendLog({
        crew: CREW_ID,
        run: run.run,
        at: yield* core.now,
        kind: `run-${run.state}`,
        payload: { reason: run.reason, detail: run.reasonDetail },
      }),
    );
    yield* asRefusal(core.reload);
    yield* core.changed;
  });

/** Moves the run by `event`, or refuses in the words of what stopped it. */
const moved = (run: CrewRunRow | undefined, event: RunEvent) => {
  const from =
    run === undefined || run.state === "stopped" || run.state === "finished" ? "none" : run.state;
  const step = runTransition(from, event);
  if (step.kind === "moved") return Effect.succeed(step.to);
  return Effect.fail(
    refuse(
      "wrong-state",
      step.kind === "held"
        ? "the crewmates' copies are still being made"
        : from === "none"
          ? "no run is on"
          : `the run is ${from}`,
    ),
  );
};

/** Interrupts every running crew turn; each ends with its WIP commit. */
const interruptCrewTurns = (core: CrewCore, applied: AppliedCrew) =>
  Effect.gen(function* () {
    const now = yield* core.now;
    for (const stint of applied.stints) {
      if (stint.retiredAt !== null || !core.memory.working.has(stint.threadId)) continue;
      core.memory.carryOn.set(stint.threadId, RUN_PAUSED);
      yield* asRefusal(
        core.orchestration.dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.make(`crew:run-stop:${stint.threadId}:${now}`),
          threadId: ThreadId.make(stint.threadId),
          createdAt: now,
        }),
      );
    }
  });

/** Records the running run's time and pauses it at a limit; the section's meters move with it. */
export const checkRunLimits = (core: CrewCore) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    const run = applied?.run;
    const options = run === undefined ? undefined : runOptionsOf(run);
    if (applied === undefined || run?.state !== "running" || options === undefined) return;
    const nowMs = yield* Clock.currentTimeMillis;
    const reached = runLimitReached({
      budgetUsd: run.budgetUsd,
      spentUsd: run.spentUsd,
      elapsedMs: elapsedMs(core, run, nowMs),
      timeLimitHours: options.timeLimitHours,
      usagePercent: usagePercentOf(core, applied),
      stopAtUsagePercent: options.stopAtUsagePercent,
    });
    if (reached !== undefined) return yield* pauseRun(core, reached);
    yield* asRefusal(core.store.putRun({ ...run, wallMs: elapsedMs(core, run, nowMs) }));
    core.memory.runningSince = nowMs;
    yield* asRefusal(core.reload);
    yield* core.changed;
  });

/** The tick that keeps a running run's time and limits; one per engine, forked on demand. */
export const ensureRunTick = (core: CrewCore) =>
  Effect.suspend(() => {
    if (core.memory.runTick) return Effect.void;
    core.memory.runTick = true;
    return core.background(
      checkRunLimits(core).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            core.memory.lastError = failureWords(error);
          }),
        ),
        Effect.repeat(Schedule.spaced(RUN_TICK)),
        Effect.asVoid,
      ),
    );
  });

/** After a restart a running run counts its time again from now; the downtime is not its time. */
export const runOnAfterRestart = (core: CrewCore) =>
  Effect.gen(function* () {
    if ((yield* core.applied)?.run?.state !== "running") return;
    core.memory.runningSince = yield* Clock.currentTimeMillis;
    yield* ensureRunTick(core);
  });

export const startRun = (core: CrewCore, principal: TurnPrincipal, options: CrewRunOptions) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    yield* moved(applied.run, {
      type: "start",
      admitted: true,
      lanesReady: core.memory.progress.size === 0,
    });
    const now = yield* core.now;
    yield* saveRun(core, {
      run: `run-${yield* core.uuid}`,
      crew: CREW_ID,
      startedBy: principalUser(principal),
      budgetUsd: options.budgetUsd === "unlimited" ? null : options.budgetUsd,
      spentUsd: 0,
      options,
      reasonDetail: null,
      state: "running",
      reason: null,
      startedAt: now,
      wallMs: 0,
      waitingMs: 0,
      finishedAt: null,
    });
    core.memory.runningSince = yield* Clock.currentTimeMillis;
    yield* ensureRunTick(core);
    yield* restartSessions(core, (yield* core.applied) ?? applied);
  });

/** Pauses the running run: the person's press, a limit, or a refused dispatch. */
export const pauseRun = (core: CrewCore, reason: CrewRunReason, detail: string | null = null) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    const run = applied?.run;
    if (applied === undefined || run?.state !== "running") return;
    const nowMs = yield* Clock.currentTimeMillis;
    yield* saveRun(core, {
      ...run,
      state: "paused",
      reason,
      reasonDetail: detail,
      wallMs: elapsedMs(core, run, nowMs),
    });
    core.memory.runningSince = null;
    yield* interruptCrewTurns(core, applied);
  });

/** The run the command names, which must be the crew's latest. */
const requireRun = (core: CrewCore, runId: string) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    if (applied.run?.run !== runId) return yield* refuse("wrong-state", "that run is over");
    return { applied, run: applied.run };
  });

export const pressPause = (core: CrewCore, runId: string) =>
  Effect.gen(function* () {
    const { run } = yield* requireRun(core, runId);
    yield* moved(run, { type: "pause", reason: "person" });
    yield* pauseRun(core, "person");
  });

/**
 * *Resume*, with the limits the person raised: a limit given replaces the
 * run's, an absent one keeps it. A limit that still stands refuses, naming
 * it. The crew's sessions follow the new budget from their next start.
 */
export const resumeRun = (
  core: CrewCore,
  input: {
    readonly runId: string;
    readonly budgetUsd?: CrewRunOptions["budgetUsd"] | undefined;
    readonly timeLimitHours?: CrewRunOptions["timeLimitHours"] | undefined;
    readonly stopAtUsagePercent?: CrewRunOptions["stopAtUsagePercent"] | undefined;
  },
) =>
  Effect.gen(function* () {
    const { applied, run } = yield* requireRun(core, input.runId);
    yield* moved(run, { type: "resume", admitted: true });
    const current = runOptionsOf(run);
    if (current === undefined) return yield* refuse("io", "the run's options could not be read");
    const options: CrewRunOptions = {
      ...current,
      ...(input.budgetUsd === undefined ? {} : { budgetUsd: input.budgetUsd }),
      ...(input.timeLimitHours === undefined ? {} : { timeLimitHours: input.timeLimitHours }),
      ...(input.stopAtUsagePercent === undefined
        ? {}
        : { stopAtUsagePercent: input.stopAtUsagePercent }),
    };
    const budgetUsd = options.budgetUsd === "unlimited" ? null : options.budgetUsd;
    const refusal = resumeRefusal({
      budgetUsd,
      spentUsd: run.spentUsd,
      elapsedMs: run.wallMs,
      timeLimitHours: options.timeLimitHours,
      usagePercent: usagePercentOf(core, applied),
      stopAtUsagePercent: options.stopAtUsagePercent,
    });
    if (refusal !== undefined) return yield* refuse("wrong-state", refusal);
    yield* saveRun(core, {
      ...run,
      state: "running",
      reason: null,
      reasonDetail: null,
      budgetUsd,
      options,
    });
    core.memory.runningSince = yield* Clock.currentTimeMillis;
    yield* ensureRunTick(core);
    yield* restartSessions(core, (yield* core.applied) ?? applied);
  });

export const stopRun = (core: CrewCore, runId: string) =>
  Effect.gen(function* () {
    const { applied, run } = yield* requireRun(core, runId);
    yield* moved(run, { type: "stop" });
    const nowMs = yield* Clock.currentTimeMillis;
    yield* saveRun(core, {
      ...run,
      state: "stopped",
      wallMs: elapsedMs(core, run, nowMs),
      finishedAt: yield* core.now,
    });
    core.memory.runningSince = null;
    yield* interruptCrewTurns(core, applied);
  });

/**
 * *Finish*, or the lead's `crew_finish`: the run ends. Crewmates are
 * standing, so there are no copies to clean up and it goes straight on to
 * finished.
 */
export const finishRun = (core: CrewCore, runId: string) =>
  Effect.gen(function* () {
    const { run } = yield* requireRun(core, runId);
    const wallMs = elapsedMs(core, run, yield* Clock.currentTimeMillis);
    const finishing = { ...run, wallMs, state: yield* moved(run, { type: "finish" }) };
    core.memory.runningSince = null;
    yield* saveRun(core, finishing);
    yield* saveRun(core, {
      ...finishing,
      state: yield* moved(finishing, { type: "cleaned" }),
      finishedAt: yield* core.now,
    });
  });

/**
 * A turn's own cost. The CLI reports a session's cumulative total
 * (`total_cost_usd`, across its resumes too), so a turn costs what the total
 * rose by since the thread's last turn; a turn is counted once, whatever
 * delivers its end again. A session whose earlier total was never kept
 * counts nothing for this turn and keeps its total from now on.
 */
export const turnCost = (
  core: CrewCore,
  threadId: string,
  event: Extract<SpiEvent, { readonly type: "turn.completed" }>,
) =>
  Effect.gen(function* () {
    const total = event.payload.totalCostUsd;
    const turnId = event.turnId;
    if (total === undefined || turnId === undefined || core.memory.costedTurns.has(turnId)) {
      return 0;
    }
    const seen = core.memory.costSeen.get(threadId) ?? 0;
    const run = (yield* core.applied)?.run?.run ?? null;
    yield* remember(core, { kind: "turn-cost", threadId, turnId, total }, run);
    if (core.memory.costUnknown.delete(threadId)) return 0;
    return Math.max(0, total - seen);
  });

/**
 * A running session keeps the budget cap it started with, so a run whose
 * budget changes restarts its crew's sessions: an idle one now, a working
 * one when its turn ends. The next turn resumes the same conversation under
 * the new cap.
 */
const restartSessions = (core: CrewCore, applied: AppliedCrew) =>
  Effect.gen(function* () {
    const now = yield* core.now;
    for (const stint of applied.stints) {
      if (stint.retiredAt !== null) continue;
      if (core.memory.working.has(stint.threadId)) {
        core.memory.sessionRestart.add(stint.threadId);
        continue;
      }
      yield* core.orchestration
        .dispatch({
          type: "thread.session.stop",
          commandId: CommandId.make(`crew:budget:${stint.threadId}:${now}`),
          threadId: ThreadId.make(stint.threadId),
          createdAt: now,
        })
        .pipe(Effect.ignore);
    }
  });

/** A crew turn's cost, counted while a run is on; the budget reached pauses it. */
export const recordRunSpend = (core: CrewCore, costUsd: number) =>
  Effect.gen(function* () {
    const run = (yield* core.applied)?.run;
    if (costUsd <= 0) return;
    if (run?.state !== "running" && run?.state !== "paused") return;
    yield* asRefusal(core.store.putRun({ ...run, spentUsd: run.spentUsd + costUsd }));
    yield* asRefusal(core.reload);
    yield* checkRunLimits(core);
  });

/** The provider's usage windows for a login: the fullest one, 100 while a window refuses requests. */
export const recordUsage = (
  core: CrewCore,
  event: Extract<SpiEvent, { readonly type: "account.rate-limits.updated" }>,
) =>
  Effect.gen(function* () {
    const login = event.providerInstanceId;
    if (login === undefined) return;
    const windows = event.payload.limits.windows.map((window) => window.usedPercent);
    const percent = event.payload.blocked !== undefined ? 100 : Math.max(0, ...windows);
    if (windows.length === 0 && event.payload.blocked === undefined) return;
    core.memory.usage.set(login, percent);
    yield* checkRunLimits(core);
  });

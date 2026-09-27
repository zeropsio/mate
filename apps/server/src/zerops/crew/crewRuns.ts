/**
 * crewRuns — a run (PRD §2.4, §4.8; ARCHITECTURE §4 *Run*): the person's
 * *Start*, which lets the crew start its own turns within a budget, a time
 * limit and a share of the usage window, each of which may be *No limit*.
 *
 * - **Start** records the run as running; *Pause*, *Resume*, *Stop* and
 *   *Finish* move it (`runTransition`). Whoever starts or resumes one then
 *   pumps the crew (`crewTasks.pumpAll`). A limit reached pauses it with that
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
  principalUser,
  refuse,
  requireApplied,
  type AppliedCrew,
  type CrewCore,
} from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { runTransition, type RunEvent } from "./crewMachines.ts";
import type { CrewRunRow } from "./CrewStore.ts";

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
            core.memory.lastError = error.message;
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

export const resumeRun = (core: CrewCore, runId: string) =>
  Effect.gen(function* () {
    const { run } = yield* requireRun(core, runId);
    yield* moved(run, { type: "resume", admitted: true });
    yield* saveRun(core, { ...run, state: "running", reason: null, reasonDetail: null });
    core.memory.runningSince = yield* Clock.currentTimeMillis;
    yield* ensureRunTick(core);
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

/** A crew turn's cost, counted while a run is on; the budget reached pauses it. */
export const recordRunSpend = (core: CrewCore, costUsd: number | undefined) =>
  Effect.gen(function* () {
    const run = (yield* core.applied)?.run;
    if (costUsd === undefined || costUsd <= 0) return;
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

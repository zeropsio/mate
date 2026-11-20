/**
 * A crew run's life and limits: start, pause, resume, stop and finish, its clock, and the lead's wakes and replies.
 *
 * @module crew/engine/decide.run
 */
import {
  type CrewCommand,
  type CrewRunOptions,
  type CrewRunReason,
  type RunId,
} from "@t3tools/contracts";
import { runTransition } from "../crewMachines.ts";
import { answerCard, questionCard, reviewCard, type SentCard } from "./cards.ts";
import {
  isFree,
  isWorking,
  leadOf,
  membersInOrder,
  openTaskOf,
  questionKey,
  reviewKey,
  runElapsedMs,
  runningRun,
  tasksInOrder,
  usagePercentOf,
  type CrewState,
  type LeadWake,
  type MemberRecord,
  type RunRecord,
} from "./state.ts";
import { wrongState, type Builder, userOf, crewAs, dispatchPrincipal } from "./decide.step.ts";
import {
  RUN_PAUSED,
  STOPPED_MIDWAY,
  deliver,
  sendTurn,
  rotateSession,
  continueTask,
} from "./decide.turns.ts";

/** The lead's wakes per run, and the least time between two of the engine's own. */
export const LEAD_WAKES_MAX = 30;

export const LEAD_WAKE_SPACING_MS = 2 * 60_000;
const HOUR_MS = 3_600_000;

const nextWake = (state: CrewState): { wake: LeadWake; card: SentCard } | undefined => {
  for (const task of tasksInOrder(state)) {
    if (task.state === "review" && state.lead.woken[reviewKey(task)] === undefined) {
      return {
        wake: { key: reviewKey(task), kind: "review", taskId: task.id },
        card: reviewCard(task),
      };
    }
    const question = task.report?.question;
    const key = questionKey(task);
    if (
      task.state === "blocked" &&
      state.members[task.owner]?.kind !== "lead" &&
      question != null &&
      state.lead.woken[key] === undefined &&
      state.lead.escalated[key] === undefined
    ) {
      return {
        wake: { key, kind: "question", taskId: task.id },
        card: questionCard(task, question),
      };
    }
  }
  return undefined;
};

/**
 * Wakes a free lead for the next review or question, in a running run, at most 30 times; the
 * engine's own wakes stand two minutes apart (a person's Start or Resume wakes it at once).
 */
export const wakeLead = (b: Builder): void => {
  const lead = leadOf(b.state);
  const run = runningRun(b.state);
  if (lead === undefined || run === undefined || !isFree(b.state, lead.handle)) return;
  if (run.leadWakes >= LEAD_WAKES_MAX) return;
  const next = nextWake(b.state);
  if (next === undefined) return;
  const last = b.state.lead.lastWakeAt;
  if (last !== null && b.now < last + LEAD_WAKE_SPACING_MS) {
    b.arm("lead-wake", run.id, last + LEAD_WAKE_SPACING_MS, crewAs(run.startedBy));
    return;
  }
  b.emit({
    _tag: "LeadUpdated",
    set: {
      woken: { ...b.state.lead.woken, [next.wake.key]: true },
      serving: next.wake,
      lastWakeAt: b.now,
    },
  });
  b.emit({ _tag: "RunUpdated", set: { leadWakes: run.leadWakes + 1 } });
  sendTurn(b, lead, next.card, crewAs(run.startedBy), "lead-wake", next.wake.taskId);
};

/**
 * The wakes a run takes up again when it starts, resumes or goes on after a restart: each review,
 * and each question the lead has not passed on to the person, that the lead was woken for and no
 * running turn of the lead's serves — a pause, a stop or a restart cut that turn off, or it ended
 * without an answer.
 */
export const leadWakesToRenew = (state: CrewState): ReadonlyArray<string> => {
  const lead = leadOf(state);
  if (lead === undefined) return [];
  const serving = isWorking(state, lead.handle) ? state.lead.serving?.key : undefined;
  return tasksInOrder(state).flatMap((task) => {
    const key =
      task.state === "review"
        ? reviewKey(task)
        : task.state === "blocked"
          ? questionKey(task)
          : undefined;
    return key !== undefined &&
      state.lead.woken[key] !== undefined &&
      state.lead.escalated[key] === undefined &&
      key !== serving
      ? [key]
      : [];
  });
};

export const renewLeadWakes = (b: Builder): void => {
  const renew = leadWakesToRenew(b.state);
  if (renew.length === 0) return;
  const woken = { ...b.state.lead.woken };
  for (const key of renew) delete woken[key];
  b.emit({ _tag: "LeadUpdated", set: { woken } });
};

/** The lead's turn ended: a question it was woken for gets the lead's reply as its answer. */
export const settleLead = (
  b: Builder,
  lead: MemberRecord,
  runId: RunId,
  completed: boolean,
): void => {
  const wake = b.state.lead.serving;
  if (wake === null) return;
  b.emit({ _tag: "LeadUpdated", set: { serving: null } });
  if (!completed) {
    const { [wake.key]: _cut, ...woken } = b.state.lead.woken;
    b.emit({ _tag: "LeadUpdated", set: { woken } });
    return;
  }
  if (wake.kind !== "question" || b.state.lead.escalated[wake.key] !== undefined) return;
  const note = lead.lastNote;
  const task = b.state.tasks[wake.taskId];
  if (note === null || note.runId !== runId || note.text.trim() === "") return;
  if (task === undefined || task.state !== "blocked") return;
  continueTask(
    b,
    task,
    dispatchPrincipal(b.state, task),
    answerCard(task, lead.handle, note.text),
    "answer",
  );
};

export const reachedLimit = (state: CrewState, run: RunRecord, nowMs: number) => {
  const { options } = run;
  const budget = options.budgetUsd === "unlimited" ? null : options.budgetUsd;
  if (budget !== null && run.spentUsd >= budget) return "budget" as const;
  if (
    options.timeLimitHours !== "unlimited" &&
    runElapsedMs(run, nowMs) >= options.timeLimitHours * HOUR_MS
  ) {
    return "time" as const;
  }
  const usage = usagePercentOf(state);
  if (
    options.stopAtUsagePercent !== null &&
    usage !== null &&
    usage >= options.stopAtUsagePercent
  ) {
    return "usage" as const;
  }
  return undefined;
};

const amount = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

/** Why a paused run cannot go on under these limits, in the section's words. */
const resumeRefusal = (state: CrewState, run: RunRecord, nowMs: number): string | undefined => {
  const { options } = run;
  switch (reachedLimit(state, run, nowMs)) {
    case "budget":
      return `The run has spent its $${amount(options.budgetUsd === "unlimited" ? 0 : options.budgetUsd)} budget — raise it or choose No limit to resume`;
    case "time":
      return `The run has used its ${amount(options.timeLimitHours === "unlimited" ? 0 : options.timeLimitHours)} h — raise the time limit or choose No limit to resume`;
    case "usage":
      return `The usage window is at ${amount(usagePercentOf(state) ?? 0)} % — raise the stop or turn it off to resume`;
    case undefined:
      return undefined;
  }
};

/** Stops every running crew turn; each task goes on when the run does. */
const interruptCrew = (b: Builder): void => {
  for (const member of membersInOrder(b.state)) {
    const active = member.active;
    if (active === null) continue;
    if (active.taskId !== null && b.state.tasks[active.taskId]?.state === "working") {
      b.emit({
        _tag: "CrewmateUpdated",
        handle: member.handle,
        set: { carryOn: { why: RUN_PAUSED, as: null } },
      });
    }
    deliver(
      b,
      member,
      { _tag: "Stop", runId: active.runId },
      { purpose: "stop", taskId: null, principal: b.envelope.principal, text: null },
    );
  }
};

export const pauseRun = (b: Builder, reason: CrewRunReason, detail: string | null): void => {
  const run = runningRun(b.state);
  if (run === undefined) return;
  b.emit({
    _tag: "RunUpdated",
    set: {
      state: "paused",
      reason,
      reasonDetail: detail,
      keptMs: runElapsedMs(run, b.now),
      since: null,
    },
  });
  b.cancel("run-time", run.id, "the run paused");
  interruptCrew(b);
};

const LIMIT_REASON = { budget: "budget", time: "time", usage: "usage" } as const;

export const checkLimits = (b: Builder): void => {
  const run = runningRun(b.state);
  if (run === undefined) return;
  const reached = reachedLimit(b.state, run, b.now);
  if (reached !== undefined) pauseRun(b, LIMIT_REASON[reached], null);
};

/** The run's clock counts while the run runs and a crew turn runs; idle time is not its time. */
export const followClock = (b: Builder): void => {
  const run = runningRun(b.state);
  if (run === undefined) return;
  const counts = membersInOrder(b.state).some((member) => isWorking(b.state, member.handle));
  if (counts && run.since === null) {
    b.emit({ _tag: "RunUpdated", set: { since: b.now } });
  } else if (!counts && run.since !== null) {
    b.emit({ _tag: "RunUpdated", set: { keptMs: runElapsedMs(run, b.now), since: null } });
  }
  const now = b.state.run!;
  const limit = now.options.timeLimitHours;
  if (counts && limit !== "unlimited") {
    const remaining = Math.max(0, limit * HOUR_MS - runElapsedMs(now, b.now));
    b.arm("run-time", now.id, b.now + remaining, crewAs(now.startedBy));
  } else {
    b.cancel("run-time", now.id, "the crew is not working");
  }
};

/**
 * A run's cap reaches the crew's sessions: one with no turn rotates now (its copy's work aside: a
 * session is not its copy), a working one at its turn's end.
 */
const rotateForBudget = (b: Builder): void => {
  for (const member of membersInOrder(b.state)) {
    if (member.session.running === null) continue;
    if (!isWorking(b.state, member.handle)) {
      rotateSession(b, member, "budget", b.envelope.principal);
    } else {
      b.emit({ _tag: "CrewmateUpdated", handle: member.handle, set: { rotateWhenFree: "budget" } });
    }
  }
};

/** What a run takes up when it starts or resumes: tasks stopped mid-way, and the lead's wakes. */
const takeUpWaiting = (b: Builder): void => {
  for (const member of membersInOrder(b.state)) {
    const open = openTaskOf(b.state, member.handle);
    if (open?.state !== "working" || isWorking(b.state, member.handle) || member.carryOn !== null) {
      continue;
    }
    b.emit({
      _tag: "CrewmateUpdated",
      handle: member.handle,
      set: { carryOn: { why: STOPPED_MIDWAY, as: null } },
    });
  }
  b.emit({ _tag: "LeadUpdated", set: { lastWakeAt: null } });
  renewLeadWakes(b);
};

const lanesReady = (state: CrewState): boolean =>
  membersInOrder(state).every(
    (member) =>
      member.lane === null ||
      (member.lane.state !== "creating" && member.lane.state !== "setting-up"),
  );

export const runFrom = (run: RunRecord | null) =>
  run === null || run.state === "stopped" || run.state === "finished" ? "none" : run.state;

export const startRun = (b: Builder, options: CrewRunOptions): void => {
  const moved = runTransition(runFrom(b.state.run), {
    type: "start",
    admitted: true,
    lanesReady: lanesReady(b.state),
  });
  if (moved.kind === "held") throw wrongState("the crewmates' copies are still being made");
  if (moved.kind === "illegal") throw wrongState(`the run is ${runFrom(b.state.run)}`);
  b.emit({
    _tag: "RunStarted",
    run: {
      id: `run-${b.envelope.commandId}`,
      state: "running",
      reason: null,
      reasonDetail: null,
      startedBy: userOf(b.envelope.principal),
      startedAt: b.now,
      options,
      spentUsd: 0,
      keptMs: 0,
      since: null,
      leadWakes: 0,
    },
  });
  rotateForBudget(b);
  takeUpWaiting(b);
};

export const requireRun = (b: Builder, runId: string): RunRecord => {
  const run = b.state.run;
  if (run === null || run.id !== runId) throw wrongState("that run is over");
  return run;
};

export const resumeRun = (b: Builder, input: Extract<CrewCommand, { _tag: "resume" }>): void => {
  const run = requireRun(b, input.runId);
  const moved = runTransition(runFrom(run), { type: "resume", admitted: true });
  if (moved.kind !== "moved") throw wrongState(`the run is ${runFrom(run)}`);
  const options: CrewRunOptions = {
    ...run.options,
    ...(input.budgetUsd === undefined ? {} : { budgetUsd: input.budgetUsd }),
    ...(input.timeLimitHours === undefined ? {} : { timeLimitHours: input.timeLimitHours }),
    ...(input.stopAtUsagePercent === undefined
      ? {}
      : { stopAtUsagePercent: input.stopAtUsagePercent }),
  };
  const refusal = resumeRefusal(b.state, { ...run, options }, b.now);
  if (refusal !== undefined) throw wrongState(refusal);
  b.emit({
    _tag: "RunUpdated",
    set: { state: "running", reason: null, reasonDetail: null, options },
  });
  rotateForBudget(b);
  takeUpWaiting(b);
};

export const stopRun = (b: Builder, runId: string): void => {
  const run = requireRun(b, runId);
  const moved = runTransition(runFrom(run), { type: "stop" });
  if (moved.kind !== "moved") throw wrongState(`the run is ${runFrom(run)}`);
  b.emit({
    _tag: "RunUpdated",
    set: { state: "stopped", keptMs: runElapsedMs(run, b.now), since: null },
  });
  b.cancel("run-time", run.id, "the run stopped");
  interruptCrew(b);
};

export const finishRun = (b: Builder, run: RunRecord): void => {
  const finishing = runTransition(runFrom(run), { type: "finish" });
  if (finishing.kind !== "moved") throw wrongState(`the run is ${runFrom(run)}`);
  b.emit({
    _tag: "RunUpdated",
    set: { state: "finished", keptMs: runElapsedMs(run, b.now), since: null },
  });
  b.cancel("run-time", run.id, "the run finished");
};

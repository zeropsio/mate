/**
 * Wakes: armed, fired, the agent's own schedule, the watchdog.
 *
 * @module engine/domain/decide.wakes
 */
import * as Cron from "effect/Cron";
import * as Result from "effect/Result";
import { wakeId as deriveWakeId, type Principal, type RunId, isCardAsk } from "@t3tools/contracts";

import type { Command } from "./command.ts";
import type { ConversationState, ArmedWake, RunRecord } from "./state.ts";
import { Rejected, type StepBuilder, crewCarriesOn } from "./decide.step.ts";
import { stoppedWorkWakeId, HELD_FOR_SEND, runPending, rearmLostWork } from "./decide.lostWork.ts";
import { idleWakeId, closeSession } from "./decide.sessions.ts";
import { reopenCarried } from "./decide.carried.ts";
import {
  WATCHDOG_SILENCE_MS,
  queueRun,
  admitNext,
  armWatchdog,
  actsForSomeone,
} from "./decide.runs.ts";

const nextCronTime = (expression: string, now: number): number => {
  const parsed = Cron.parse(expression);
  if (Result.isFailure(parsed)) throw new Rejected("invalid-wake", `bad cron: ${expression}`);
  return Cron.next(parsed.success, now).getTime();
};

export const armWake = (b: StepBuilder, command: Extract<Command, { _tag: "ArmWake" }>): void => {
  actsForSomeone(b);
  const cron = command.cron ?? null;
  const cronNext = cron === null ? undefined : nextCronTime(cron, b.now);
  const dueAt = command.dueAt ?? cronNext;
  if (dueAt === undefined) throw new Rejected("invalid-wake", "a wake needs a due time or a cron");
  if (command.kind === "watchdog")
    throw new Rejected("invalid-wake", "the watchdog is the engine's");
  const id = deriveWakeId(b.state.conversationId, command.kind, command.key);
  b.emit({
    _tag: "WakeArmed",
    wakeId: id,
    kind: command.kind,
    dueAt,
    cron,
    principal: b.envelope.principal,
    joins: command.joins ?? null,
    text: command.text ?? null,
  });
  b.result = { ...b.result, wakeId: id };
};

export const wakeFired = (
  b: StepBuilder,
  id: Extract<Command, { _tag: "WakeFired" }>["wakeId"],
  armedSeq: number | undefined,
) => {
  const wake = b.state.wakes[id];
  if (wake === undefined) throw new Rejected("wake-not-armed");
  if (armedSeq !== undefined && armedSeq !== wake.armedSeq) {
    throw new Rejected("wake-not-armed", "armed again since");
  }
  b.emit({ _tag: "WakeFired", wakeId: id, dueAt: wake.dueAt });
  b.result = { ...b.result, wakeId: id };
  if (wake.cron !== null) {
    b.emit({
      _tag: "WakeArmed",
      wakeId: id,
      kind: wake.kind,
      dueAt: nextCronTime(wake.cron, Math.max(b.now, wake.dueAt)),
      cron: wake.cron,
      principal: wake.principal,
      joins: wake.joins,
      text: wake.text,
    });
  }
  switch (wake.kind) {
    case "watchdog":
      return watchdogFired(b, wake.joins);
    // The agent's own turn never came: the conversation is at rest.
    case "agent-turn-due":
      return;
    case "session-idle": {
      // Closes the session only if it is still the one that sat idle and nothing needs it.
      const session = b.state.session;
      const idle =
        session !== null &&
        id === idleWakeId(b, session.id) &&
        b.state.activeRunId === null &&
        Object.values(b.state.requests).every((request) => isCardAsk(request.kind));
      if (idle) closeSession(b, "idle");
      return;
    }
    case "restart-continuation": {
      const joined = wake.joins;
      const refusal = b.state.archived
        ? "archived"
        : newerPersonMessage(b.state, wake)
          ? "a newer person message"
          : null;
      if (refusal !== null) {
        if (joined !== null) b.emit({ _tag: "RunNotContinued", runId: joined, reason: refusal });
        const carried = joined === null ? undefined : b.state.answering[joined];
        if (carried !== undefined)
          reopenCarried(b, carried, `The answer's message was not sent again: ${refusal}.`);
        admitNext(b);
        return;
      }
      startFromWake(b, wake.kind, id, wake);
      return;
    }
    case "agent-schedule":
      return agentScheduleFired(b, id, wake);
    case "lost-work": {
      // The note of a person's Stop only ever goes with a message.
      if (id === stoppedWorkWakeId(b)) return;
      if (b.state.archived || crewCarriesOn(b.state, wake)) return;
      // A message waiting to go carries the note: held for it, never a run of its own.
      if (runPending(b.state)) return rearmLostWork(b, wake, HELD_FOR_SEND);
      startFromWake(b, wake.kind, id, wake);
      return;
    }
    case "usage-resume":
    case "usage-probe":
      // A crew run's limit only held the queue: its crew decides how it goes on.
      if (
        !b.state.archived &&
        !newerPersonMessage(b.state, wake) &&
        !crewCarriesOn(b.state, wake)
      ) {
        startFromWake(b, wake.kind, id, wake);
      }
      admitNext(b);
      return;
    default:
      if (!b.state.archived) startFromWake(b, wake.kind, id, wake);
      return;
  }
};

/**
 * A prompt the agent scheduled for itself (Claude's CronCreate) lives in its CLI only, unless it
 * asked for it to persist: a Stop, a restart or a crash ends that CLI and the schedule with it
 * (Milo's recheck on 0.15.44: a wake set before a Stop never fired). The engine keeps a wake of its
 * own at the schedule's time, joined to the run that set it: while the session that run worked in
 * lives, the CLI fires the prompt itself and the engine's wake passes; once it is gone, the
 * engine's wake sends the agent its own prompt.
 */
const AGENT_SCHEDULE = "agent-schedule";

/** The CLI's words for a job it scheduled: "Scheduled one-shot task <id> (…)". */
const SCHEDULED_JOB = /Scheduled (?:one-shot task|recurring job) (\S+) \(/u;

const resultText = (result: unknown): string => {
  const content = (result as { readonly content?: unknown } | null)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => ((part as { readonly text?: unknown })?.text as string | undefined) ?? "")
    .join("");
};

const scheduleWakeId = (b: StepBuilder, job: string) =>
  deriveWakeId(b.state.conversationId, AGENT_SCHEDULE, job);

export const agentSchedule = (b: StepBuilder, run: RunRecord, data: unknown): void => {
  const call = data as {
    readonly toolName?: unknown;
    readonly input?: Record<string, unknown> | null;
    readonly result?: unknown;
  } | null;
  if (call?.toolName === "CronDelete") {
    const job = call.input?.id;
    const wakeId = typeof job === "string" ? scheduleWakeId(b, job) : undefined;
    if (wakeId !== undefined && b.state.wakes[wakeId] !== undefined)
      b.emit({ _tag: "WakeCancelled", wakeId, reason: "the agent cancelled it" });
    return;
  }
  if (call?.toolName !== "CronCreate") return;
  const { cron, prompt, recurring, durable } = call.input ?? {};
  // One it asked to persist the CLI keeps across sessions itself.
  if (typeof cron !== "string" || typeof prompt !== "string" || durable === true) return;
  const job = SCHEDULED_JOB.exec(resultText(call.result))?.[1];
  if (job === undefined) return;
  const parsed = Cron.parse(cron);
  if (Result.isFailure(parsed)) return;
  b.emit({
    _tag: "WakeArmed",
    wakeId: scheduleWakeId(b, job),
    kind: AGENT_SCHEDULE,
    dueAt: Cron.next(parsed.success, b.now).getTime(),
    // Recurring unless the agent said otherwise, as the CLI reads it.
    cron: recurring === false ? null : cron,
    principal: run.principal,
    joins: run.id,
    text: prompt,
  });
};

/** What the agent is told with a recurring prompt of its own that ended with its session. */
const scheduleEndedText = (prompt: string, cron: string): string =>
  `${prompt}\n\n(This was your recurring schedule "${cron}". It ended with its session: this is its last run. Schedule it again if it should go on.)`;

const agentScheduleFired = (
  b: StepBuilder,
  id: Extract<Command, { _tag: "WakeFired" }>["wakeId"],
  wake: ArmedWake,
): void => {
  const scheduledIn = wake.joins === null ? undefined : b.state.runs[wake.joins]?.sessionId;
  // Its CLI still runs: it fires the prompt itself.
  if (scheduledIn != null && b.state.session?.id === scheduledIn) return;
  if (wake.cron !== null)
    b.emit({ _tag: "WakeCancelled", wakeId: id, reason: "its session ended" });
  if (b.state.archived) return;
  // Its own prompt at the conversation's end: never under the run that set it.
  startFromWake(b, AGENT_SCHEDULE, id, {
    joins: null,
    principal: wake.principal,
    text: wake.cron === null ? (wake.text ?? "") : scheduleEndedText(wake.text ?? "", wake.cron),
  });
};

/** A person message sent after the run a wake continues: that message runs instead. */
const newerPersonMessage = (
  state: ConversationState,
  wake: { readonly joins: RunId | null; readonly armedSeq: number },
): boolean => {
  const joined = wake.joins === null ? undefined : state.runs[wake.joins];
  return state.lastPersonSeq > (joined?.sinceSeq ?? wake.armedSeq);
};

const startFromWake = (
  b: StepBuilder,
  cause: string,
  id: Extract<Command, { _tag: "WakeFired" }>["wakeId"],
  wake: {
    readonly joins: RunId | null;
    readonly principal: Principal;
    readonly text: string | null;
  },
): void => {
  // A run that continues another (a restart's continuation, a usage resume) works as it did.
  const joined = wake.joins === null ? undefined : b.state.runs[wake.joins];
  queueRun(b, {
    trigger: () => ({ kind: "wake", cause, wakeId: id }),
    joins: wake.joins,
    principal: wake.principal,
    maintenance: false,
    text: wake.text ?? "",
    ...(joined === undefined ? {} : { interactionMode: joined.interactionMode }),
  });
  admitNext(b);
};

const watchdogFired = (b: StepBuilder, id: RunId | null): void => {
  const run = id === null ? undefined : b.state.runs[id];
  // Only a running run is watched: one waiting on a person is not silent, it is waiting.
  if (run === undefined || run.state !== "running" || run.unresponsiveSince !== null) return;
  const lastActivity = run.lastActivityAt ?? run.startedAt ?? b.now;
  if (b.now - lastActivity >= WATCHDOG_SILENCE_MS) {
    b.emit({ _tag: "RunUnresponsive", runId: run.id, silentSince: lastActivity });
    return;
  }
  armWatchdog(b, run, lastActivity);
};

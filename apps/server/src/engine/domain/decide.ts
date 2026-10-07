/**
 * `decide(state, envelope, now)`: every rule and guard of a conversation, pure.
 *
 * A run moves queued → admitted → sending → running ⇄ waiting → ended, one active at a time.
 * Admission captures the run's workspace first (`run.prepare`), then opens a session as an effect
 * when none fits (never as a side effect of a send), and waits while a usage limit pauses the
 * conversation. Every turn-scoped signal is routed to its own turn's run, never to the active one.
 * A run ends by evidence, its source the bridge's word (the agent, a Stop asked or confirmed, a
 * crash, a close, the next turn) or the engine's (a restart, an effect that failed for good); a
 * Stop ends a run only on its turn's own end. A restart cuts the active run and arms a
 * continuation only when no newer person message, no Stop, no archive and no maintenance turn
 * stands against it; the continuation is a new run that `joins` the cut one, as a usage resume
 * joins its limited run and an agent-started turn joins the run whose work it reports. A watchdog
 * only marks a running run unresponsive.
 *
 * @module engine/domain/decide
 */
import * as Cron from "effect/Cron";
import * as Result from "effect/Result";
import {
  effectId as deriveEffectId,
  itemId as deriveItemId,
  requestId as deriveRequestId,
  runId as deriveRunId,
  wakeId as deriveWakeId,
  type CommandResult,
  type EffectId,
  type EffectOutcome,
  type ItemBody,
  type Principal,
  type RejectionReason,
  type RequestId,
  type RunEnd,
  type RunEndSource,
  type RunId,
  type RunTrigger,
  type SessionCapabilities,
  type SessionCloseReason,
  type SessionId,
  type TurnHandle,
  WORK_ENDED,
} from "@t3tools/contracts";

import type { TurnOutcome } from "../bridge/spi3.ts";

import type {
  Command,
  Decision,
  EffectClass,
  EffectDraft,
  EffectLane,
  Envelope,
  EventDraft,
  ItemDataDraft,
  ItemDetailDraft,
  ProviderSignal,
} from "./command.ts";
import { evolve, isUsageWake, stampEvents } from "./evolve.ts";
import {
  activeRun,
  contentDigest,
  runOfTurn,
  type ClosedItem,
  type ConversationState,
  type RunRecord,
} from "./state.ts";

/** Silence after which the watchdog marks a run unresponsive. */
export const WATCHDOG_SILENCE_MS = 10 * 60_000;
/** The first probe of a usage limit whose reset is unknown, and the longest a probe waits. */
export const USAGE_PROBE_FIRST_MS = 15 * 60_000;
export const USAGE_PROBE_MAX_MS = 60 * 60_000;
/** A usage resume waits this long past the reset the driver gave: the window reopens late. */
export const USAGE_RESUME_GRACE_MS = 30_000;
/** What a continuation or a usage resume tells the agent. */
export const CONTINUE_TEXT = "Continue where you left off.";
/** A message a restart cut mid-send goes again in its own words, marked so the agent knows. */
export const resentText = (text: string): string =>
  `(Sent again after a server restart; it may have reached you already.)\n\n${text}`;
/** How a run reads when its own agent interrupted the turn, no Stop asked. */
export const AGENT_STOPPED_ITSELF = "The agent stopped the turn itself.";

/** The effects `decide` asks for, with the lane they queue in and what a restart does to them. */
export const EFFECT_KINDS = {
  "session.open": { lane: "turn", class: "process-bound" },
  "provider.send": { lane: "turn", class: "process-bound" },
  "provider.interrupt": { lane: "control", class: "process-bound" },
  "provider.respond": { lane: "control", class: "process-bound" },
  "session.close": { lane: "control", class: "process-bound" },
  "run.prepare": { lane: "side", class: "replay-safe" },
  "workspace.finish": { lane: "side", class: "replay-safe" },
  "provider.steer": { lane: "turn", class: "process-bound" },
} as const satisfies Record<string, { lane: EffectLane; class: EffectClass }>;
export type EngineEffectKind = keyof typeof EFFECT_KINDS;

/** What a `session.open` effect settles with. */
export interface SessionOpenedValue {
  readonly sessionId: SessionId;
  readonly driver: string;
  readonly model: string | null;
  readonly nativeRef: string | null;
  readonly capabilities: SessionCapabilities;
}

const ENGINE: Principal = { kind: "engine" };
const ENGINE_ACTOR = { kind: "engine" } as const;

class Rejected {
  readonly reason: RejectionReason;
  readonly detail: string | undefined;
  constructor(reason: RejectionReason, detail?: string) {
    this.reason = reason;
    this.detail = detail;
  }
}

/** The working step: each emitted event is folded at once, so later rules read the new state. */
class StepBuilder {
  state: ConversationState;
  readonly events: Array<EventDraft> = [];
  readonly effects: Array<EffectDraft> = [];
  readonly details: Array<ItemDetailDraft> = [];
  readonly data: Array<ItemDataDraft> = [];
  result: Omit<Extract<CommandResult, { _tag: "Accepted" }>, "_tag" | "seq"> = {};

  readonly envelope: Envelope;
  readonly now: number;

  constructor(state: ConversationState, envelope: Envelope, now: number) {
    this.state = state;
    this.envelope = envelope;
    this.now = now;
  }

  emit(draft: EventDraft): void {
    const [event] = stampEvents(this.state.headSeq, this.envelope, [draft], this.now);
    this.events.push(draft);
    this.state = evolve(this.state, event!);
  }

  effect(
    kind: EngineEffectKind,
    cause: string,
    n: number,
    runId: RunId | null,
    payload: unknown,
  ): EffectId {
    const id = deriveEffectId(cause, kind, n);
    this.effects.push({ effectId: id, kind, ...EFFECT_KINDS[kind], runId, payload });
    this.emit({ _tag: "EffectRequested", effectId: id, kind, runId });
    return id;
  }

  run(id: RunId): RunRecord {
    const run = this.state.runs[id];
    if (run === undefined) throw new Error(`run ${id} is not in the state`);
    return run;
  }
}

export const decide = (state: ConversationState, envelope: Envelope, now: number): Decision => {
  const b = new StepBuilder(state, envelope, now);
  try {
    handle(b, envelope.command);
  } catch (error) {
    if (error instanceof Rejected) {
      return {
        _tag: "Reject",
        rejection:
          error.detail === undefined
            ? { reason: error.reason }
            : { reason: error.reason, detail: error.detail },
      };
    }
    throw error;
  }
  return {
    _tag: "Accept",
    step: {
      events: b.events,
      effects: b.effects,
      details: b.details,
      ...(b.data.length === 0 ? {} : { data: b.data }),
      result: { _tag: "Accepted", seq: b.state.headSeq, ...b.result },
    },
  };
};

const handle = (b: StepBuilder, command: Command): void => {
  switch (command._tag) {
    case "Send":
      return send(b, command);
    case "Stop":
      return stop(b, command.runId);
    case "Answer":
      return answer(b, command);
    case "Steer":
      return steer(b, command);
    case "SwitchModel":
      if (b.state.archived) throw new Rejected("archived");
      if (b.state.model !== command.model) {
        b.emit({ _tag: "ModelSwitched", model: command.model, by: b.envelope.principal });
      }
      return;
    case "AssignAgent":
      if (b.state.archived) throw new Rejected("archived");
      if (JSON.stringify(b.state.agent) !== JSON.stringify(command.agent)) {
        b.emit({ _tag: "AgentAssigned", agent: command.agent, by: b.envelope.principal });
      }
      return;
    case "CloseSession":
      return closeSession(b, command.reason);
    case "Archive":
      if (!b.state.archived) b.emit({ _tag: "ConversationArchived", by: b.envelope.principal });
      return;
    case "Unarchive":
      if (b.state.archived) b.emit({ _tag: "ConversationUnarchived", by: b.envelope.principal });
      return;
    case "ArmWake":
      return armWake(b, command);
    case "CancelWake":
      if (b.state.wakes[command.wakeId] === undefined) throw new Rejected("wake-not-armed");
      b.emit({ _tag: "WakeCancelled", wakeId: command.wakeId, reason: "cancelled" });
      return;
    case "WakeFired":
      return wakeFired(b, command.wakeId, command.armedSeq);
    case "EffectSettled":
      return effectSettled(b, command.effectId, command.outcome);
    case "ProviderSignals":
      return signals(b, command.sessionId, command.signals);
    case "Recovered":
      return recovered(b, command.cutEffects, command.unstartedEffects ?? [], command.words);
  }
};

// ── runs ────────────────────────────────────────────────────────────────────────────────────

const queueRun = (
  b: StepBuilder,
  input: {
    readonly trigger: (run: RunId) => RunTrigger;
    readonly joins: RunId | null;
    readonly principal: Principal;
    readonly maintenance: boolean;
    readonly text: string;
  },
): RunId => {
  const ordinal = b.state.nextRunOrdinal;
  const id = deriveRunId(b.state.conversationId, ordinal);
  b.emit({
    _tag: "RunQueued",
    runId: id,
    ordinal,
    trigger: input.trigger(id),
    joins: input.joins,
    principal: input.principal,
    maintenance: input.maintenance,
    text: input.text,
  });
  b.result = { ...b.result, runId: id };
  return id;
};

const paused = (b: StepBuilder) =>
  b.state.pausedUntil === "unknown" ||
  (b.state.pausedUntil !== null && b.now < b.state.pausedUntil);

/**
 * Admits the oldest queued run when nothing is active and no usage limit holds the queue; with
 * nothing to admit, an open session starts its idle time.
 */
const admitNext = (b: StepBuilder): void => {
  if (b.state.activeRunId !== null) return;
  const next = paused(b) ? undefined : b.state.queue[0];
  if (next === undefined) return armIdle(b);
  cancelIdle(b);
  b.emit({ _tag: "RunAdmitted", runId: next });
  const run = b.run(next);
  if (needsPrepare(run) && run.prepare === "none") {
    // Every run is admitted for its principal (D6) and its workspace captured before the agent
    // starts work (D7): the send waits on both. A maintenance command captures nothing.
    b.effect("run.prepare", run.id, 1, run.id, {
      runId: run.id,
      instanceId: b.state.agent?.instanceId ?? null,
      principal: run.principal,
      trigger: run.trigger,
      ...(run.maintenance ? { capture: false } : {}),
    });
    return;
  }
  dispatch(b, run);
};

/** Every run is prepared (admitted, its workspace captured) but one the agent started itself. */
const needsPrepare = (run: RunRecord): boolean =>
  !(run.trigger.kind === "wake" && run.trigger.cause === "self");

/** How long an open session sits with nothing to do before the engine closes it. */
export const SESSION_IDLE_MS = 30 * 60_000;

const idleWakeId = (b: StepBuilder, session: SessionId) =>
  deriveWakeId(b.state.conversationId, "session-idle", session);

const armIdle = (b: StepBuilder): void => {
  const session = b.state.session;
  if (session === null || b.state.closing !== null || b.state.queue.length > 0) return;
  if (b.state.wakes[idleWakeId(b, session.id)] !== undefined) return;
  b.emit({
    _tag: "WakeArmed",
    wakeId: idleWakeId(b, session.id),
    kind: "session-idle",
    dueAt: b.now + SESSION_IDLE_MS,
    cron: null,
    principal: ENGINE,
    joins: null,
    text: null,
  });
};

const cancelIdle = (b: StepBuilder): void => {
  for (const wake of Object.values(b.state.wakes)) {
    if (wake.kind === "session-idle") {
      b.emit({ _tag: "WakeCancelled", wakeId: wake.id, reason: "a run was admitted" });
    }
  }
};

/** Asks the session to close; nothing goes into it until it has. */
const closeSession = (b: StepBuilder, reason: SessionCloseReason): void => {
  const session = b.state.session;
  if (session === null || b.state.closing !== null) return;
  const effect = b.effect("session.close", session.id, session.closeAttempts + 1, null, {
    sessionId: session.id,
    reason,
  });
  b.emit({ _tag: "SessionClosing", sessionId: session.id, reason, effectId: effect });
};

/**
 * Sends an admitted run on a fitting session, or asks for one. A session fits by the model the
 * engine asked for when it opened it, never by the driver's own spelling of it; a session just
 * opened for this run fits. One that does not fit is closed first (a model switch rotates it).
 * A run whose workspace capture has not settled, or a session closing, waits.
 */
const dispatch = (b: StepBuilder, run: RunRecord, justOpened = false): void => {
  if (needsPrepare(run) && run.prepare !== "done") return;
  if (b.state.closing !== null) return;
  const opening = Object.values(b.state.effects).some(
    (effect) => effect.kind === "session.open" && effect.runId === run.id,
  );
  if (opening) return;
  const session = b.state.session;
  const fits = b.state.model === null || session?.requestedModel === b.state.model || justOpened;
  if (session !== null && !fits) return closeSession(b, "model");
  if (session !== null) {
    const effect = b.effect("provider.send", run.id, run.sendAttempts + 1, run.id, {
      runId: run.id,
      sessionId: session.id,
      turn: run.id,
      text: run.text,
      attachments: run.personBody?.attachments ?? [],
    });
    b.emit({ _tag: "RunSending", runId: run.id, sessionId: session.id, effectId: effect });
    return;
  }
  b.effect("session.open", run.id, run.sessionOpenAttempts + 1, run.id, {
    runId: run.id,
    instanceId: b.state.agent?.instanceId ?? null,
    driver: b.state.agent?.driver ?? null,
    model: b.state.model,
    options: b.state.agent?.options ?? null,
    resume: b.state.lastNativeRef,
    rotateFrom: b.state.rotatingFrom,
  });
};

type Delivery = "delivered" | "refused" | "unknown";

const personBody = (run: RunRecord, delivery: Delivery, at: number): ItemBody | null =>
  run.personBody === null ? null : { ...run.personBody, delivery: { state: delivery, at } };

const updatePerson = (b: StepBuilder, run: RunRecord, delivery: Delivery) => {
  const body = personBody(run, delivery, b.now);
  if (body === null || run.trigger.kind !== "person") return;
  b.emit({ _tag: "ItemUpdated", runId: run.id, itemId: run.trigger.itemId, body });
};

/**
 * Ends a run: its open items close (background work runs on and closes itself), its requests lapse, its watchdog is cancelled, and its
 * message never stays queued — refused when it never went out, or `unsent` (refused, or unknown
 * for a send that may have arrived) when it ends while sending.
 */
const endRun = (
  b: StepBuilder,
  run: RunRecord,
  end: RunEnd,
  source: RunEndSource,
  unsent: "refused" | "unknown" = "unknown",
): void => {
  for (const item of Object.values(b.state.items)) {
    if (item.runId !== run.id || item.body.kind === "work") continue;
    b.emit({
      _tag: "ItemClosed",
      runId: run.id,
      itemId: item.id,
      body: settledBody(item.body, end),
    });
  }
  for (const request of Object.values(b.state.requests)) {
    if (request.runId !== run.id) continue;
    b.emit({ _tag: "RequestClosed", runId: run.id, requestId: request.id, state: "lapsed" });
  }
  cancelWatchdog(b, run, "run ended");
  if (run.personBody?.delivery.state === "queued") {
    updatePerson(b, run, run.state === "sending" ? unsent : "refused");
  }
  b.emit({ _tag: "RunEnded", runId: run.id, end, source });
  // Every run that asked for a capture releases it, whatever ended it.
  if (run.prepare !== "none" && !run.maintenance) {
    b.effect("workspace.finish", run.id, 1, run.id, {
      runId: run.id,
      started: run.startedAt !== null,
      providerTurnId: b.run(run.id).providerTurnId,
    });
  }
};

const settledBody = (body: ItemBody, end: RunEnd): ItemBody => {
  switch (body.kind) {
    case "call":
      return {
        ...body,
        state: end.kind === "stopped" ? "stopped" : "unreturned",
        endedAt: body.endedAt,
      };
    case "note":
    case "thought":
      return { ...body, streaming: false };
    default:
      return body;
  }
};

const isLive = (run: RunRecord) =>
  run.state === "sending" || run.state === "running" || run.state === "waiting";

const armWatchdog = (b: StepBuilder, run: RunRecord, from: number): void => {
  b.emit({
    _tag: "WakeArmed",
    wakeId: deriveWakeId(b.state.conversationId, "watchdog", run.id),
    kind: "watchdog",
    dueAt: from + WATCHDOG_SILENCE_MS,
    cron: null,
    principal: ENGINE,
    joins: run.id,
    text: null,
  });
};

const cancelWatchdog = (b: StepBuilder, run: RunRecord, reason: string): void => {
  const watchdog = deriveWakeId(b.state.conversationId, "watchdog", run.id);
  if (b.state.wakes[watchdog] !== undefined) {
    b.emit({ _tag: "WakeCancelled", wakeId: watchdog, reason });
  }
};

/** A running run waits on a person: the watchdog stops, the person is the slow one. */
const markWaiting = (b: StepBuilder, run: RunRecord, request: RequestId): void => {
  b.emit({ _tag: "RunWaiting", runId: run.id, requestId: request });
  cancelWatchdog(b, run, "waiting on a person");
};

/** A waiting run runs again: its mark clears and the watchdog watches it again. */
const markResumed = (b: StepBuilder, run: RunRecord): void => {
  b.emit({ _tag: "RunResumed", runId: run.id });
  armWatchdog(b, b.run(run.id), b.now);
};

/** A run spoke again: its mark clears and, while it runs, the watchdog watches it again. */
const markResponsive = (b: StepBuilder, run: RunRecord): void => {
  b.emit({ _tag: "RunResponsive", runId: run.id });
  const live = b.run(run.id);
  if (live.state === "running") armWatchdog(b, live, b.now);
};

const markStarted = (
  b: StepBuilder,
  run: RunRecord,
  providerTurnId: string | null,
  turn: TurnHandle | null = run.turn,
): void => {
  b.emit({ _tag: "RunStarted", runId: run.id, providerTurnId, turn });
  updatePerson(b, run, "delivered");
  armWatchdog(b, b.run(run.id), b.now);
};

// ── people ──────────────────────────────────────────────────────────────────────────────────

/**
 * Every run's principal is a person or the principal a wake names (wakes run as the Mate's
 * signer): the engine may write items and markers, never be the one a run acts for.
 */
const actsForSomeone = (b: StepBuilder): void => {
  if (b.envelope.principal.kind === "engine") {
    throw new Rejected("invalid-principal", "the engine is never a run's principal");
  }
};

const send = (b: StepBuilder, command: Extract<Command, { _tag: "Send" }>): void => {
  actsForSomeone(b);
  if (b.state.archived) throw new Rejected("archived");
  const attachments = command.attachments ?? [];
  if (command.text.trim() === "" && attachments.length === 0) throw new Rejected("empty-message");
  const ordinal = b.state.nextRunOrdinal;
  const item = deriveItemId(deriveRunId(b.state.conversationId, ordinal), 1);
  const run = queueRun(b, {
    trigger: () => ({ kind: "person", itemId: item }),
    joins: null,
    principal: b.envelope.principal,
    maintenance: command.maintenance === true,
    text: command.text,
  });
  b.emit({
    _tag: "ItemOpened",
    runId: run,
    itemId: item,
    key: null,
    by: { kind: "person", principal: b.envelope.principal },
    body: {
      kind: "person",
      text: command.text,
      attachments: [...attachments],
      sendId: b.envelope.commandId,
      delivery: { state: "queued", at: null },
    },
  });
  b.result = { ...b.result, itemId: item };
  if (b.state.pausedUntil === "unknown") {
    // A limit whose reset nobody knows holds the queue until its probe or the person: they wrote.
    cancelUsageWakes(b, "the person wrote again");
    b.emit({ _tag: "UsagePauseLifted", reason: "the person wrote again" });
  }
  admitNext(b);
};

const stop = (b: StepBuilder, target: RunId | undefined): void => {
  const id = target ?? b.state.activeRunId;
  if (id === null) throw new Rejected("run-not-running");
  const run = b.state.runs[id];
  if (run === undefined) throw new Rejected("unknown-run");
  if (run.state === "ended") throw new Rejected("run-ended");
  if (run.stopAsked !== null) {
    // A second Stop on a turn whose first was not confirmed closes its session.
    const session = b.state.session;
    if (!isLive(run) || session === null || session.id !== run.sessionId) {
      throw new Rejected("stop-already-asked");
    }
    if (b.state.closing !== null) throw new Rejected("stop-already-asked");
    b.result = { ...b.result, runId: run.id };
    return closeSession(b, "stop");
  }
  b.result = { ...b.result, runId: run.id };
  if (!isLive(run) || run.sessionId === null) {
    b.emit({ _tag: "RunStopAsked", runId: run.id, by: b.envelope.principal, effectId: null });
    endRun(b, b.run(run.id), { kind: "stopped", by: b.envelope.principal }, "stop-asked");
    admitNext(b);
    return;
  }
  const effect = b.effect("provider.interrupt", run.id, 1, run.id, {
    runId: run.id,
    sessionId: run.sessionId,
    turn: run.turn,
    providerTurnId: run.providerTurnId,
  });
  b.emit({ _tag: "RunStopAsked", runId: run.id, by: b.envelope.principal, effectId: effect });
};

const answer = (b: StepBuilder, command: Extract<Command, { _tag: "Answer" }>): void => {
  const request = b.state.requests[command.requestId];
  if (request === undefined) throw new Rejected("unknown-request");
  if (!request.answerable) throw new Rejected("not-answerable");
  const run = b.run(request.runId);
  const effect = b.effect("provider.respond", request.id, request.answers + 1, run.id, {
    requestId: request.id,
    key: request.key,
    sessionId: run.sessionId,
    answer: command.answer,
  });
  b.emit({
    _tag: "RequestAnswered",
    runId: run.id,
    requestId: request.id,
    by: b.envelope.principal,
    summary: command.summary,
    effectId: effect,
  });
  b.result = { ...b.result, requestId: request.id, runId: run.id };
  resumeIfAnswered(b, run.id);
};

const resumeIfAnswered = (b: StepBuilder, id: RunId): void => {
  const run = b.run(id);
  if (run.state !== "waiting") return;
  if (Object.values(b.state.requests).some((request) => request.runId === id)) return;
  markResumed(b, run);
};

const steer = (b: StepBuilder, command: Extract<Command, { _tag: "Steer" }>): void => {
  actsForSomeone(b);
  if (b.state.archived) throw new Rejected("archived");
  const run = b.state.runs[command.runId];
  if (run === undefined) throw new Rejected("unknown-run");
  if (run.state !== "running" && run.state !== "waiting") throw new Rejected("run-not-running");
  const session = b.state.session;
  if (session === null || session.id !== run.sessionId || !session.capabilities.steer) {
    throw new Rejected("steer-unsupported");
  }
  const item = deriveItemId(run.id, run.nextItemOrdinal);
  b.emit({
    _tag: "ItemOpened",
    runId: run.id,
    itemId: item,
    key: null,
    by: { kind: "person", principal: b.envelope.principal },
    body: {
      kind: "person",
      text: command.text,
      attachments: [],
      sendId: b.envelope.commandId,
      delivery: { state: "steered", at: b.now },
    },
  });
  b.effect("provider.steer", item, 1, run.id, {
    runId: run.id,
    sessionId: session.id,
    itemId: item,
    text: command.text,
    instanceId: b.state.agent?.instanceId ?? null,
    principal: b.envelope.principal,
  });
  b.result = { ...b.result, runId: run.id, itemId: item };
};

// ── wakes ───────────────────────────────────────────────────────────────────────────────────

const nextCronTime = (expression: string, now: number): number => {
  const parsed = Cron.parse(expression);
  if (Result.isFailure(parsed)) throw new Rejected("invalid-wake", `bad cron: ${expression}`);
  return Cron.next(parsed.success, now).getTime();
};

const armWake = (b: StepBuilder, command: Extract<Command, { _tag: "ArmWake" }>): void => {
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

const wakeFired = (
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
    case "session-idle": {
      // Closes the session only if it is still the one that sat idle and nothing needs it.
      const session = b.state.session;
      const idle =
        session !== null &&
        id === idleWakeId(b, session.id) &&
        b.state.activeRunId === null &&
        Object.keys(b.state.requests).length === 0;
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
        admitNext(b);
        return;
      }
      startFromWake(b, wake.kind, id, wake);
      return;
    }
    case "usage-resume":
    case "usage-probe":
      if (!b.state.archived && !newerPersonMessage(b.state, wake)) {
        startFromWake(b, wake.kind, id, wake);
      }
      admitNext(b);
      return;
    default:
      if (!b.state.archived) startFromWake(b, wake.kind, id, wake);
      return;
  }
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
  queueRun(b, {
    trigger: () => ({ kind: "wake", cause, wakeId: id }),
    joins: wake.joins,
    principal: wake.principal,
    maintenance: false,
    text: wake.text ?? "",
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

// ── effects ─────────────────────────────────────────────────────────────────────────────────

const effectSettled = (b: StepBuilder, id: EffectId, outcome: EffectOutcome): void => {
  const effect = b.state.effects[id];
  if (effect === undefined) throw new Rejected("unknown-effect");
  const answered = b.state.answering[id];
  const closing = b.state.closing?.effectId === id ? b.state.closing : null;
  b.emit({ _tag: "EffectOutcomeRecorded", effectId: id, kind: effect.kind, outcome });
  const failure =
    outcome.kind === "ok"
      ? null
      : outcome.kind === "unknown"
        ? `an outcome this build does not know (${outcome.type})`
        : outcome.reason;
  if (effect.kind === "session.close") return sessionCloseSettled(b, closing, outcome);
  const run = effect.runId === null ? undefined : b.state.runs[effect.runId];
  if (run === undefined || run.state === "ended") {
    if (effect.kind === "session.open" && outcome.kind === "ok") openSession(b, outcome.value);
    admitNext(b);
    return;
  }
  switch (effect.kind) {
    case "run.prepare": {
      if (outcome.kind === "failed" && outcome.refused === true) {
        // Only admission refuses a run, and before anything of it ran.
        endRun(
          b,
          run,
          { kind: "failed", reason: outcome.reason, next: null },
          "inferred-from-effect",
        );
        admitNext(b);
        return;
      }
      // Any capture outcome sends the message; what could not be captured is recorded.
      for (const gap of captureGaps(outcome, failure)) {
        recordMarker(b, run, { kind: "capture-gap", reason: gap });
      }
      if (run.state === "admitted") dispatch(b, b.run(run.id));
      return;
    }
    case "session.open":
      // A run requeued meanwhile keeps the session for when it is admitted again.
      if (run.state === "queued") {
        if (outcome.kind === "ok") openSession(b, outcome.value);
        return;
      }
      if (failure !== null) {
        endRun(b, run, { kind: "failed", reason: failure, next: null }, "inferred-from-effect");
        admitNext(b);
        return;
      }
      openSession(b, outcome.kind === "ok" ? outcome.value : undefined);
      if (run.state === "admitted") dispatch(b, b.run(run.id), true);
      return;
    case "provider.send":
      if (failure !== null) {
        const undelivered = outcome.kind === "failed" ? outcome.undelivered : undefined;
        if (undelivered === true && sendsAgain(b, run, failure)) return;
        endRun(
          b,
          run,
          { kind: "failed", reason: failure, next: null },
          "inferred-from-effect",
          undelivered === undefined || undelivered === true ? "refused" : "unknown",
        );
        admitNext(b);
        return;
      }
      if (run.state === "sending") {
        const accepted = sendAccepted(outcome.kind === "ok" ? outcome.value : undefined);
        markStarted(b, run, accepted.providerTurnId, accepted.turn ?? run.turn);
      }
      return;
    case "provider.steer": {
      // A steer that never reached the agent (refused, or no live session) reads so.
      if (failure === null) return;
      const item = b.state.items[id.slice(0, id.indexOf("/e/provider.steer/"))];
      if (item?.body.kind !== "person") return;
      const undelivered = outcome.kind === "failed" ? outcome.undelivered : undefined;
      b.emit({
        _tag: "ItemUpdated",
        runId: run.id,
        itemId: item.id,
        body: {
          ...item.body,
          delivery: {
            state: undelivered === undefined || undelivered === true ? "refused" : "unknown",
            at: b.now,
          },
        },
      });
      return;
    }
    case "provider.interrupt":
      // The interrupt's acknowledgement is not the turn's end: the run stays until its own turn
      // ends. An interrupt that failed leaves nothing to wait for, so the Stop ends the run.
      if (failure !== null && run.stopAsked !== null && isLive(run)) {
        endRun(b, run, { kind: "stopped", by: run.stopAsked.by }, "stop-asked");
        admitNext(b);
      }
      return;
    case "provider.respond":
      if (failure === null || answered === undefined || !isLive(run)) return;
      if (outcome.kind === "failed" && outcome.refused === true) {
        // The driver can no longer take any answer: the request expired, nothing waits on it.
        b.emit({
          _tag: "RequestClosed",
          runId: run.id,
          requestId: answered.id,
          state: "expired",
        });
        return;
      }
      // The answer never reached the agent, which still waits on it: the person answers again.
      b.emit({
        _tag: "RequestReopened",
        runId: run.id,
        requestId: answered.id,
        key: answered.key,
        principal: answered.principal,
        reason: failure,
        answers: answered.answers,
      });
      if (b.run(run.id).state === "running") markWaiting(b, b.run(run.id), answered.id);
      return;
    default:
      return;
  }
};

/**
 * A message the session could not take never reached the agent (its session died under it): the
 * session is gone, and the run goes back to the head of the queue to be sent once more on a new
 * one. False when it already went twice, or a Stop is asked: then it ends.
 */
const sendsAgain = (b: StepBuilder, run: RunRecord, reason: string): boolean => {
  if (run.sendAttempts >= 2 || run.stopAsked !== null || run.state !== "sending") return false;
  if (b.state.session !== null && b.state.session.id === run.sessionId) {
    b.emit({ _tag: "SessionClosed", sessionId: b.state.session.id, reason: "exited" });
  }
  b.emit({ _tag: "RunRequeued", runId: run.id, reason: `undelivered: ${reason}` });
  admitNext(b);
  return true;
};

/** What a capture could not take, one line per service; a failed capture is one gap. */
const captureGaps = (outcome: EffectOutcome, failure: string | null): ReadonlyArray<string> => {
  if (failure !== null) return [`The workspace capture failed: ${failure}`];
  const value = outcome.kind === "ok" ? outcome.value : undefined;
  const gaps =
    typeof value === "object" && value !== null ? (value as { gaps?: unknown }).gaps : undefined;
  if (!Array.isArray(gaps)) return [];
  return gaps.flatMap((gap: unknown) => {
    const { service, reason } = (gap ?? {}) as { service?: unknown; reason?: unknown };
    return typeof service === "string" && typeof reason === "string"
      ? [`${service}: ${reason}`]
      : [];
  });
};

/** A marker the engine records under a run, closed as it opens. */
const recordMarker = (
  b: StepBuilder,
  run: RunRecord,
  marker: { readonly kind: string; readonly reason?: string },
): void => {
  const id = deriveItemId(run.id, b.run(run.id).nextItemOrdinal);
  const body: ItemBody = { kind: "marker", marker };
  b.emit({ _tag: "ItemOpened", runId: run.id, itemId: id, key: null, by: ENGINE_ACTOR, body });
  b.emit({ _tag: "ItemClosed", runId: run.id, itemId: id, body });
};

/**
 * The session closed as asked (or its close failed: it is treated as gone). A run still live on
 * it ends from that evidence; a session the idle check found busy is kept and idles again.
 */
const sessionCloseSettled = (
  b: StepBuilder,
  closing: ConversationState["closing"],
  outcome: EffectOutcome,
): void => {
  if (closing === null) return admitNext(b);
  const kept =
    closing.reason === "idle" &&
    outcome.kind === "ok" &&
    typeof outcome.value === "object" &&
    outcome.value !== null &&
    (outcome.value as { kept?: unknown }).kept === true;
  if (kept) return armIdle(b);
  const run = activeRun(b.state);
  if (run !== undefined && isLive(run) && run.sessionId === closing.sessionId) {
    endRun(
      b,
      run,
      run.stopAsked !== null
        ? { kind: "stopped", by: run.stopAsked.by }
        : { kind: "crashed", reason: `The session closed (${closing.reason}).` },
      "inferred-from-close",
    );
  }
  if (b.state.session?.id === closing.sessionId) {
    b.emit({ _tag: "SessionClosed", sessionId: closing.sessionId, reason: closing.reason });
  }
  const admitted = activeRun(b.state);
  if (admitted?.state === "admitted") return dispatch(b, admitted);
  admitNext(b);
};

/** What a send settles with: the turn the message went into, and the driver's id for it. */
const sendAccepted = (
  value: unknown,
): { readonly turn: TurnHandle | null; readonly providerTurnId: string | null } => {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    turn: typeof record.turn === "string" ? (record.turn as TurnHandle) : null,
    providerTurnId: typeof record.providerTurnId === "string" ? record.providerTurnId : null,
  };
};

const openSession = (b: StepBuilder, value: unknown): void => {
  const opened = value as SessionOpenedValue | undefined;
  if (opened === undefined || typeof opened.sessionId !== "string") return;
  const previous = b.state.session;
  if (previous !== null && previous.id !== opened.sessionId) {
    b.emit({ _tag: "SessionClosed", sessionId: previous.id, reason: "model" });
  }
  b.emit({
    _tag: "SessionOpened",
    sessionId: opened.sessionId,
    driver: opened.driver,
    requestedModel: b.state.model,
    model: opened.model,
    nativeRef: opened.nativeRef,
    capabilities: opened.capabilities,
    rotatedFrom:
      previous !== null && previous.id !== opened.sessionId ? previous.id : b.state.rotatingFrom,
  });
};

// ── provider signals ────────────────────────────────────────────────────────────────────────

const signals = (
  b: StepBuilder,
  sessionId: SessionId,
  batch: ReadonlyArray<ProviderSignal>,
): void => {
  if (b.state.session === null || b.state.session.id !== sessionId) {
    throw new Rejected("stale-session");
  }
  for (const signal of batch) {
    if (b.state.session?.id !== sessionId) return;
    signalOne(b, sessionId, signal);
  }
};

/** A boundary from a live run: one while it is still sending means its turn started. */
const awaken = (b: StepBuilder, run: RunRecord): RunRecord => {
  if (run.state === "sending") markStarted(b, run, null);
  const live = b.run(run.id);
  if (live.unresponsiveSince !== null) markResponsive(b, live);
  return b.run(run.id);
};

/** The run a turn-scoped signal belongs to; a turn the engine does not know has none. */
const routed = (b: StepBuilder, turn: TurnHandle | undefined): RunRecord | undefined => {
  if (turn === undefined) {
    const active = activeRun(b.state);
    return active !== undefined && isLive(active) ? active : undefined;
  }
  return runOfTurn(b.state, turn);
};

const signalOne = (b: StepBuilder, sessionId: SessionId, signal: ProviderSignal): void => {
  switch (signal.kind) {
    case "turn-started": {
      const run = runOfTurn(b.state, signal.turn);
      if (run !== undefined) {
        if (run.state === "sending") markStarted(b, run, signal.providerTurnId, signal.turn);
        return;
      }
      if (signal.origin !== "self") return;
      const joined = selfJoins(b, signal.reportsOn ?? null);
      // Nobody to act for (no run before it): the turn is not the engine's to record as a run.
      if (joined === undefined) return;
      const active = activeRun(b.state);
      // A run still being prepared has sent nothing: it goes back to the head of the queue and
      // is sent when the agent's own turn ends.
      if (active?.state === "admitted") {
        b.emit({
          _tag: "RunRequeued",
          runId: active.id,
          reason: "the agent started a turn of its own",
        });
      } else if (active !== undefined) return;
      return selfStarted(b, signal.turn, signal.providerTurnId, joined);
    }
    case "activity": {
      const run = routed(b, signal.turn);
      if (run === undefined || !isLive(run)) return;
      const quiet = b.now - (run.lastActivityAt ?? 0) >= WATCHDOG_SILENCE_MS / 2;
      if (run.unresponsiveSince !== null || quiet) {
        if (run.state === "sending") markStarted(b, run, null);
        markResponsive(b, b.run(run.id));
      }
      return;
    }
    case "item-opened":
    case "item-closed":
    case "item-updated": {
      // Idempotent by content: a signal delivered again (a new batch, the same turn, key and body)
      // changes nothing; an item closed before only ever changes in place.
      const closed = b.state.closedItems[signal.key];
      if (closed !== undefined) {
        // Never back to open: only a closing signal, or one after its turn's end, can change it.
        if (signal.kind === "item-closed" || signal.afterEnd === true) {
          updateClosed(b, closed, signal.body);
        }
        return;
      }
      const open = Object.values(b.state.items).find((item) => item.key === signal.key);
      const owner = routed(b, signal.turn);
      if (owner === undefined || (owner.state !== "ended" && !isLive(owner))) return;
      const same = open !== undefined && contentDigest(open.body) === contentDigest(signal.body);
      if (signal.kind !== "item-closed" && same) return;
      if (signal.kind === "item-updated" && (open === undefined || !isLive(owner))) return;
      const run = isLive(owner) ? awaken(b, owner) : owner;
      let id = open?.id;
      if (id === undefined) {
        id = deriveItemId(run.id, run.nextItemOrdinal);
        b.emit({
          _tag: "ItemOpened",
          runId: run.id,
          itemId: id,
          key: signal.key,
          by: (signal.kind === "item-updated" ? undefined : signal.by) ?? { kind: "mate" },
          body: signal.body,
        });
      } else if (!same && signal.kind !== "item-closed") {
        b.emit({ _tag: "ItemUpdated", runId: open!.runId, itemId: id, body: signal.body });
      }
      // A run that has ended never holds an open item: what arrives after its end is filed closed.
      if (signal.kind === "item-closed" || run.state === "ended") {
        b.emit({
          _tag: "ItemClosed",
          runId: run.id,
          itemId: id,
          body: run.end === null ? signal.body : settledBody(signal.body, run.end),
        });
      }
      if (signal.kind !== "item-updated" && signal.detail !== undefined) {
        b.details.push({ itemId: id, body: signal.detail });
      }
      if (signal.kind === "item-closed" && signal.data !== undefined) {
        b.data.push({ itemId: id, data: signal.data });
      }
      return;
    }
    case "request-opened": {
      // A request is asked once: one delivered again, open or answered, is the same request.
      if (b.state.askedKeys[signal.key] !== undefined) return;
      const owner = routed(b, signal.turn);
      if (owner === undefined) return;
      const run = isLive(owner) ? awaken(b, owner) : owner;
      const id = deriveRequestId(run.id, run.nextRequestOrdinal);
      const live = isLive(run);
      b.emit({
        _tag: "RequestOpened",
        runId: run.id,
        requestId: id,
        key: signal.key,
        ask: signal.ask,
        answerable: live && (signal.answerable ?? true),
        principal: run.principal,
      });
      if (!live) {
        // Its turn already ended: nothing can take the answer.
        b.emit({ _tag: "RequestClosed", runId: run.id, requestId: id, state: "lapsed" });
        return;
      }
      if (b.run(run.id).state !== "waiting") markWaiting(b, b.run(run.id), id);
      return;
    }
    case "request-closed": {
      const request = Object.values(b.state.requests).find((open) => open.key === signal.key);
      if (request === undefined) return;
      b.emit({
        _tag: "RequestClosed",
        runId: request.runId,
        requestId: request.id,
        state: signal.state,
      });
      resumeIfAnswered(b, request.runId);
      return;
    }
    case "turn-ended": {
      const run = runOfTurn(b.state, signal.turn);
      if (run === undefined || !isLive(run)) return;
      if (signal.outcome.kind === "undelivered" && sendsAgain(b, run, signal.outcome.words)) return;
      // A turn that ends before it was seen to start still started: the message reached the agent.
      if (run.state === "sending") markStarted(b, run, null, signal.turn);
      const live = b.run(run.id);
      const end = turnEnd(live, signal.outcome);
      endRun(b, live, end, signal.source);
      if (end.kind === "usage-limit") limited(b, live, end.resetsAt);
      admitNext(b);
      return;
    }
    case "work-upserted": {
      const body: ItemBody = {
        kind: "work",
        work: signal.work,
        workKind: signal.workKind,
        status: signal.status,
        title: signal.title ?? null,
      };
      const ends = WORK_ENDED.has(signal.status);
      const closed = b.state.closedItems[signal.work];
      if (closed !== undefined) return updateClosed(b, closed, body);
      const open = Object.values(b.state.items).find((item) => item.key === signal.work);
      if (open !== undefined) {
        if (ends) b.emit({ _tag: "ItemClosed", runId: open.runId, itemId: open.id, body });
        else if (contentDigest(open.body) !== contentDigest(body)) {
          b.emit({ _tag: "ItemUpdated", runId: open.runId, itemId: open.id, body });
        }
        return;
      }
      // Under the run whose turn started it; a driver that cannot say files it under the latest.
      const owner =
        signal.origin === "unknown"
          ? b.state.latestRunId === null
            ? undefined
            : b.state.runs[b.state.latestRunId]
          : runOfTurn(b.state, signal.origin);
      if (owner === undefined || owner.state === "queued" || owner.state === "admitted") return;
      const id = deriveItemId(owner.id, owner.nextItemOrdinal);
      b.emit({
        _tag: "ItemOpened",
        runId: owner.id,
        itemId: id,
        key: signal.work,
        by: { kind: "mate" },
        body,
      });
      if (ends) b.emit({ _tag: "ItemClosed", runId: owner.id, itemId: id, body });
      return;
    }
    case "usage-reset-known": {
      // A limit whose reset was unknown: its probe gives way to a resume at the known time.
      const probe = Object.values(b.state.wakes).find((wake) => wake.kind === "usage-probe");
      if (b.state.pausedUntil !== "unknown" || probe === undefined) return;
      b.emit({ _tag: "WakeCancelled", wakeId: probe.id, reason: "the reset is known" });
      b.emit({ _tag: "UsagePauseLifted", reason: "the reset is known" });
      b.emit({
        _tag: "WakeArmed",
        wakeId: deriveWakeId(b.state.conversationId, "usage-resume", probe.joins ?? "limit"),
        kind: "usage-resume",
        dueAt: signal.resetsAt + USAGE_RESUME_GRACE_MS,
        cron: null,
        principal: probe.principal,
        joins: probe.joins,
        text: CONTINUE_TEXT,
      });
      admitNext(b);
      return;
    }
    case "usage-limit": {
      const run = routed(b, signal.turn);
      if (run !== undefined && isLive(run)) {
        endRun(b, run, { kind: "usage-limit", resetsAt: signal.resetsAt }, "agent");
        limited(b, run, signal.resetsAt);
        // A parked turn (Claude) sits in its session until the reset: close it; the resume
        // reopens the session with its resume cursor and sends explicitly.
        if (signal.parks === true && b.state.session?.id === run.sessionId) {
          closeSession(b, "usage-limit");
        }
      }
      admitNext(b);
      return;
    }
    case "session-exited": {
      const run = activeRun(b.state);
      if (run !== undefined && isLive(run) && run.sessionId === sessionId) {
        if (run.stopAsked !== null) {
          endRun(b, run, { kind: "stopped", by: run.stopAsked.by }, "inferred-from-crash");
        } else {
          endRun(b, run, { kind: "crashed", reason: signal.reason }, "inferred-from-crash");
        }
      }
      b.emit({ _tag: "SessionClosed", sessionId, reason: "exited" });
      admitNext(b);
      return;
    }
  }
};

/** A closed item's key again: the same content changes nothing, new content updates it in place. */
const updateClosed = (b: StepBuilder, closed: ClosedItem, body: ItemBody): void => {
  const run = closed.runId === null ? undefined : b.state.runs[closed.runId];
  const settled = run?.end == null ? body : settledBody(body, run.end);
  if (contentDigest(settled) === closed.digest) return;
  b.emit({ _tag: "ItemUpdated", runId: closed.runId, itemId: closed.itemId, body: settled });
};

/** What a turn's outcome makes of its run, said in one place; the source is always the bridge's. */
const turnEnd = (run: RunRecord, outcome: TurnOutcome): RunEnd => {
  const stoppedBy = run.stopAsked?.by;
  switch (outcome.kind) {
    case "completed":
      return { kind: "completed" };
    case "interrupted":
      return stoppedBy !== undefined
        ? { kind: "stopped", by: stoppedBy }
        : { kind: "failed", reason: AGENT_STOPPED_ITSELF, next: null };
    case "failed":
    case "unknown":
    case "undelivered":
      return { kind: "failed", reason: outcome.words, next: null };
    case "usage-limited":
      return { kind: "usage-limit", resetsAt: resetTime(outcome.resetsAt) };
    case "cut":
      return stoppedBy !== undefined
        ? { kind: "stopped", by: stoppedBy }
        : { kind: "crashed", reason: outcome.words ?? outcome.cause };
  }
};

const resetTime = (resetsAt: string): number | null => {
  if (resetsAt === "unknown") return null;
  const at = Date.parse(resetsAt);
  return Number.isNaN(at) ? null : at;
};

/**
 * A usage limit ended `run` and holds the queue. A known reset arms a resume that joins it, 30
 * seconds after the reset (V1's grace: the window reopens late); an
 * unknown one arms a probe that tries to resume it, waiting 15 minutes, then twice as long after
 * each probe the limit refuses, up to an hour. Only the probe's outcome ends anything; the
 * person can write sooner.
 */
const limited = (b: StepBuilder, run: RunRecord, resetsAt: number | null): void => {
  // One limit at a time: the newest says when the queue may go on.
  cancelUsageWakes(b, "a newer usage limit");
  if (resetsAt === null) {
    const last = b.state.usageProbeMs;
    const delay = last === null ? USAGE_PROBE_FIRST_MS : Math.min(2 * last, USAGE_PROBE_MAX_MS);
    b.emit({
      _tag: "WakeArmed",
      wakeId: deriveWakeId(b.state.conversationId, "usage-probe", run.id),
      kind: "usage-probe",
      dueAt: b.now + delay,
      cron: null,
      principal: run.principal,
      joins: run.id,
      text: CONTINUE_TEXT,
    });
    return;
  }
  b.emit({
    _tag: "WakeArmed",
    wakeId: deriveWakeId(b.state.conversationId, "usage-resume", run.id),
    kind: "usage-resume",
    dueAt: resetsAt + USAGE_RESUME_GRACE_MS,
    cron: null,
    principal: run.principal,
    joins: run.id,
    text: CONTINUE_TEXT,
  });
};

const cancelUsageWakes = (b: StepBuilder, reason: string): void => {
  for (const wake of Object.values(b.state.wakes)) {
    if (isUsageWake(wake.kind)) b.emit({ _tag: "WakeCancelled", wakeId: wake.id, reason });
  }
};

/** A turn the agent started on its own: a run that joins the run whose work it reports. */
/** The run a self turn joins (the bridge's word, else the latest that ran) and its principal. */
const selfJoins = (
  b: StepBuilder,
  reportsOn: RunId | null,
): { readonly joins: RunId; readonly principal: Principal } | undefined => {
  const joins = reportsOn ?? b.state.endedRuns.at(-1) ?? b.state.latestRunId;
  const joined = joins === null ? undefined : b.state.runs[joins];
  if (joined === undefined || joined.principal.kind === "engine") return undefined;
  return { joins: joined.id, principal: joined.principal };
};

const selfStarted = (
  b: StepBuilder,
  turn: TurnHandle,
  providerTurnId: string | null,
  joined: { readonly joins: RunId; readonly principal: Principal },
) => {
  const run = queueRun(b, {
    trigger: () => ({ kind: "wake", cause: "self", wakeId: null }),
    joins: joined.joins,
    principal: joined.principal,
    maintenance: false,
    text: "",
  });
  b.emit({ _tag: "RunAdmitted", runId: run });
  markStarted(b, b.run(run), providerTurnId, turn);
};

// ── recovery ────────────────────────────────────────────────────────────────────────────────

/** Why a cut run is not continued, or null when every guard passes. */
export const continuationRefusal = (state: ConversationState, run: RunRecord): string | null => {
  if (state.archived) return "archived";
  if (run.stopAsked !== null) return "a Stop was asked";
  if (run.maintenance) return "a maintenance turn";
  if (state.lastPersonSeq > run.sinceSeq) return "a newer person message";
  return null;
};

const recovered = (
  b: StepBuilder,
  cutEffects: ReadonlyArray<EffectId>,
  unstartedEffects: ReadonlyArray<EffectId>,
  words: string | undefined,
): void => {
  const record = (id: EffectId, reason: string) => {
    const effect = b.state.effects[id];
    if (effect === undefined) return undefined;
    b.emit({
      _tag: "EffectOutcomeRecorded",
      effectId: id,
      kind: effect.kind,
      outcome: { kind: "cut", reason },
    });
    return effect;
  };
  for (const id of cutEffects) record(id, "the server restarted");
  const neverSent = new Set<string>();
  for (const id of unstartedEffects) {
    const effect = record(id, "the server restarted before it was tried");
    if (effect?.kind === "provider.send" && effect.runId !== null) neverSent.add(effect.runId);
  }
  const run = activeRun(b.state);
  if (run !== undefined && run.state === "sending" && neverSent.has(run.id)) {
    // Its send never started: nothing reached the agent, so it goes again, as it was.
    b.emit({
      _tag: "RunRequeued",
      runId: run.id,
      reason: "the server restarted before it was sent",
    });
  } else if (run !== undefined && isLive(run)) {
    const refusal = continuationRefusal(b.state, run);
    endRun(
      b,
      run,
      {
        kind: "cut-by-restart",
        continuedBy: null,
        ...(refusal === null ? {} : { notContinued: refusal }),
        ...(words === undefined ? {} : { words }),
      },
      "inferred-from-restart",
    );
    if (refusal === null) {
      b.emit({
        _tag: "WakeArmed",
        wakeId: deriveWakeId(b.state.conversationId, "restart-continuation", run.id),
        kind: "restart-continuation",
        dueAt: b.now,
        cron: null,
        principal: run.principal,
        joins: run.id,
        // A send cut mid-flight may or may not have arrived: its own words go again, marked.
        text: run.state === "sending" ? resentText(run.text) : CONTINUE_TEXT,
      });
    }
  }
  if (b.state.session !== null) {
    b.emit({ _tag: "SessionClosed", sessionId: b.state.session.id, reason: "restart" });
  }
  const admitted = activeRun(b.state);
  if (admitted?.state === "admitted") {
    // Its capture, requeued with the replay-safe work, still settles first.
    dispatch(b, admitted);
    return;
  }
  admitNext(b);
};

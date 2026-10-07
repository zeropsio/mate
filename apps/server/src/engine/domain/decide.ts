/**
 * `decide(state, envelope, now)`: every rule and guard of a conversation, pure.
 *
 * A run moves queued → admitted → sending → running ⇄ waiting → ended, one active at a time.
 * Admission opens a session as an effect when none fits (never as a side effect of a send), and
 * waits while a usage limit pauses the conversation. A run ends by what someone said: the agent,
 * the bridge inferring a crash or a failed effect, the engine on a Stop no provider confirmed, or
 * the provider confirming a Stop. A restart cuts the active run and arms a continuation only when
 * no newer person message, no Stop, no archive and no maintenance turn stands against it; the
 * continuation is a new run that `joins` the cut one, as a usage resume joins its limited run and an
 * agent-started turn joins the run whose work it reports. A watchdog only marks a run unresponsive.
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
  type RunEnd,
  type RunEndSource,
  type RunId,
  type RunTrigger,
  type SessionCapabilities,
  type SessionId,
} from "@t3tools/contracts";

import type {
  Command,
  Decision,
  EffectClass,
  EffectDraft,
  EffectLane,
  Envelope,
  EventDraft,
  ItemDetailDraft,
  ProviderSignal,
} from "./command.ts";
import { evolve, stampEvents } from "./evolve.ts";
import { activeRun, type ConversationState, type RunRecord } from "./state.ts";

/** Silence after which the watchdog marks a run unresponsive. */
export const WATCHDOG_SILENCE_MS = 10 * 60_000;
/** What a continuation or a usage resume tells the agent. */
export const CONTINUE_TEXT = "Continue where you left off.";

/** The effects `decide` asks for, with the lane they queue in and what a restart does to them. */
export const EFFECT_KINDS = {
  "session.open": { lane: "turn", class: "process-bound" },
  "provider.send": { lane: "turn", class: "process-bound" },
  "provider.interrupt": { lane: "turn", class: "process-bound" },
  "provider.respond": { lane: "turn", class: "process-bound" },
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
      return wakeFired(b, command.wakeId);
    case "EffectSettled":
      return effectSettled(b, command.effectId, command.outcome);
    case "ProviderSignals":
      return signals(b, command.sessionId, command.signals);
    case "Recovered":
      return recovered(b, command.cutEffects);
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

const paused = (b: StepBuilder) => b.state.pausedUntil !== null && b.now < b.state.pausedUntil;

/** Admits the oldest queued run when nothing is active and no usage limit holds the queue. */
const admitNext = (b: StepBuilder): void => {
  if (b.state.activeRunId !== null || paused(b)) return;
  const next = b.state.queue[0];
  if (next === undefined) return;
  b.emit({ _tag: "RunAdmitted", runId: next });
  dispatch(b, b.run(next));
};

/**
 * Sends an admitted run on a fitting session, or asks for one. A session just opened for this
 * run fits whatever model the driver reports.
 */
const dispatch = (b: StepBuilder, run: RunRecord, justOpened = false): void => {
  const session = b.state.session;
  const fits = b.state.model === null || session?.model === b.state.model || justOpened;
  if (session !== null && fits) {
    const effect = b.effect("provider.send", run.id, 1, run.id, {
      runId: run.id,
      sessionId: session.id,
      text: run.text,
    });
    b.emit({ _tag: "RunSending", runId: run.id, sessionId: session.id, effectId: effect });
    return;
  }
  b.effect("session.open", run.id, run.sessionOpenAttempts + 1, run.id, {
    runId: run.id,
    model: b.state.model,
    resume: b.state.lastNativeRef,
    rotateFrom: session?.id ?? null,
  });
};

const personBody = (
  run: RunRecord,
  delivery: "delivered" | "refused",
  at: number,
): ItemBody | null =>
  run.personBody === null ? null : { ...run.personBody, delivery: { state: delivery, at } };

const updatePerson = (b: StepBuilder, run: RunRecord, delivery: "delivered" | "refused") => {
  const body = personBody(run, delivery, b.now);
  if (body === null || run.trigger.kind !== "person") return;
  b.emit({ _tag: "ItemUpdated", runId: run.id, itemId: run.trigger.itemId, body });
};

/** Ends a run: its open items close, its requests lapse, its watchdog is cancelled. */
const endRun = (b: StepBuilder, run: RunRecord, end: RunEnd, source: RunEndSource): void => {
  for (const item of Object.values(b.state.items)) {
    if (item.runId !== run.id) continue;
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
  const watchdog = deriveWakeId(b.state.conversationId, "watchdog", run.id);
  if (b.state.wakes[watchdog] !== undefined) {
    b.emit({ _tag: "WakeCancelled", wakeId: watchdog, reason: "run ended" });
  }
  if (run.state === "queued" || run.state === "admitted") updatePerson(b, run, "refused");
  b.emit({ _tag: "RunEnded", runId: run.id, end, source });
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

const markStarted = (b: StepBuilder, run: RunRecord, providerTurnId: string | null): void => {
  b.emit({ _tag: "RunStarted", runId: run.id, providerTurnId });
  updatePerson(b, run, "delivered");
  armWatchdog(b, b.run(run.id), b.now);
};

// ── people ──────────────────────────────────────────────────────────────────────────────────

const send = (b: StepBuilder, command: Extract<Command, { _tag: "Send" }>): void => {
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
  admitNext(b);
};

const stop = (b: StepBuilder, target: RunId | undefined): void => {
  const id = target ?? b.state.activeRunId;
  if (id === null) throw new Rejected("run-not-running");
  const run = b.state.runs[id];
  if (run === undefined) throw new Rejected("unknown-run");
  if (run.state === "ended") throw new Rejected("run-ended");
  if (run.stopAsked !== null) throw new Rejected("stop-already-asked");
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
    providerTurnId: run.providerTurnId,
  });
  b.emit({ _tag: "RunStopAsked", runId: run.id, by: b.envelope.principal, effectId: effect });
};

const answer = (b: StepBuilder, command: Extract<Command, { _tag: "Answer" }>): void => {
  const request = b.state.requests[command.requestId];
  if (request === undefined) throw new Rejected("unknown-request");
  if (!request.answerable) throw new Rejected("not-answerable");
  const run = b.run(request.runId);
  const effect = b.effect("provider.respond", request.id, 1, run.id, {
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
  b.emit({ _tag: "RunResumed", runId: id });
};

const steer = (b: StepBuilder, command: Extract<Command, { _tag: "Steer" }>): void => {
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

const wakeFired = (b: StepBuilder, id: Extract<Command, { _tag: "WakeFired" }>["wakeId"]) => {
  const wake = b.state.wakes[id];
  if (wake === undefined) throw new Rejected("wake-not-armed");
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
  return state.lastPersonSeq > (joined?.seq ?? wake.armedSeq);
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
  if (run === undefined || !isLive(run) || run.unresponsiveSince !== null) return;
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
  b.emit({ _tag: "EffectOutcomeRecorded", effectId: id, kind: effect.kind, outcome });
  const run = effect.runId === null ? undefined : b.state.runs[effect.runId];
  if (run === undefined || run.state === "ended") {
    if (effect.kind === "session.open" && outcome.kind === "ok") openSession(b, outcome.value);
    admitNext(b);
    return;
  }
  const failure = outcome.kind === "ok" ? null : outcome.reason;
  switch (effect.kind) {
    case "session.open":
      if (failure !== null) {
        endRun(b, run, { kind: "failed", reason: failure, next: null }, "inferred");
        admitNext(b);
        return;
      }
      openSession(b, outcome.kind === "ok" ? outcome.value : undefined);
      if (run.state === "admitted") dispatch(b, b.run(run.id), true);
      return;
    case "provider.send":
      if (failure !== null) {
        endRun(b, run, { kind: "failed", reason: failure, next: null }, "inferred");
        admitNext(b);
        return;
      }
      if (run.state === "sending") {
        const value = outcome.kind === "ok" ? outcome.value : undefined;
        const turn =
          typeof value === "object" && value !== null && "providerTurnId" in value
            ? String((value as { providerTurnId: unknown }).providerTurnId)
            : null;
        markStarted(b, run, turn);
      }
      return;
    case "provider.interrupt": {
      const by = run.stopAsked?.by ?? b.envelope.principal;
      endRun(b, run, { kind: "stopped", by }, failure === null ? "stop-confirmed" : "stop-asked");
      admitNext(b);
      return;
    }
    default:
      return;
  }
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
    model: opened.model,
    nativeRef: opened.nativeRef,
    capabilities: opened.capabilities,
    rotatedFrom: previous !== null && previous.id !== opened.sessionId ? previous.id : null,
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

/** The active run once it is live: a boundary while still sending means the turn started. */
const liveRun = (b: StepBuilder): RunRecord | undefined => {
  const run = activeRun(b.state);
  if (run === undefined || !isLive(run)) return undefined;
  if (run.state === "sending") markStarted(b, run, null);
  const live = b.run(run.id);
  if (live.unresponsiveSince !== null) b.emit({ _tag: "RunResponsive", runId: live.id });
  return b.run(run.id);
};

const signalOne = (b: StepBuilder, sessionId: SessionId, signal: ProviderSignal): void => {
  switch (signal.kind) {
    case "turn-started": {
      const run = activeRun(b.state);
      if (run?.state === "sending") return markStarted(b, run, signal.providerTurnId);
      if (run !== undefined) return;
      return selfStarted(b, signal.providerTurnId, signal.reportsOn ?? null);
    }
    case "activity": {
      const run = activeRun(b.state);
      if (run === undefined || !isLive(run)) return;
      const quiet = b.now - (run.lastActivityAt ?? 0) >= WATCHDOG_SILENCE_MS / 2;
      if (run.unresponsiveSince !== null || quiet) {
        if (run.state === "sending") markStarted(b, run, null);
        b.emit({ _tag: "RunResponsive", runId: run.id });
      }
      return;
    }
    case "item-opened":
    case "item-closed": {
      const run = liveRun(b);
      if (run === undefined) return;
      const open = Object.values(b.state.items).find((item) => item.key === signal.key);
      let id = open?.id;
      if (id === undefined) {
        id = deriveItemId(run.id, run.nextItemOrdinal);
        b.emit({
          _tag: "ItemOpened",
          runId: run.id,
          itemId: id,
          key: signal.key,
          by: signal.by ?? { kind: "mate" },
          body: signal.body,
        });
      } else if (signal.kind === "item-opened") {
        b.emit({ _tag: "ItemUpdated", runId: run.id, itemId: id, body: signal.body });
      }
      if (signal.kind === "item-closed") {
        b.emit({ _tag: "ItemClosed", runId: run.id, itemId: id, body: signal.body });
      }
      if (signal.detail !== undefined) b.details.push({ itemId: id, body: signal.detail });
      return;
    }
    case "item-updated": {
      const open = Object.values(b.state.items).find((item) => item.key === signal.key);
      if (open === undefined || liveRun(b) === undefined) return;
      b.emit({ _tag: "ItemUpdated", runId: open.runId, itemId: open.id, body: signal.body });
      return;
    }
    case "request-opened": {
      const run = liveRun(b);
      if (run === undefined) return;
      if (Object.values(b.state.requests).some((request) => request.key === signal.key)) return;
      const id = deriveRequestId(run.id, run.nextRequestOrdinal);
      b.emit({
        _tag: "RequestOpened",
        runId: run.id,
        requestId: id,
        key: signal.key,
        ask: signal.ask,
        answerable: signal.answerable ?? true,
        principal: run.principal,
      });
      if (b.run(run.id).state !== "waiting") {
        b.emit({ _tag: "RunWaiting", runId: run.id, requestId: id });
      }
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
      const run = activeRun(b.state);
      if (run === undefined || !isLive(run)) return;
      if (run.stopAsked !== null) {
        endRun(b, run, { kind: "stopped", by: run.stopAsked.by }, "stop-confirmed");
      } else if (signal.outcome.kind === "completed") {
        endRun(b, run, { kind: "completed" }, "agent");
      } else {
        endRun(
          b,
          run,
          { kind: "failed", reason: signal.outcome.reason, next: signal.outcome.next ?? null },
          "agent",
        );
      }
      admitNext(b);
      return;
    }
    case "usage-limit": {
      const run = activeRun(b.state);
      if (run !== undefined && isLive(run)) {
        endRun(b, run, { kind: "usage-limit", resetsAt: signal.resetsAt }, "agent");
        if (signal.resetsAt !== null) {
          b.emit({
            _tag: "WakeArmed",
            wakeId: deriveWakeId(b.state.conversationId, "usage-resume", run.id),
            kind: "usage-resume",
            dueAt: signal.resetsAt,
            cron: null,
            principal: run.principal,
            joins: run.id,
            text: CONTINUE_TEXT,
          });
        }
      }
      admitNext(b);
      return;
    }
    case "session-exited": {
      const run = activeRun(b.state);
      if (run !== undefined && isLive(run)) {
        if (run.stopAsked !== null) {
          endRun(b, run, { kind: "stopped", by: run.stopAsked.by }, "stop-asked");
        } else {
          endRun(b, run, { kind: "crashed", reason: signal.reason }, "inferred");
        }
      }
      b.emit({ _tag: "SessionClosed", sessionId, reason: "exited" });
      admitNext(b);
      return;
    }
  }
};

/** A turn the agent started on its own: a run that joins the run whose work it reports. */
const selfStarted = (b: StepBuilder, providerTurnId: string | null, reportsOn: RunId | null) => {
  const joins = reportsOn ?? b.state.latestRunId;
  const joined = joins === null ? undefined : b.state.runs[joins];
  const run = queueRun(b, {
    trigger: () => ({ kind: "wake", cause: "self", wakeId: null }),
    joins,
    principal: joined?.principal ?? ENGINE,
    maintenance: false,
    text: "",
  });
  b.emit({ _tag: "RunAdmitted", runId: run });
  markStarted(b, b.run(run), providerTurnId);
};

// ── recovery ────────────────────────────────────────────────────────────────────────────────

/** Why a cut run is not continued, or null when every guard passes. */
export const continuationRefusal = (state: ConversationState, run: RunRecord): string | null => {
  if (state.archived) return "archived";
  if (run.stopAsked !== null) return "a Stop was asked";
  if (run.maintenance) return "a maintenance turn";
  if (state.lastPersonSeq > run.seq) return "a newer person message";
  return null;
};

const recovered = (b: StepBuilder, cutEffects: ReadonlyArray<EffectId>): void => {
  for (const id of cutEffects) {
    const effect = b.state.effects[id];
    if (effect === undefined) continue;
    b.emit({
      _tag: "EffectOutcomeRecorded",
      effectId: id,
      kind: effect.kind,
      outcome: { kind: "cut", reason: "the server restarted" },
    });
  }
  const run = activeRun(b.state);
  if (run !== undefined && isLive(run)) {
    const refusal = continuationRefusal(b.state, run);
    endRun(
      b,
      run,
      refusal === null
        ? { kind: "cut-by-restart", continuedBy: null }
        : { kind: "cut-by-restart", continuedBy: null, notContinued: refusal },
      "inferred",
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
        text: CONTINUE_TEXT,
      });
    }
  }
  if (b.state.session !== null) {
    b.emit({ _tag: "SessionClosed", sessionId: b.state.session.id, reason: "restart" });
  }
  const admitted = activeRun(b.state);
  const opening = Object.values(b.state.effects).some(
    (effect) => effect.kind === "session.open" && effect.runId === admitted?.id,
  );
  if (admitted?.state === "admitted") {
    if (!opening) dispatch(b, admitted);
    return;
  }
  admitNext(b);
};

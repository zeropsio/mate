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
 * joins its limited run and an agent-started turn joins the run whose work it reports. Background
 * work a lost session took with it wakes the Mate once with a note naming it, unless a message
 * waiting to go carries the note. A watchdog only marks a running run unresponsive.
 *
 * @module engine/domain/decide
 */
import type { MateRestart } from "@t3tools/contracts";
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
  type PersonAttachment,
  type Principal,
  type ProviderInteractionMode,
  type ProviderOptionSelection,
  type ProviderUserInputAnswers,
  type RejectionReason,
  type RequestId,
  type RunEnd,
  type RunEndDetail,
  type RunEndSource,
  type RunId,
  type RunTrigger,
  type RuntimeMode,
  type SessionCapabilities,
  type SessionCloseReason,
  type SessionId,
  type TurnHandle,
  type UserInputAttachments,
  ItemId,
  WORK_ENDED,
} from "@t3tools/contracts";
import { changedOptionIds } from "@t3tools/shared/modelOptions";

import type { TurnOutcome } from "../bridge/spi3.ts";

import type {
  Command,
  Decision,
  EffectClass,
  EffectDraft,
  ConversationLane,
  Envelope,
  EventDraft,
  ItemDataDraft,
  ImportedRecord,
  ItemDetailDraft,
  ProviderSignal,
  ProviderUsageReport,
} from "./command.ts";
import { evolve, isUsageWake, stampEvents } from "./evolve.ts";
import {
  activeRun,
  contentDigest,
  runOfTurn,
  type ClosedItem,
  type ConversationState,
  type OpenItem,
  type OpenRequest,
  type RunRecord,
  type SessionRecord,
} from "./state.ts";

/** Silence after which the watchdog marks a run unresponsive. */
export const WATCHDOG_SILENCE_MS = 10 * 60_000;
/** The first probe of a usage limit whose reset is unknown, and the longest a probe waits. */
export const USAGE_PROBE_FIRST_MS = 15 * 60_000;
export const USAGE_PROBE_MAX_MS = 60 * 60_000;
/** What a continuation or a usage resume tells the agent. */
export const CONTINUE_TEXT = "Continue where you left off.";
/** A message a restart cut mid-send goes again in its own words, marked so the agent knows. */
export const resentText = (text: string): string =>
  `(Sent again after a server restart; it may have reached you already.)\n\n${text}`;
/**
 * Why a setting a run needs a new session for waits (V1's words, for every driver): the session it
 * would replace still runs the agent's background work.
 */
export const BACKGROUND_WORK_WORDS =
  "The agent is still running background work, and this change needs a new session that would end it. Wait for it to finish or stop it, or keep the current settings, then send the message again.";
/** How a run reads when its own agent interrupted the turn, no Stop asked. */
export const AGENT_STOPPED_ITSELF = "The agent stopped the turn itself.";

/**
 * What a driver's terminal reason says of a run's end: the context outgrew what the model takes,
 * or the provider broke the turn off. Any other reason is the agent's own end.
 */
const END_DETAILS: Readonly<Record<string, RunEndDetail>> = {
  prompt_too_long: "overflow",
  rapid_refill_breaker: "overflow",
  // An ACP agent's turn that ran out of tokens.
  max_tokens: "overflow",
  api_error: "provider-error",
  model_error: "provider-error",
  turn_setup_failed: "provider-error",
};

/** What a run's end carries beyond its kind: its cost, its context, why it broke off. */
type EndFacts = Pick<
  Extract<EventDraft, { readonly _tag: "RunEnded" }>,
  "costUsd" | "contextTokens" | "detail" | "refusal"
>;

/** The effects `decide` asks for, with the lane they queue in and what a restart does to them. */
export const EFFECT_KINDS = {
  "session.open": { lane: "turn", class: "process-bound" },
  "provider.send": { lane: "turn", class: "process-bound" },
  "provider.interrupt": { lane: "control", class: "process-bound" },
  "provider.respond": { lane: "control", class: "process-bound" },
  "session.close": { lane: "close", class: "process-bound" },
  "run.prepare": { lane: "side", class: "replay-safe" },
  "workspace.finish": { lane: "side", class: "replay-safe" },
  "provider.steer": { lane: "turn", class: "process-bound" },
  "history.import": { lane: "side", class: "replay-safe" },
} as const satisfies Record<string, { lane: ConversationLane; class: EffectClass }>;
export type EngineEffectKind = keyof typeof EFFECT_KINDS;

/** What a `session.open` effect settles with. */
export interface SessionOpenedValue {
  readonly sessionId: SessionId;
  readonly driver: string;
  readonly model: string | null;
  readonly nativeRef: string | null;
  readonly capabilities: SessionCapabilities;
  /** The model the open asked for (its payload's), when the handler says. */
  readonly requestedModel?: string | null;
  /** The instance the open asked for. */
  readonly instanceId?: string | null;
  /** The model options the open asked for. */
  readonly options?: ReadonlyArray<ProviderOptionSelection> | null;
  /** The runtime mode the session opened with. */
  readonly runtimeMode?: RuntimeMode;
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
  /** Background work this step closed as lost, for the note that tells the Mate (`noteLostWork`). */
  readonly lost: Array<LostWork> = [];
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
    case "Continue":
      return tryPastLimit(b, "the person asked to continue");
    case "ProviderUsage":
      if (limitGone(b.state, command.usage)) {
        tryPastLimit(b, "the provider no longer reports the limit");
      }
      return;
    case "Answer":
      return answer(b, command);
    case "Dismiss":
      return dismiss(b, command.requestId);
    case "Steer":
      return steer(b, command);
    case "SwitchModel":
      return switchModel(b, command.model, command.options);
    case "SetRuntimeMode":
      return setRuntimeMode(b, command.runtimeMode);
    case "ChooseAgent":
      return chooseAgent(b, command);
    case "AssignAgent":
      if (b.state.archived) throw new Rejected("archived");
      if (JSON.stringify(b.state.agent) !== JSON.stringify(command.agent)) {
        b.emit({ _tag: "AgentAssigned", agent: command.agent, by: b.envelope.principal });
      }
      return;
    case "CloseSession":
      return closeSession(b, command.reason);
    case "RotateSession":
      return rotateSession(b, command);
    case "MarkSeam":
      return recordLoose(b, {
        kind: "marker",
        marker: {
          kind: "crew.seam",
          ...(command.words === null ? {} : { reason: command.words }),
          seam: command.seam,
        },
      });
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
      return recovered(
        b,
        command.cutEffects,
        command.unstartedEffects ?? [],
        command.words,
        command.restart,
      );
    case "ImportHistory":
      return importHistory(b, command);
    case "HistoryBatch":
      return historyBatch(b, command);
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
    readonly interactionMode?: ProviderInteractionMode;
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
    ...(input.interactionMode === undefined || input.interactionMode === "default"
      ? {}
      : { interactionMode: input.interactionMode }),
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
  // The earlier record goes in first: a run admitted now would answer without it.
  if (b.state.history?.state === "importing") return;
  const next = paused(b) ? undefined : b.state.queue[0];
  if (next === undefined) {
    releaseLostWork(b);
    return armIdle(b);
  }
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

/**
 * How long the engine expects the agent's own turn on what it finished, once no run is on: Claude
 * opens it within seconds (Milo's stress run 4: 1.6–3.3 s). One that never comes, or one turn that
 * took several results, holds nothing longer. The update's drain waits the same (`toCore`).
 */
export const AGENT_TURN_DUE_MS = 30_000;

const turnDueWakeId = (b: StepBuilder) =>
  deriveWakeId(b.state.conversationId, "agent-turn-due", "next");

/**
 * The Mate's finished work waits for the turn its agent opens to take the result
 * (`reportsDue`): with no run on, the conversation goes on until that turn opens, within
 * `AGENT_TURN_DUE_MS` of now. A run on, or one waiting to go, is the conversation going on.
 */
const expectAgentTurn = (b: StepBuilder): void => {
  if (b.state.reportsDue === 0) return;
  if (b.state.session === null || b.state.closing !== null) return;
  if (b.state.activeRunId !== null || b.state.queue.length > 0) return;
  b.emit({
    _tag: "WakeArmed",
    wakeId: turnDueWakeId(b),
    kind: "agent-turn-due",
    dueAt: b.now + AGENT_TURN_DUE_MS,
    cron: null,
    principal: ENGINE,
    joins: b.state.latestRunId,
    text: null,
  });
};

/** A run started: the agent's own turn, if one was due, is no longer waited for. */
const endTurnDue = (b: StepBuilder): void => {
  if (b.state.wakes[turnDueWakeId(b)] === undefined) return;
  b.emit({ _tag: "WakeCancelled", wakeId: turnDueWakeId(b), reason: "a run started" });
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
 * What a live session lacks to run the conversation's next run, or null when it fits — the one
 * place a session is closed to be opened again. A rotation asked since it opened replaces it. It fits by
 * what the engine asked for when it opened it — the model, the instance and the driver, never the
 * driver's own spelling of the model — and by the conversation's settings: its runtime mode, and
 * every model option it does not take per turn (a session opened before the engine said fits any).
 */
const misfit = (
  state: ConversationState,
  session: SessionRecord,
): "closed" | "model" | "settings" | null => {
  // Read loosely: a record from before the rotation was kept carries none.
  if (state.rotation != null) return "closed";
  const agent = state.agent;
  if (session.requestedModel !== state.model) return "model";
  if (
    agent !== null &&
    session.instanceId !== null &&
    (session.instanceId !== agent.instanceId || session.driver !== agent.driver)
  ) {
    return "model";
  }
  if (
    state.runtimeMode !== null &&
    session.runtimeMode !== null &&
    session.runtimeMode !== state.runtimeMode
  ) {
    return "settings";
  }
  if (session.options === null) return null;
  const changed = changedOptionIds(session.options, agent?.options);
  const inSession = session.capabilities.inSessionOptions ?? [];
  return inSession === "all" || changed.every((id) => inSession.includes(id)) ? null : "settings";
};

/**
 * A session is gone, and with it the background work it ran: nothing can report that work's end
 * any more (a session's own close says so through the bridge, but a restart or a close recorded
 * first never hears it), so the work ends as lost and its card stops showing it running — and the
 * Mate, which may have promised to answer once it ended, is told (`noteLostWork`).
 */
const sessionClosed = (b: StepBuilder, sessionId: SessionId, reason: SessionCloseReason): void => {
  b.emit({ _tag: "SessionClosed", sessionId, reason });
  for (const item of Object.values(b.state.items)) {
    if (item.body.kind !== "work" || WORK_ENDED.has(item.body.status)) continue;
    b.emit({
      _tag: "ItemClosed",
      runId: item.runId,
      itemId: item.id,
      body: { ...item.body, status: reason === "stop" ? "stopped" : "lost", endedAt: b.now },
    });
    b.lost.push({ title: item.body.title, runId: item.runId, how: LOST_HOW[reason] });
  }
  noteLostWork(b);
};

/** Work closed as lost, and how its session went, in the note's words (none: tell nothing). */
interface LostWork {
  readonly title: string | null;
  readonly runId: RunId | null;
  readonly how: string | undefined;
}

/** How the note says a person's Stop ended the work: never a restart (Milo called it one). */
const BY_THE_PERSON = "by the person";

/** How the note says the work's session went, by why it closed; a close not listed tells nothing. */
const LOST_HOW: Partial<Record<SessionCloseReason, string>> = {
  restart: "by a restart",
  exited: "when its session ended",
  model: "by a session change",
  settings: "by a session change",
  stop: BY_THE_PERSON,
};

/** The wake that tells the Mate its background work was lost: one per conversation. */
const lostWorkWakeId = (b: StepBuilder) =>
  deriveWakeId(b.state.conversationId, "lost-work", "note");

/**
 * The note that tells the Mate a person's Stop ended its background work: held for the next
 * message, never released to a run of its own — the person stopped the work on purpose.
 */
const stoppedWorkWakeId = (b: StepBuilder) =>
  deriveWakeId(b.state.conversationId, "lost-work", "stopped");

/** The lost-work notes waiting for the next message: the person's Stop's first. */
const workNotes = (b: StepBuilder) =>
  [b.state.wakes[stoppedWorkWakeId(b)], b.state.wakes[lostWorkWakeId(b)]].filter(
    (wake): wake is NonNullable<typeof wake> => wake !== undefined && wake.text !== null,
  );

/** A person's Stop is in force: the close it asked, or the latest run it stopped. */
const personStopped = (state: ConversationState): boolean =>
  state.closing?.reason === "stop" ||
  (state.latestRunId !== null && state.runs[state.latestRunId]?.stopAsked != null);

/** A lost-work note held for the next send: it never fires on its own. */
const HELD_FOR_SEND = Number.MAX_SAFE_INTEGER;

/** What the Mate is told of work its session lost, by the work's own titles. */
export const lostWorkText = (titles: ReadonlyArray<string | null>, how: string): string => {
  const named = titles.map((title) => (title === null ? "untitled work" : `“${title}”`));
  const list =
    named.length === 1 ? named[0]! : `${named.slice(0, -1).join(", ")} and ${named.at(-1)!}`;
  return named.length === 1
    ? `Your background work ${list} was stopped ${how} before it reported.`
    : `Your background work ${list} were stopped ${how} before they reported.`;
};

/** A run whose message has not reached the agent yet: queued, admitted, or its send in flight. */
const runPending = (state: ConversationState): boolean => {
  if (state.queue.length > 0) return true;
  const run = activeRun(state);
  if (run !== undefined && ["queued", "admitted", "sending"].includes(run.state)) return true;
  return Object.values(state.wakes).some((wake) => wake.kind === "restart-continuation");
};

/**
 * Background work its session lost (a restart, the process dying, a session change) never
 * reports, and the agent re-invoked by its end — Claude Code's background tasks — is never woken:
 * the engine wakes the Mate once, on the conversation's own lane, with a note naming the work. A
 * message already waiting (a person's, a restart's continuation) carries the note instead of a
 * wake of its own (`dispatch`). Nothing after a person's Stop or an archive, or a close the engine
 * or the person chose (idle, signed out, a Stop's close).
 */
const noteLostWork = (b: StepBuilder): void => {
  const all = b.lost.splice(0).filter((work) => work.how !== undefined);
  if (all.length === 0 || b.state.archived) return;
  noteStoppedWork(
    b,
    all.filter((work) => work.how === BY_THE_PERSON),
  );
  const lost = all.filter((work) => work.how !== BY_THE_PERSON);
  if (lost.length === 0) return;
  const latest = b.state.latestRunId === null ? undefined : b.state.runs[b.state.latestRunId];
  if (latest?.stopAsked != null) return;
  // A crew's run, or any in a crewmate's chat, is its crew's to carry on: no turn of the engine's.
  if (crewCarriesOn(b.state, { principal: latest?.principal ?? ENGINE })) return;
  const hows = [...new Set(lost.map((work) => work.how!))];
  const text = hows
    .map((how) =>
      lostWorkText(
        lost.filter((work) => work.how === how).map((work) => work.title),
        how,
      ),
    )
    .join(" ");
  const armed = b.state.wakes[lostWorkWakeId(b)];
  const served = lost.findLast((work) => work.runId !== null)?.runId ?? null;
  b.emit({
    _tag: "WakeArmed",
    wakeId: lostWorkWakeId(b),
    kind: "lost-work",
    dueAt: runPending(b.state) ? HELD_FOR_SEND : b.now,
    cron: null,
    principal: latest?.principal ?? ENGINE,
    // Its answer draws on the card of the run the work served, while that run is the latest.
    joins: served !== null && served === b.state.latestRunId ? served : null,
    text: armed?.text == null ? text : `${armed.text} ${text}`,
  });
};

/** Work a person's Stop ended, told with the next message the agent gets. */
const noteStoppedWork = (b: StepBuilder, stopped: ReadonlyArray<LostWork>): void => {
  if (stopped.length === 0) return;
  const text = lostWorkText(
    stopped.map((work) => work.title),
    BY_THE_PERSON,
  );
  const armed = b.state.wakes[stoppedWorkWakeId(b)];
  const latest = b.state.latestRunId === null ? undefined : b.state.runs[b.state.latestRunId];
  b.emit({
    _tag: "WakeArmed",
    wakeId: stoppedWorkWakeId(b),
    kind: "lost-work",
    dueAt: HELD_FOR_SEND,
    cron: null,
    principal: latest?.principal ?? ENGINE,
    joins: null,
    text: armed?.text == null ? text : `${armed.text} ${text}`,
  });
};

/**
 * The send's words with the lost-work notes waiting for it, which go with them. A note stays held
 * until the run starts (`spendLostWorkNote`): a send cut or refused goes again with it.
 */
const withLostWorkNote = (b: StepBuilder, run: RunRecord): string => {
  const notes = workNotes(b);
  if (notes.length === 0 || run.maintenance) return run.text;
  for (const wake of notes) {
    if (wake.dueAt !== HELD_FOR_SEND) rearmLostWork(b, wake, HELD_FOR_SEND);
  }
  return `${notes.map((wake) => wake.text).join(" ")}\n\n${run.text}`;
};

const rearmLostWork = (
  b: StepBuilder,
  wake: ConversationState["wakes"][string],
  dueAt: number,
): void => {
  b.emit({
    _tag: "WakeArmed",
    wakeId: wake.id,
    kind: wake.kind,
    dueAt,
    cron: null,
    principal: wake.principal,
    joins: wake.joins,
    text: wake.text,
  });
};

/** A run that carried the note started: the agent has it. A self turn carried nothing. */
const spendLostWorkNote = (b: StepBuilder, run: RunRecord): void => {
  if (run.maintenance || !needsPrepare(run)) return;
  for (const wake of workNotes(b)) {
    b.emit({ _tag: "WakeCancelled", wakeId: wake.id, reason: "went with the run's message" });
  }
};

/** A note held for a message that will not go any more fires on its own. */
const releaseLostWork = (b: StepBuilder): void => {
  const wake = b.state.wakes[lostWorkWakeId(b)];
  if (wake === undefined || wake.dueAt !== HELD_FOR_SEND || runPending(b.state)) return;
  rearmLostWork(b, wake, b.now);
};

/** The agent's background work lives in the session: a new session would end it. */
const workLives = (state: ConversationState): boolean =>
  Object.values(state.items).some(
    (item) => item.body.kind === "work" && !WORK_ENDED.has(item.body.status),
  );

/** The model selection a send carries, so a session applies the options it takes per turn. */
const selectionOf = (state: ConversationState) =>
  state.agent === null || state.model === null
    ? null
    : {
        instanceId: state.agent.instanceId,
        model: state.model,
        ...(state.agent.options === undefined ? {} : { options: state.agent.options }),
      };

/**
 * Sends an admitted run on a fitting session, or asks for one; a session just opened for this run
 * fits. One that does not fit is closed first and the next one resumes it (a model switch or a
 * setting rotates it), or opens as the crew's rotation says — between runs, never under a running
 * turn. A run that needs a new session
 * for a setting while the agent's background work lives in this one waits — never ending that
 * work — until the work ends or the setting changes back (a message sent meanwhile is refused in
 * V1's words). A run whose workspace capture has not settled, or a session closing, waits.
 */
const dispatch = (b: StepBuilder, run: RunRecord, justOpened = false): void => {
  if (needsPrepare(run) && run.prepare !== "done") return;
  if (b.state.closing !== null) return;
  const opening = Object.values(b.state.effects).some(
    (effect) => effect.kind === "session.open" && effect.runId === run.id,
  );
  if (opening) return;
  const session = b.state.session;
  const lacks = session === null || justOpened ? null : misfit(b.state, session);
  if (lacks === "settings" && workLives(b.state)) return;
  if (lacks !== null) return closeSession(b, lacks);
  if (session !== null) {
    const selection = selectionOf(b.state);
    const text = withLostWorkNote(b, run);
    const effect = b.effect("provider.send", run.id, run.sendAttempts + 1, run.id, {
      runId: run.id,
      sessionId: session.id,
      turn: run.id,
      text,
      attachments: (run.personBody?.attachments ?? []).filter(
        (attachment) => attachment.type === "image" || attachment.type === "file",
      ),
      ...(selection === null ? {} : { modelSelection: selection }),
      ...(run.interactionMode === "default" ? {} : { interactionMode: run.interactionMode }),
    });
    b.emit({ _tag: "RunSending", runId: run.id, sessionId: session.id, effectId: effect });
    return;
  }
  // Read loosely: a record from before the rotation was kept carries none.
  const rotation = b.state.rotation ?? null;
  b.effect("session.open", run.id, run.sessionOpenAttempts + 1, run.id, {
    runId: run.id,
    instanceId: b.state.agent?.instanceId ?? null,
    driver: b.state.agent?.driver ?? null,
    model: b.state.model,
    options: b.state.agent?.options ?? null,
    ...(b.state.runtimeMode === null ? {} : { runtimeMode: b.state.runtimeMode }),
    // A fresh rotation resumes nothing: its session starts on a thread of its own.
    resume: rotation?.fresh === true ? null : b.state.lastNativeRef,
    rotateFrom: b.state.rotatingFrom,
    generation: b.state.threadGeneration,
    ...(rotation === null ? {} : { fresh: rotation.fresh, seed: rotation.seed }),
  });
};

/**
 * The crew rotates a conversation's session between turns: the boundary and the seed are recorded
 * at once (rule 9: what the agent is told is in the record); the next run closes the open session
 * (dispatch's `misfit`, the one place a session is replaced) and opens the next as the rotation
 * says, never under a running turn.
 */
const rotateSession = (b: StepBuilder, command: Extract<Command, { _tag: "RotateSession" }>) => {
  if (b.state.archived) throw new Rejected("archived");
  b.emit({
    _tag: "SessionRotated",
    reason: command.reason,
    fresh: command.fresh,
    seed: command.seed,
  });
  recordLoose(b, { kind: "marker", marker: { kind: "session-rotated", reason: command.reason } });
  if (command.seed !== null) recordLoose(b, { kind: "context", notes: [command.seed] });
};

/** An item of the conversation's own, under no run, closed as it opens. */
const recordLoose = (b: StepBuilder, body: ItemBody): void => {
  const id = ItemId.make(`${b.state.conversationId}/b/${b.state.headSeq + 1}`);
  b.emit({ _tag: "ItemOpened", runId: null, itemId: id, key: null, by: ENGINE_ACTOR, body });
  b.emit({ _tag: "ItemClosed", runId: null, itemId: id, body });
};

// ── settings ────────────────────────────────────────────────────────────────────────────────

/** The admitted run sends now, if nothing holds it any more. */
const redispatch = (b: StepBuilder): void => {
  const run = activeRun(b.state);
  if (run?.state === "admitted") dispatch(b, run);
};

/**
 * A change that only a new session runs with, asked while the agent's background work lives in
 * the session, is refused: it would end that work (V1 refuses it the same way). So is a message
 * that would need such a session.
 */
const refuseOverWork = (b: StepBuilder): void => {
  const session = b.state.session;
  if (session === null || !workLives(b.state)) return;
  if (misfit(b.state, session) === "settings") {
    throw new Rejected("background-work", BACKGROUND_WORK_WORDS);
  }
};

const sameOptions = (
  left: ReadonlyArray<ProviderOptionSelection> | undefined,
  right: ReadonlyArray<ProviderOptionSelection> | undefined,
) => changedOptionIds(left, right).length === 0;

/** The next model and its options: they apply from the next run on, never under a running turn. */
const switchModel = (
  b: StepBuilder,
  model: string,
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
): void => {
  if (b.state.archived) throw new Rejected("archived");
  const optionsChange = options !== undefined && !sameOptions(b.state.agent?.options, options);
  if (b.state.model === model && !optionsChange) return;
  b.emit({
    _tag: "ModelSwitched",
    model,
    by: b.envelope.principal,
    ...(optionsChange ? { options: [...options] } : {}),
  });
  refuseOverWork(b);
  redispatch(b);
};

/** How freely the agent works: from the next run on, in a session that resumes this one. */
const setRuntimeMode = (b: StepBuilder, runtimeMode: RuntimeMode): void => {
  if (b.state.archived) throw new Rejected("archived");
  if (b.state.runtimeMode === runtimeMode) return;
  b.emit({ _tag: "RuntimeModeSet", runtimeMode, by: b.envelope.principal });
  refuseOverWork(b);
  redispatch(b);
};

/**
 * A person's pick of another agent. Before the conversation has started, any instance; after,
 * only an instance of its driver whose sessions resume the current one's — its thread carries
 * over and the next session resumes it. Another driver is refused in V1's words.
 */
const chooseAgent = (b: StepBuilder, command: Extract<Command, { _tag: "ChooseAgent" }>): void => {
  actsForSomeone(b);
  if (b.state.archived) throw new Rejected("archived");
  const current = b.state.agent;
  if (current !== null && current.instanceId === command.instanceId) {
    return switchModel(b, command.model, command.options);
  }
  const started =
    b.state.nextRunOrdinal > 1 || b.state.session !== null || b.state.lastNativeRef !== null;
  if (current !== null && started) {
    if (current.driver !== command.driver) {
      throw new Rejected(
        "agent-locked",
        `This conversation is bound to driver '${current.driver}' and cannot switch to '${command.driver}'.`,
      );
    }
    if (!command.resumes) {
      throw new Rejected(
        "agent-locked",
        `This conversation cannot switch from instance '${current.instanceId}' to '${command.instanceId}' because their provider resume state is incompatible.`,
      );
    }
  }
  b.emit({
    _tag: "AgentAssigned",
    agent: {
      instanceId: command.instanceId,
      driver: command.driver,
      model: command.model,
      ...(command.options === undefined ? {} : { options: [...command.options] }),
      profile: current?.profile ?? { kind: "mate" },
    },
    by: b.envelope.principal,
    ...(current !== null && started ? { keepsThread: true } : {}),
  });
};

type Delivery = "delivered" | "steered" | "refused" | "unknown";

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
  facts: EndFacts = {},
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
    // A question asked by message outlives its turn: the person answers it with a message.
    if (request.runId !== run.id || request.dismissible === true) continue;
    b.emit({ _tag: "RequestClosed", runId: run.id, requestId: request.id, state: "lapsed" });
  }
  const carried = answerCarried(b, run);
  // A message a restart cut mid-flight goes again, marked, by the run continuing it (rule: a cut
  // send is reconciled, never re-sent blindly): its answer waits for that run's evidence.
  const resent =
    end.kind === "cut-by-restart" && end.notContinued === undefined && run.state === "sending";
  if (carried !== undefined && !resent) {
    reopenCarried(b, carried, `The answer's message did not reach the agent (${end.kind}).`);
  }
  cancelWatchdog(b, run, "run ended");
  if (run.personBody?.delivery.state === "queued") {
    updatePerson(b, run, run.state === "sending" ? unsent : "refused");
  }
  b.emit({ _tag: "RunEnded", runId: run.id, end, source, ...facts });
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
  delivery: "delivered" | "steered" = "delivered",
): void => {
  b.emit({ _tag: "RunStarted", runId: run.id, providerTurnId, turn });
  endTurnDue(b);
  spendLostWorkNote(b, run);
  updatePerson(b, run, delivery);
  armWatchdog(b, b.run(run.id), b.now);
  // The message carrying an answer reached the agent: that is the answer's evidence.
  const carried = answerCarried(b, run);
  if (carried !== undefined) {
    b.emit({
      _tag: "RequestClosed",
      runId: carried.runId,
      requestId: carried.id,
      state: "answered",
    });
  }
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
  refuseOverWork(b);
  const sleeping = sleepingTurn(b);
  if (sleeping !== undefined) {
    // Queued behind it, the message would never come: the turn waits for it.
    steerInto(b, sleeping.run, sleeping.sessionId, command.text, attachments);
    return;
  }
  const ordinal = b.state.nextRunOrdinal;
  const item = deriveItemId(deriveRunId(b.state.conversationId, ordinal), 1);
  const run = queueRun(b, {
    trigger: () => ({ kind: "person", itemId: item }),
    joins: null,
    principal: b.envelope.principal,
    maintenance: command.maintenance === true,
    text: command.text,
    ...(command.interactionMode === undefined ? {} : { interactionMode: command.interactionMode }),
  });
  b.emit({
    _tag: "ItemOpened",
    runId: run,
    itemId: item,
    key: null,
    by:
      command.card === undefined
        ? { kind: "person", principal: b.envelope.principal }
        : ENGINE_ACTOR,
    body:
      command.card === undefined
        ? {
            kind: "person",
            text: command.text,
            attachments: [...attachments],
            sendId: b.envelope.commandId,
            delivery: { state: "queued", at: null },
          }
        : { kind: "note", text: command.text, streaming: false, answer: false, card: command.card },
  });
  if (command.card !== undefined) {
    // The card is whole as it is sent: closed at once, as a seam is.
    b.emit({
      _tag: "ItemClosed",
      runId: run,
      itemId: item,
      body: {
        kind: "note",
        text: command.text,
        streaming: false,
        answer: false,
        card: command.card,
      },
    });
  }
  b.result = { ...b.result, itemId: item };
  if (b.state.pausedUntil === "unknown") {
    // A limit whose reset nobody knows holds the queue until its probe or the person: they wrote.
    cancelUsageWakes(b, "the person wrote again");
    b.emit({ _tag: "UsagePauseLifted", reason: "the person wrote again" });
  }
  admitNext(b);
};

/**
 * The turn still sleeping on a question asked by message that the person dismissed (Codex waits
 * for input inside it), while it lives on the current session.
 */
const sleepingTurn = (
  b: StepBuilder,
): { readonly run: RunRecord; readonly sessionId: SessionId } | undefined => {
  if (b.state.activeRunId === null) return undefined;
  const run = b.state.runs[b.state.activeRunId];
  const session = b.state.session;
  if (run === undefined || !run.awaitsMessage || session === null) return undefined;
  if (run.state !== "running" && run.state !== "waiting") return undefined;
  if (run.sessionId !== session.id) return undefined;
  return { run, sessionId: session.id };
};

/**
 * A Stop with no turn running stops what the Mate still does: the helpers and background work
 * living on in the session its turn ended in. Nothing stops one piece of an agent's background
 * work across drivers, so the session closes (V1's Claude Stop is the same hard boundary); its
 * work ends as stopped, and the next message resumes the conversation on a new session.
 */
const stopWork = (b: StepBuilder): void => {
  const session = b.state.session;
  if (session === null || !workLives(b.state)) throw new Rejected("run-not-running");
  if (b.state.closing !== null) {
    throw new Rejected(
      b.state.closing.reason === "stop" ? "stop-already-asked" : "run-not-running",
    );
  }
  const served = Object.values(b.state.items).findLast(
    (item) => item.body.kind === "work" && !WORK_ENDED.has(item.body.status),
  )?.runId;
  b.result = { ...b.result, ...(served == null ? {} : { runId: served }) };
  closeSession(b, "stop");
};

const stop = (b: StepBuilder, target: RunId | undefined): void => {
  const id = target ?? b.state.activeRunId;
  if (id === null) return stopWork(b);
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
  if (request.dismissible === true) return answerByMessage(b, request, command);
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
    ...(request.kind === "question" ? questionAnswer(command.answer) : {}),
  });
  b.result = { ...b.result, requestId: request.id, runId: run.id };
  resumeIfAnswered(b, run.id);
};

/**
 * A question asked by message (Codex's async question) takes its answer as V1 gives it: the
 * person's message, each question with its answer and the names of the files attached to it, the
 * pictures beside it. The driver has no call waiting for it. The request is answered once that
 * message reaches the agent (`markStarted`), and opens again if it never does (`endRun`).
 */
const answerByMessage = (
  b: StepBuilder,
  request: OpenRequest,
  command: Extract<Command, { _tag: "Answer" }>,
): void => {
  const given = questionAnswer(command.answer);
  const answers = (given.answers ?? {}) as Readonly<Record<string, unknown>>;
  const byQuestion = given.attachmentsByQuestionId ?? {};
  const unanswered = () => new Rejected("empty-message", "Answer each question before sending.");
  const questions = request.questions ?? [];
  if (questions.length === 0) throw unanswered();
  const replies = questions.map((question) => {
    const said = answers[question.id];
    const files = byQuestion[question.id] ?? [];
    if (typeof said !== "string" || (said.trim() === "" && files.length === 0)) throw unanswered();
    const named = files.map((file) => `Attached file: ${file.name} (${file.id})`).join("\n");
    return [`${question.question}\n${said.trim()}`, named].filter(Boolean).join("\n");
  });
  // The message carries every attachment as V1's does: pictures and files, each also named.
  const attachments = Object.values(byQuestion).flat();
  const text = replies.join("\n\n");
  // The person's message shows the answer, so the question's record keeps its summary alone.
  const answered = {
    _tag: "RequestAnswered",
    runId: request.runId,
    requestId: request.id,
    by: b.envelope.principal,
    summary: command.summary,
  } as const;
  const asking = b.state.runs[request.runId];
  const session = b.state.session;
  if (
    asking !== undefined &&
    (asking.state === "running" || asking.state === "waiting") &&
    session !== null &&
    session.id === asking.sessionId
  ) {
    // The agent waits inside the turn that asked (Codex sleeps until the input comes): the
    // answer goes into that turn, as V1's turn start does, measured on Codex 0.161.0.
    const effect = steerInto(b, asking, session.id, text, attachments);
    b.emit({ ...answered, effectId: effect });
    b.result = { ...b.result, requestId: request.id, runId: asking.id };
    return;
  }
  // Its turn is over: the answer is the next message, a run of its own.
  const carrier = deriveRunId(b.state.conversationId, b.state.nextRunOrdinal);
  send(b, {
    _tag: "Send",
    text,
    attachments,
    ...(b.state.interactionMode === null ? {} : { interactionMode: b.state.interactionMode }),
  });
  b.emit({ ...answered, bySend: carrier });
  b.result = { ...b.result, requestId: request.id, runId: carrier };
};

/** The answer a run's message carries: its own, or the one of the run it continues after a restart. */
const answerCarried = (b: StepBuilder, run: RunRecord): OpenRequest | undefined => {
  const own = b.state.answering[run.id];
  if (own !== undefined || run.joins === null || run.trigger.kind !== "wake") return own;
  const continues =
    run.trigger.wakeId === deriveWakeId(b.state.conversationId, "restart-continuation", run.joins);
  return continues ? b.state.answering[run.joins] : undefined;
};

/** The message carrying an answer never reached the agent: the person answers again. */
const reopenCarried = (b: StepBuilder, carried: OpenRequest, reason: string): void => {
  b.emit({
    _tag: "RequestReopened",
    runId: carried.runId,
    requestId: carried.id,
    key: carried.key,
    principal: carried.principal,
    reason,
    answers: carried.answers,
  });
};

/**
 * A request closed unanswered: only one its agent does not wait on, so nothing reaches the agent
 * (as V1's dismissal). The run it held resumes.
 */
const dismiss = (b: StepBuilder, id: RequestId): void => {
  const request = b.state.requests[id];
  if (request === undefined) throw new Rejected("unknown-request");
  if (request.dismissible !== true) throw new Rejected("not-dismissible");
  b.emit({ _tag: "RequestClosed", runId: request.runId, requestId: id, state: "dismissed" });
  b.result = { ...b.result, requestId: id, runId: request.runId };
  resumeIfAnswered(b, request.runId);
};

/** What a question's record keeps of its answer: the words and pictures, by question id. */
const questionAnswer = (
  answer: unknown,
): Pick<
  Extract<EventDraft, { _tag: "RequestAnswered" }>,
  "answers" | "attachmentsByQuestionId"
> => {
  if (typeof answer !== "object" || answer === null) return {};
  const given = answer as {
    readonly answers?: ProviderUserInputAnswers;
    readonly attachmentsByQuestionId?: UserInputAttachments;
  };
  return {
    ...(given.answers === undefined ? {} : { answers: given.answers }),
    ...(given.attachmentsByQuestionId === undefined
      ? {}
      : { attachmentsByQuestionId: given.attachmentsByQuestionId }),
  };
};

const resumeIfAnswered = (b: StepBuilder, id: RunId): void => {
  // A question asked by message outlives its run, which the state may no longer hold.
  const run = b.state.runs[id];
  if (run === undefined || run.state !== "waiting") return;
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
  steerInto(b, run, session.id, command.text, []);
};

/** The person's message into the run's turn: its item, steered, and the effect that sends it. */
const steerInto = (
  b: StepBuilder,
  run: RunRecord,
  sessionId: SessionId,
  text: string,
  attachments: ReadonlyArray<PersonAttachment>,
): EffectId => {
  const item = deriveItemId(run.id, run.nextItemOrdinal);
  b.emit({
    _tag: "ItemOpened",
    runId: run.id,
    itemId: item,
    key: null,
    by: { kind: "person", principal: b.envelope.principal },
    body: {
      kind: "person",
      text,
      attachments: [...attachments],
      sendId: b.envelope.commandId,
      delivery: { state: "steered", at: b.now },
    },
  });
  const effect = b.effect("provider.steer", item, 1, run.id, {
    runId: run.id,
    sessionId,
    itemId: item,
    text,
    ...(attachments.length === 0 ? {} : { attachments: [...attachments] }),
    instanceId: b.state.agent?.instanceId ?? null,
    principal: b.envelope.principal,
  });
  b.result = { ...b.result, runId: run.id, itemId: item };
  return effect;
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
        const carried = joined === null ? undefined : b.state.answering[joined];
        if (carried !== undefined)
          reopenCarried(b, carried, `The answer's message was not sent again: ${refusal}.`);
        admitNext(b);
        return;
      }
      startFromWake(b, wake.kind, id, wake);
      return;
    }
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

// ── effects ─────────────────────────────────────────────────────────────────────────────────

const effectSettled = (b: StepBuilder, id: EffectId, outcome: EffectOutcome): void => {
  const effect = b.state.effects[id];
  if (effect === undefined) throw new Rejected("unknown-effect");
  const answered = b.state.answering[id];
  const closing = b.state.closing?.effectId === id ? b.state.closing : null;
  b.emit({ _tag: "EffectOutcomeRecorded", effectId: id, kind: effect.kind, outcome });
  if (effect.kind === "history.import") return historySettled(b, id, outcome);
  const failure =
    outcome.kind === "ok"
      ? null
      : outcome.kind === "unknown"
        ? `an outcome this build does not know (${outcome.type})`
        : outcome.kind === "timed-out"
          ? `The agent did not answer within ${Math.round(outcome.after / 1000)} s.`
          : outcome.reason;
  // A call that timed out says nothing of what the agent did: only evidence ends a run.
  const timedOut = outcome.kind === "timed-out";
  if (effect.kind === "session.close") return sessionCloseSettled(b, closing, outcome);
  if (effect.kind === "provider.steer" && answered !== undefined) {
    // The answer steered into the turn that waits on it: taken is its evidence. One the agent
    // never said it took, refused or unanswered in time, is the person's to give again.
    if (failure === null) {
      b.emit({
        _tag: "RequestClosed",
        runId: answered.runId,
        requestId: answered.id,
        state: "answered",
      });
    } else reopenCarried(b, answered, `The answer did not reach the agent: ${failure}`);
  }
  const run = effect.runId === null ? undefined : b.state.runs[effect.runId];
  if (run === undefined || run.state === "ended") {
    if (effect.kind === "session.open" && outcome.kind === "ok") openSession(b, outcome.value);
    admitNext(b);
    return;
  }
  switch (effect.kind) {
    case "run.prepare": {
      if (outcome.kind === "failed" && outcome.refused === true) {
        // A message that already went into the agent's own turn: its steer asks admission too,
        // and its refusal reads on the message; the agent's turn runs on.
        if (run.state !== "admitted") return;
        // Only admission refuses a run, and before anything of it ran: its words are the refusal.
        endRun(
          b,
          run,
          { kind: "failed", reason: outcome.reason, next: null },
          "inferred-from-effect",
          undefined,
          { detail: "refused", refusal: outcome.reason },
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
      const itemId = id.slice(0, id.indexOf("/e/provider.steer/"));
      const undelivered = outcome.kind === "failed" ? outcome.undelivered : undefined;
      // A waiting message steered into the agent's own turn is its run's own message.
      if (run.trigger.kind === "person" && run.trigger.itemId === itemId) {
        updatePerson(
          b,
          run,
          undelivered === undefined || undelivered === true ? "refused" : "unknown",
        );
        return;
      }
      const item = b.state.items[itemId];
      if (item?.body.kind !== "person") return;
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
      // ends. An interrupt that failed leaves nothing to wait for, so the Stop ends the run; one
      // that timed out may still land, so the run waits on its turn (or a second Stop).
      if (failure !== null && !timedOut && run.stopAsked !== null && isLive(run)) {
        endRun(b, run, { kind: "stopped", by: run.stopAsked.by }, "stop-asked");
        admitNext(b);
      }
      return;
    case "provider.respond":
      // An answer that timed out may have reached the agent: the request's close will say.
      if (failure === null || timedOut || answered === undefined || !isLive(run)) return;
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
    sessionClosed(b, b.state.session.id, "exited");
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
    sessionClosed(b, closing.sessionId, closing.reason);
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
    sessionClosed(b, previous.id, "model");
  }
  b.emit({
    _tag: "SessionOpened",
    sessionId: opened.sessionId,
    driver: opened.driver,
    // What the open asked for, never what the conversation says now: a switch meanwhile rotates.
    requestedModel: opened.requestedModel !== undefined ? opened.requestedModel : b.state.model,
    ...(opened.instanceId === undefined ? {} : { instanceId: opened.instanceId }),
    ...(opened.options == null ? {} : { options: [...opened.options] }),
    ...(opened.runtimeMode === undefined ? {} : { runtimeMode: opened.runtimeMode }),
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
    if (b.state.session?.id !== sessionId) break;
    signalOne(b, sessionId, signal);
  }
  // The work the bridge said its closing session lost, told in one note.
  noteLostWork(b);
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
      // A steer that met no running turn (its run's turn ended first) opened one of its own: the
      // engine runs it as the agent's own turn on that run's behalf.
      const steered = steerOpened(b, signal.turn);
      if (signal.origin !== "self" && steered === undefined) return;
      const active = activeRun(b.state);
      if (active !== undefined && active.state !== "admitted") return;
      // A person's message waiting for its turn goes into this one, never after it.
      const waiting = steered === undefined ? waitingMessage(b) : undefined;
      if (waiting !== undefined) {
        return joinOwnTurn(b, waiting, signal.turn, signal.providerTurnId);
      }
      const joined = selfJoins(b, signal.reportsOn ?? steered ?? null);
      // Nobody to act for (no run before it): the turn is not the engine's to record as a run.
      if (joined === undefined) return;
      // A run still being prepared has sent nothing: it goes back to the head of the queue and
      // is sent when the agent's own turn ends.
      if (active?.state === "admitted") {
        b.emit({
          _tag: "RunRequeued",
          runId: active.id,
          reason: "the agent started a turn of its own",
        });
      }
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
      // Asked by message: the agent does not wait on it, and a message answers it after its turn.
      const byMessage = signal.ask.kind === "question" && signal.ask.dismissible;
      b.emit({
        _tag: "RequestOpened",
        runId: run.id,
        requestId: id,
        key: signal.key,
        ask: signal.ask,
        answerable: (live || byMessage) && (signal.answerable ?? true),
        principal: run.principal,
      });
      // The agent's message that asked it: the request takes its place in the record.
      const asker =
        signal.item === undefined
          ? undefined
          : Object.values(b.state.items).find((item) => item.key === signal.item);
      if (asker !== undefined) {
        b.emit({
          _tag: "ItemClosed",
          runId: asker.runId,
          itemId: asker.id,
          body: { kind: "request", requestId: id },
        });
      }
      if (byMessage) return;
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
      const end = turnEnd(live, signal.outcome, refusedBy(b, live));
      endRun(b, live, end, signal.source, undefined, endFacts(signal));
      if (end.kind === "usage-limit") limited(b, live, end.resetsAt);
      admitNext(b);
      expectAgentTurn(b);
      return;
    }
    case "work-upserted": {
      // Work a person's Stop ended (its session's close cut it, or the driver stopped it as the
      // session went) was stopped by the person, not lost.
      const byPerson =
        (signal.status === "lost" || signal.status === "stopped") && personStopped(b.state);
      // The call that started it, by its key: still open, or closed in a run the state keeps.
      const call =
        signal.call === undefined
          ? undefined
          : (b.state.closedItems[signal.call]?.itemId ??
            Object.values(b.state.items).find((item) => item.key === signal.call)?.id);
      const body: ItemBody = {
        kind: "work",
        work: signal.work,
        workKind: signal.workKind,
        status: byPerson ? "stopped" : signal.status,
        title: signal.title ?? null,
        ...(call === undefined ? {} : { call }),
        ...(signal.report === undefined ? {} : { report: signal.report }),
      };
      const ends = WORK_ENDED.has(signal.status);
      const closed = b.state.closedItems[signal.work];
      // A word on work that already ended keeps the time it ended.
      if (closed !== undefined)
        return updateClosed(
          b,
          closed,
          body.kind === "work" && closed.endedAt !== undefined
            ? { ...body, endedAt: closed.endedAt }
            : body,
        );
      const open = Object.values(b.state.items).find((item) => item.key === signal.work);
      if (open !== undefined) {
        if (ends) {
          b.emit({
            _tag: "ItemClosed",
            runId: open.runId,
            itemId: open.id,
            body: { ...body, endedAt: b.now },
          });
          expectAgentTurn(b);
          // The bridge's word that the work's session is closing: asked, for the reason asked;
          // else it died.
          if (byPerson || body.status === "lost") {
            b.lost.push({
              title: body.title,
              runId: open.runId,
              how: byPerson ? BY_THE_PERSON : LOST_HOW[b.state.closing?.reason ?? "exited"],
            });
          }
          // A run held for a setting the live work stood against goes now.
          return redispatch(b);
        } else if (contentDigest(open.body) !== contentDigest(body)) {
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
      const by: OpenItem["by"] =
        signal.helper === undefined
          ? { kind: "mate" }
          : { kind: "helper", helperId: signal.helper };
      b.emit({
        _tag: "ItemOpened",
        runId: owner.id,
        itemId: id,
        key: signal.work,
        // A helper's own work is the helper's, as its calls are.
        by,
        body,
      });
      if (ends) {
        b.emit({
          _tag: "ItemClosed",
          runId: owner.id,
          itemId: id,
          body: { ...body, endedAt: b.now },
        });
        expectAgentTurn(b);
      }
      return;
    }
    case "agent-caught-up": {
      // One turn may take several results (Claude folds what finished into the turn that runs,
      // and hands a batch over at once): its word that nothing waits ends every one still due.
      const due = b.state.wakes[turnDueWakeId(b)];
      if (b.state.reportsDue === 0 && due === undefined) return;
      b.emit({ _tag: "ReportsTaken", reason: "the agent took every finished result" });
      if (due !== undefined)
        b.emit({ _tag: "WakeCancelled", wakeId: due.id, reason: "the agent took every result" });
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
        dueAt: signal.resetsAt,
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
        endRun(b, run, limitEnd(signal.resetsAt, refusedBy(b, run), signal.window), "agent");
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
      sessionClosed(b, sessionId, "exited");
      // A run held for a setting the lost work stood against goes on a new session now.
      const admitted = activeRun(b.state);
      if (admitted?.state === "admitted") return dispatch(b, admitted);
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

/** What a turn's end carries onto its run's: its cost, the context it left, why it broke off. */
const endFacts = (signal: Extract<ProviderSignal, { readonly kind: "turn-ended" }>): EndFacts => {
  const reason =
    signal.outcome.kind === "completed" || signal.outcome.kind === "failed"
      ? signal.outcome.reason
      : undefined;
  const detail = reason === undefined ? undefined : END_DETAILS[reason];
  return {
    ...(signal.costUsd === undefined ? {} : { costUsd: signal.costUsd }),
    ...(signal.contextTokens === undefined ? {} : { contextTokens: signal.contextTokens }),
    ...(detail === undefined ? {} : { detail }),
  };
};

/** The driver of the session `run` ran on, while it is the open one: whose limit refused it. */
const refusedBy = (b: StepBuilder, run: RunRecord): string | undefined => {
  const session = b.state.session;
  return session !== null && session.id === run.sessionId ? session.driver : undefined;
};

/**
 * A usage limit's end names whose limit it was, so a later switch of agent never renames it, and
 * the window that refused, when the driver named one.
 */
const limitEnd = (
  resetsAt: number | null,
  driver: string | undefined,
  window: string | undefined,
): RunEnd => ({
  kind: "usage-limit",
  resetsAt,
  ...(driver === undefined ? {} : { driver }),
  ...(window === undefined ? {} : { window }),
});

/** What a turn's outcome makes of its run, said in one place; the source is always the bridge's. */
const turnEnd = (run: RunRecord, outcome: TurnOutcome, driver: string | undefined): RunEnd => {
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
      return limitEnd(resetTime(outcome.resetsAt), driver, outcome.window);
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
 * A usage limit ended `run` and holds the queue. A known reset arms a resume that joins it at the
 * provider's reported reset; an
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
    dueAt: resetsAt,
    cron: null,
    principal: run.principal,
    joins: run.id,
    text: CONTINUE_TEXT,
  });
};

/**
 * How far a window's reset may sit from a limit's reset and still be that limit's window: a
 * limit's words round its reset (Claude says "resets 1pm"), the window keeps its own instant.
 */
export const LIMIT_WINDOW_MATCH_MS = 60 * 60_000;

/**
 * Whether the provider's report shows the limit that pauses the conversation is gone: read after
 * the limit, every window with room, none that resets when the limit does. A limit belongs to the
 * account that hit it: an agent signed in to another account reports that account's windows.
 */
const limitGone = (state: ConversationState, usage: ProviderUsageReport): boolean => {
  const pausedUntil = state.pausedUntil;
  if (pausedUntil === null) return false;
  const wake = Object.values(state.wakes).find((candidate) => isUsageWake(candidate.kind));
  const limitedAt = wake?.joins == null ? undefined : state.runs[wake.joins]?.endedAt;
  if (limitedAt == null || usage.checkedAt <= limitedAt) return false;
  return usage.windows.every(
    (window) =>
      window.usedPercent < 100 &&
      (pausedUntil === "unknown" ||
        window.resetsAt === null ||
        Math.abs(window.resetsAt - pausedUntil) > LIMIT_WINDOW_MATCH_MS),
  );
};

/**
 * The pause a usage limit holds lifts and the work tries the provider now: the held message first,
 * else the limited run's resume. A provider that still refuses ends that run as a usage limit
 * again, and the pause is back until the reset it names.
 */
const tryPastLimit = (b: StepBuilder, reason: string): void => {
  if (b.state.pausedUntil === null) return;
  const wake = Object.values(b.state.wakes).find((candidate) => isUsageWake(candidate.kind));
  b.emit({ _tag: "UsagePauseLifted", reason });
  if (wake === undefined) return admitNext(b);
  wakeFired(b, wake.id, undefined);
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

/** The run a steer still in flight was asked into, when `turn` is that steer's message. */
const steerOpened = (b: StepBuilder, turn: TurnHandle): RunId | undefined => {
  const prefix = `${turn}/e/provider.steer/`;
  const effect = Object.values(b.state.effects).find(
    (entry) => entry.kind === "provider.steer" && entry.id.startsWith(prefix),
  );
  return effect?.runId ?? undefined;
};

/**
 * The run admitted (first in line, nothing of it sent) when it is a person's message that can go
 * into a running turn as a steer: words and files in the mode the turn runs in, on a session that
 * takes a steer and fits it. The line keeps its order: a message behind it waits for it.
 */
const waitingMessage = (b: StepBuilder): RunRecord | undefined => {
  const session = b.state.session;
  if (session === null || !session.capabilities.steer || b.state.closing !== null) return;
  if (misfit(b.state, session) !== null) return;
  const first = activeRun(b.state);
  if (first?.state !== "admitted") return;
  if (first.trigger.kind !== "person" || first.principal.kind !== "person") return;
  if (first.maintenance || first.interactionMode !== "default") return;
  return first.personBody?.delivery.state === "queued" ? first : undefined;
};

/**
 * The agent opened a turn of its own while a person's message waited: the message goes into that
 * turn as a steer, the agent reads it at its next step, and the turn is the message's run — the
 * agent answers it there.
 */
const joinOwnTurn = (
  b: StepBuilder,
  run: RunRecord,
  turn: TurnHandle,
  providerTurnId: string | null,
): void => {
  const session = b.state.session!;
  const item = (run.trigger as Extract<RunTrigger, { kind: "person" }>).itemId;
  const attachments = run.personBody?.attachments ?? [];
  b.effect("provider.steer", item, 1, run.id, {
    runId: run.id,
    sessionId: session.id,
    itemId: item,
    text: withLostWorkNote(b, run),
    ...(attachments.length === 0 ? {} : { attachments: [...attachments] }),
    instanceId: b.state.agent?.instanceId ?? null,
    principal: run.principal,
  });
  markStarted(b, b.run(run.id), providerTurnId, turn, "steered");
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

/**
 * A run its crew started is its crew's to carry on (CREW-DESIGN §2.2): the engine arms no
 * continuation and no usage resume for it. So is every run in a crewmate's chat, whoever it ran
 * for: a person's message reaches it through its crew, which holds it while the crew is paused or
 * its copy frozen.
 */
const crewCarriesOn = (state: ConversationState, run: { readonly principal: Principal }): boolean =>
  run.principal.kind === "crew" || state.agent?.profile.kind === "crewmate";

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
  restart: MateRestart | undefined,
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
  for (const id of cutEffects) {
    // An answer steered into a turn the restart cut may not have arrived, and nothing sends it
    // again: the person answers again.
    const carried =
      b.state.effects[id]?.kind === "provider.steer" ? b.state.answering[id] : undefined;
    record(id, "the server restarted");
    if (carried !== undefined)
      reopenCarried(b, carried, "The server restarted before the agent took the answer.");
  }
  const neverSent = new Set<string>();
  for (const id of unstartedEffects) {
    const effect = record(id, "the server restarted before it was tried");
    if (effect?.kind === "provider.send" && effect.runId !== null) neverSent.add(effect.runId);
  }
  const run = activeRun(b.state);
  const crewRun = run !== undefined && crewCarriesOn(b.state, run);
  if (run !== undefined && run.state === "sending" && neverSent.has(run.id) && !crewRun) {
    // Its send never started: nothing reached the agent, so it goes again, as it was.
    b.emit({
      _tag: "RunRequeued",
      runId: run.id,
      reason: "the server restarted before it was sent",
    });
  } else if (run !== undefined && isLive(run)) {
    // A crew run ends cut with no continuation: its crew sends it again, or holds.
    const refusal = crewRun ? null : continuationRefusal(b.state, run);
    endRun(
      b,
      run,
      {
        kind: "cut-by-restart",
        continuedBy: null,
        ...(refusal === null ? {} : { notContinued: refusal }),
        ...(words === undefined ? {} : { words }),
        ...(restart === undefined ? {} : { restart }),
      },
      "inferred-from-restart",
      neverSent.has(run.id) ? "refused" : "unknown",
    );
    if (refusal === null && !crewRun) {
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
    sessionClosed(b, b.state.session.id, "restart");
  }
  const admitted = activeRun(b.state);
  if (admitted?.state === "admitted") {
    // Its capture, requeued with the replay-safe work, still settles first.
    dispatch(b, admitted);
    return;
  }
  admitNext(b);
};

// ── the earlier record ──────────────────────────────────────────────────────────────────────

/** The cause every import effect derives its id from: one import per conversation. */
const historyCause = (b: StepBuilder) => `${b.state.conversationId}/history`;

/** The effect that reads the plan's records from `cursor` on: one per batch, by where it starts. */
const askHistory = (b: StepBuilder, cursor: number): void => {
  const history = b.state.history;
  if (history === null) return;
  b.effect("history.import", historyCause(b), cursor + 1, null, {
    source: history.source,
    runs: history.runs,
    cursor,
  });
};

/**
 * The earlier record is copied in once, before the conversation runs anything of its own: its
 * turns take the first ordinals, so they read before every run of the engine's. A conversation
 * that already ran, or already imported, takes nothing.
 */
const importHistory = (
  b: StepBuilder,
  command: Extract<Command, { readonly _tag: "ImportHistory" }>,
): void => {
  if (b.state.history !== null || b.state.archived) return;
  if (b.state.nextRunOrdinal !== 1) return;
  if (command.unread !== undefined) {
    // Nothing could be read: the gap is said where the earlier record would have been.
    b.emit({ _tag: "HistoryImportStarted", source: command.source, runs: 0 });
    return endHistoryFailed(b, command.unread);
  }
  if (command.runs < 1) return;
  b.emit({ _tag: "HistoryImportStarted", source: command.source, runs: command.runs });
  askHistory(b, 0);
};

/** Whether a batch's record sits where the import reserved it: ids derive from their cause. */
const placed = (b: StepBuilder, runs: number, record: ImportedRecord): boolean => {
  const conversation = b.state.conversationId;
  const ofRun = (run: RunId | null) => {
    if (run === null) return false;
    const ordinal = Number(run.slice(`${conversation}/r/`.length));
    return (
      Number.isInteger(ordinal) &&
      ordinal >= 1 &&
      ordinal <= runs &&
      run === deriveRunId(conversation, ordinal)
    );
  };
  switch (record._tag) {
    case "RunImported":
      return record.runId === deriveRunId(conversation, record.ordinal) && ofRun(record.runId);
    case "ItemImported":
      return record.runId === null
        ? record.itemId.startsWith(`${historyCause(b)}/`)
        : ofRun(record.runId) && record.itemId.startsWith(`${record.runId}/i/`);
    case "RequestImported":
      return ofRun(record.runId) && record.requestId.startsWith(`${record.runId}/q/`);
  }
};

/** One batch of the earlier record: its records, then how far the import has come. */
const historyBatch = (
  b: StepBuilder,
  command: Extract<Command, { readonly _tag: "HistoryBatch" }>,
): void => {
  const history = b.state.history;
  if (history?.state !== "importing") {
    throw new Rejected("invalid-signal", "No import of the earlier record is under way.");
  }
  if (command.from !== history.cursor || command.to <= command.from) {
    throw new Rejected(
      "invalid-signal",
      `The batch reads ${command.from}..${command.to}; the import is at ${history.cursor}.`,
    );
  }
  for (const record of command.records) {
    if (!placed(b, history.runs, record)) {
      throw new Rejected("invalid-signal", `An imported record is out of place: ${record._tag}.`);
    }
    b.emit(record);
  }
  b.details.push(...command.details);
  b.data.push(...command.data);
  b.emit({ _tag: "HistoryBatchImported", cursor: command.to });
};

/** What an import's read came to: the next batch, the end, or what could not be brought over. */
const historySettled = (b: StepBuilder, id: EffectId, outcome: EffectOutcome): void => {
  const history = b.state.history;
  if (history?.state !== "importing") return admitNext(b);
  const started = Number(id.slice(id.lastIndexOf("/") + 1)) - 1;
  const value = outcome.kind === "ok" ? (outcome.value as { done?: unknown } | undefined) : null;
  if (value != null && value.done === true) {
    b.emit({ _tag: "HistoryImportEnded", outcome: "complete" });
    return admitNext(b);
  }
  if (outcome.kind === "ok" && history.cursor > started) return askHistory(b, history.cursor);
  const reason =
    outcome.kind === "ok"
      ? "the import read nothing more"
      : outcome.kind === "failed" || outcome.kind === "cut"
        ? outcome.reason
        : outcome.kind === "timed-out"
          ? "the earlier record took too long to read"
          : `an outcome this build does not know (${outcome.type})`;
  endHistoryFailed(b, reason);
};

/** An import that could not bring everything: a marker says so, and the queue moves. */
const endHistoryFailed = (b: StepBuilder, reason: string): void => {
  b.emit({
    _tag: "ItemImported",
    runId: null,
    itemId: ItemId.make(`${historyCause(b)}/failed`),
    by: ENGINE_ACTOR,
    body: {
      kind: "marker",
      marker: {
        kind: "error",
        reason: `The earlier conversation could not all be brought over: ${reason}`,
      },
    },
    happenedAt: b.now,
  });
  b.emit({ _tag: "HistoryImportEnded", outcome: "failed", reason });
  admitNext(b);
};

/**
 * `decide(state, envelope, now)`: every rule and guard of a conversation, pure.
 *
 * A run moves queued → admitted → sending → running ⇄ waiting → ended, one active at a time.
 * Admission asks the run's principal first (`run.prepare`), for the agent instance the run goes on
 * (an admission for another instance is asked again), then opens a session as an effect
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
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  itemId as deriveItemId,
  requestId as deriveRequestId,
  runId as deriveRunId,
  wakeId as deriveWakeId,
  type EffectId,
  type EffectOutcome,
  type ItemBody,
  type Principal,
  type ProviderOptionSelection,
  type RunEnd,
  type RunEndDetail,
  type RunId,
  type RunTrigger,
  type RuntimeMode,
  type SessionCapabilities,
  type SessionId,
  type TurnHandle,
  isCardAsk,
  ItemId,
  LeaseAlias,
  LeaseReleaseResult,
  TrimmedNonEmptyString,
  WORK_ENDED,
} from "@t3tools/contracts";

import type {
  Command,
  Decision,
  Envelope,
  ImportedRecord,
  ProviderSignal,
  TurnOutcome,
} from "./command.ts";
import {
  activeRun,
  contentDigest,
  runOfTurn,
  type ClosedItem,
  type ConversationState,
  type OpenItem,
  type OpenRequest,
  type RunRecord,
} from "./state.ts";
import { steeredWith } from "./told.ts";
import { ENGINE_ACTOR, Rejected, StepBuilder, isLive, crewCarriesOn } from "./decide.step.ts";
import {
  BY_THE_PERSON,
  LOST_HOW,
  personStopped,
  noteLostWork,
  withLostWorkNote,
} from "./decide.lostWork.ts";
import {
  armIdle,
  turnDueWakeId,
  expectAgentTurn,
  closeSession,
  misfit,
  sessionClosed,
} from "./decide.sessions.ts";
import { reopenCarried, waitsOnQuestion } from "./decide.carried.ts";
import {
  WATCHDOG_SILENCE_MS,
  CONTINUE_TEXT,
  continueText,
  resentText,
  type EndFacts,
  queueRun,
  admitNext,
  dispatch,
  recordLoose,
  redispatch,
  updatePerson,
  endRun,
  settledBody,
  markWaiting,
  markResponsive,
  markStarted,
} from "./decide.runs.ts";
import { rotateSession, switchModel, setRuntimeMode, chooseAgent } from "./decide.settings.ts";
import { steer } from "./decide.steer.ts";
import { armWake, wakeFired, agentSchedule } from "./decide.wakes.ts";
import { resetTime, limited, limitGone, tryPastLimit } from "./decide.usage.ts";
import { send, stop } from "./decide.send.ts";
import {
  sameOriginAddress,
  settleOrigins,
  settleMirrors,
  vaultAskOpen,
  secretAskOpen,
  vaultPlace,
} from "./decide.asks.ts";
import { answer, dismiss, resumeIfAnswered } from "./decide.questions.ts";

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
      if (b.state.archived) return;
      b.emit({ _tag: "ConversationArchived", by: b.envelope.principal });
      return askLeaseRelease(b);
    case "Unarchive":
      if (b.state.archived) b.emit({ _tag: "ConversationUnarchived", by: b.envelope.principal });
      return;
    case "ForgetMateAnswer":
      if (
        b.state.awaits.some((awaited) => awaited.id === command.messageId) ||
        !b.state.answered.includes(command.messageId)
      )
        b.emit({ _tag: "MateAnswerHeard", messageId: command.messageId });
      return;
    case "BindLease":
      // Its first lease is where it works: another the agent acquires is only a container it uses.
      if (b.state.lease === null) b.emit({ _tag: "LeaseBound", lease: command.lease });
      return;
    case "UnbindLease": {
      const bound = b.state.lease;
      if (bound !== null && bound.alias === command.ended) {
        b.emit({ _tag: "LeaseUnbound", alias: bound.alias });
      }
      return;
    }
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
        command.lastWords,
      );
    case "ImportHistory":
      return importHistory(b, command);
    case "HistoryBatch":
      return historyBatch(b, command);
  }
};

// ── effects ─────────────────────────────────────────────────────────────────────────────────

// ── the workspace on archive ────────────────────────────────────────────────────────────────

/**
 * Archiving is the person's word that the conversation's work is done: the branch of the lease it
 * is bound to goes back to its pool. zcp releases it only with nothing unsaved there (it never
 * forces), so a refusal keeps the binding and nothing is lost. A lease of no branch is kept: zcp
 * releases a branch, never one container.
 */
const askLeaseRelease = (b: StepBuilder): void => {
  const lease = b.state.lease;
  if (lease === null || lease.branch === null) return;
  // One release at a time: archived again before it started, the one asked still runs.
  if (Object.values(b.state.effects).some((effect) => effect.kind === "lease.release")) return;
  b.effect(
    "lease.release",
    `${b.state.conversationId}/lease/${lease.alias}`,
    b.state.headSeq,
    null,
    {
      alias: lease.alias,
      branch: lease.branch,
      ...(lease.repo === undefined ? {} : { repo: lease.repo }),
    } satisfies LeaseReleasePayload,
  );
};

/** What a `lease.release` effect asks: the bound lease, and the branch (and repository) zcp releases. */
export interface LeaseReleasePayload {
  readonly alias: string;
  readonly branch: string;
  readonly repo?: string;
}

const decodeLeaseReleaseValue = Schema.decodeUnknownOption(
  Schema.Struct({ alias: LeaseAlias, branch: TrimmedNonEmptyString, result: LeaseReleaseResult }),
);

/**
 * The release's receipt; a release that went unbinds the conversation from the lease it named. An
 * outcome the handler never gave (the worker gave up on it) is a release not made, of the lease the
 * conversation is bound to; with none bound, the outcome alone records it.
 */
const leaseReleaseSettled = (b: StepBuilder, outcome: EffectOutcome): void => {
  const value = outcome.kind === "ok" ? decodeLeaseReleaseValue(outcome.value) : Option.none();
  if (Option.isSome(value)) {
    const { alias, branch, result } = value.value;
    b.emit({ _tag: "LeaseReleaseSettled", alias, branch, result });
    // A release made only in part unbinds the conversation only when its own lease went.
    const went =
      result.outcome === "released" ||
      (result.outcome === "failed" &&
        result.released?.some((lease) => lease.lease === alias) === true);
    if (went && b.state.lease?.alias === alias) {
      b.emit({ _tag: "LeaseUnbound", alias });
    }
    return;
  }
  const lease = b.state.lease;
  if (lease === null || lease.branch === null) return;
  const reason =
    outcome.kind === "failed" || outcome.kind === "cut"
      ? outcome.reason
      : outcome.kind === "timed-out"
        ? `zcp did not answer the release within ${Math.round(outcome.after / 1000)} s`
        : "the release's answer could not be read";
  b.emit({
    _tag: "LeaseReleaseSettled",
    alias: lease.alias,
    branch: lease.branch,
    result: { outcome: "failed", reason },
  });
};

const effectSettled = (b: StepBuilder, id: EffectId, outcome: EffectOutcome): void => {
  const effect = b.state.effects[id];
  if (effect === undefined) throw new Rejected("unknown-effect");
  const answered = b.state.answering[id];
  const closing = b.state.closing?.effectId === id ? b.state.closing : null;
  b.emit({ _tag: "EffectOutcomeRecorded", effectId: id, kind: effect.kind, outcome });
  if (effect.kind === "history.import") return historySettled(b, id, outcome);
  if (effect.kind === "lease.release") return leaseReleaseSettled(b, outcome);
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
  if (
    effect.kind === "provider.respond" &&
    answered?.byHelper === true &&
    (run === undefined || !isLive(run))
  ) {
    return helperAnswerSettled(b, answered, outcome, failure);
  }
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
        // A refusal for an instance the agent no longer is ends nothing: the current one is asked.
        if (run.preparedFor !== (b.state.agent?.instanceId ?? null)) {
          return dispatch(b, b.run(run.id));
        }
        // Only admission refuses a run, and before anything of it ran: its words are the refusal.
        endRun(
          b,
          run,
          {
            kind: "failed",
            reason: outcome.reason,
            next: null,
            ...(outcome.admission === undefined ? {} : { admission: outcome.admission }),
            ...(outcome.forNow === true ? { forNow: true } : {}),
          },
          "inferred-from-effect",
          undefined,
          { detail: "refused", refusal: outcome.reason },
        );
        admitNext(b);
        return;
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
 * The answer to a helper's ask after its run ended: one the driver can no longer take expired,
 * one that never reached it is the person's to give again; one that timed out waits on its close.
 */
const helperAnswerSettled = (
  b: StepBuilder,
  answered: OpenRequest,
  outcome: EffectOutcome,
  failure: string | null,
): void => {
  if (failure === null || outcome.kind === "timed-out") return;
  if (outcome.kind === "failed" && outcome.refused === true) {
    b.emit({
      _tag: "RequestClosed",
      runId: answered.runId,
      requestId: answered.id,
      state: "expired",
    });
    return;
  }
  b.emit({
    _tag: "RequestReopened",
    runId: answered.runId,
    requestId: answered.id,
    key: answered.key,
    principal: answered.principal,
    reason: failure,
    answers: answered.answers,
  });
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
          updateClosed(b, closed, signal.body, {
            detail: signal.detail,
            data: signal.kind === "item-closed" ? signal.data : undefined,
          });
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
      if (signal.detail !== undefined) {
        b.details.push({ itemId: id, body: signal.detail });
      }
      if (signal.kind === "item-closed" && signal.data !== undefined) {
        b.data.push({ itemId: id, data: signal.data });
        if (
          signal.body.kind === "call" &&
          signal.body.state === "done" &&
          signal.by?.kind !== "helper"
        )
          agentSchedule(b, run, signal.data);
      }
      return;
    }
    case "request-opened": {
      // A request is asked once: one delivered again, open or answered, is the same request.
      if (b.state.askedKeys[signal.key] !== undefined) return;
      // A value asked again for the same vault while its card is open is the one question: the
      // person may already be typing it there (a Mate asked twice for one secret, 2026-10-28).
      if (signal.ask.kind === "vault" && vaultAskOpen(b.state, signal.ask)) return;
      if (signal.ask.kind === "secret" && secretAskOpen(b.state, signal.ask)) return;
      const owner = routed(b, signal.turn);
      if (owner === undefined) return;
      const run = isLive(owner) ? awaken(b, owner) : owner;
      const id = deriveRequestId(run.id, run.nextRequestOrdinal);
      // An origin asked again for the same repository is the one question: the earlier ask
      // needs the person no more.
      if (signal.ask.kind === "origin") {
        const { url, repo } = signal.ask;
        settleOrigins(b, (asked) => asked.repo === repo && sameOriginAddress(asked.url, url));
      }
      // A repository asked again to be connected to GitHub is the one question: the new ask
      // replaces the earlier one.
      if (signal.ask.kind === "mirror") settleMirrors(b, signal.ask.repo);
      const live = isLive(run);
      // Asked by message: the agent does not wait on it, and a message answers it after its turn.
      // An ask on a card is not waited on either: the person answers it there after the turn.
      const byMessage =
        (signal.ask.kind === "question" && signal.ask.dismissible) || isCardAsk(signal.ask.kind);
      // A helper's ask outlives the turn that started its helper: the driver waits on it while
      // the session that asked lives (Milo's final engine run, seg E: helpers hung unasked).
      const byHelper = signal.byHelper === true && !byMessage && b.state.session?.id === sessionId;
      b.emit({
        _tag: "RequestOpened",
        runId: run.id,
        requestId: id,
        key: signal.key,
        ask: signal.ask,
        answerable: (live || byMessage || byHelper) && (signal.answerable ?? true),
        principal: run.principal,
        ...(byHelper ? { byHelper: true as const } : {}),
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
      if (byMessage || (byHelper && !live)) return;
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
    case "vault-stored": {
      // The agent stored a value it asked the person for (given in the chat, say): the ask is
      // answered saved and the person has nothing left to give. The agent knows already: no word
      // reaches it.
      for (const request of Object.values(b.state.requests)) {
        const vault = request.vault;
        if (vault === undefined || !signal.keys.includes(vault.key)) continue;
        const { scope } = vault;
        const sameVault =
          scope.kind === "shared"
            ? signal.scope.kind === "shared"
            : signal.scope.kind === "service" && signal.scope.hostname === scope.hostname;
        if (!sameVault) continue;
        b.emit({
          _tag: "RequestAnswered",
          runId: request.runId,
          requestId: request.id,
          by: b.envelope.principal,
          summary: `Saved to ${vaultPlace(vault)}`,
        });
      }
      return;
    }
    case "origin-settled": {
      // zcp found the asked address already an origin in HQ for the repository that call asked
      // about, or the agent withdrew the ask of one repository, or of every repository asked
      // about the address. The agent knows already: no word reaches it.
      const { url, repo } = signal;
      settleOrigins(
        b,
        (asked) => sameOriginAddress(asked.url, url) && (repo === undefined || asked.repo === repo),
      );
      return;
    }
    case "mirror-settled": {
      // zcp found the repository already on GitHub in HQ, or the agent withdrew its ask. The
      // agent knows already: no word reaches it.
      settleMirrors(b, signal.repo);
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

/**
 * A closed item's key again: the same content changes nothing, new content updates it in place,
 * and what comes beside its body is kept as an open item's would be — its words whole, a closing
 * call's own record (a helper's call that came back after its run ended).
 */
const updateClosed = (
  b: StepBuilder,
  closed: ClosedItem,
  body: ItemBody,
  beside: { readonly detail?: string | undefined; readonly data?: unknown } = {},
): void => {
  const run = closed.runId === null ? undefined : b.state.runs[closed.runId];
  const settled = run?.end == null ? body : settledBody(body, run.end);
  if (beside.detail !== undefined) b.details.push({ itemId: closed.itemId, body: beside.detail });
  if (beside.data !== undefined) b.data.push({ itemId: closed.itemId, data: beside.data });
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
    ...(signal.context === undefined ? {} : { context: signal.context }),
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

/** A turn the agent started on its own: a run that joins the run whose work it reports. */
/**
 * The run a self turn joins (the bridge's word, else the latest that ran; none when that run was
 * stopped) and its principal.
 */
const selfJoins = (
  b: StepBuilder,
  reportsOn: RunId | null,
): { readonly joins: RunId | null; readonly principal: Principal } | undefined => {
  const joins = reportsOn ?? b.state.endedRuns.at(-1) ?? b.state.latestRunId;
  const joined = joins === null ? undefined : b.state.runs[joins];
  if (joined === undefined || joined.principal.kind === "engine") return undefined;
  // A run the person stopped stays stopped: a turn after it answers on a card of its own.
  const stopped = joined.end?.kind === "stopped";
  return { joins: stopped ? null : joined.id, principal: joined.principal };
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
    text: steeredWith(withLostWorkNote(b, run)),
    ...(attachments.length === 0 ? {} : { attachments: [...attachments] }),
    // Admitted for the instance of the session the words go into.
    instanceId: session.instanceId ?? b.state.agent?.instanceId ?? null,
    principal: run.principal,
  });
  markStarted(b, b.run(run.id), providerTurnId, turn, "steered");
};

const selfStarted = (
  b: StepBuilder,
  turn: TurnHandle,
  providerTurnId: string | null,
  joined: { readonly joins: RunId | null; readonly principal: Principal },
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
  // The person's answer goes on with it, as their message: a continuation would go on without it.
  if (waitsOnQuestion(state, run)) return "its question waits for your answer";
  return null;
};

const recovered = (
  b: StepBuilder,
  cutEffects: ReadonlyArray<EffectId>,
  unstartedEffects: ReadonlyArray<EffectId>,
  words: string | undefined,
  restart: MateRestart | undefined,
  lastWords: { readonly runId: RunId; readonly tail: string } | undefined,
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
        text:
          run.state === "sending"
            ? resentText(run.text)
            : continueText(
                run.lastSaid?.kind === "answer" && lastWords?.runId === run.id
                  ? { lastSaid: { kind: "answer", tail: lastWords.tail } }
                  : run,
              ),
      });
    }
  }
  if (b.state.session !== null) {
    sessionClosed(b, b.state.session.id, "restart");
  }
  const admitted = activeRun(b.state);
  if (admitted?.state === "admitted") {
    // Its admission, requeued with the replay-safe work, still settles first.
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

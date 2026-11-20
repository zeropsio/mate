/**
 * An effect's outcome: what each settled effect does to the run and the session.
 *
 * @module engine/domain/decide.effects
 */
import type {
  EffectId,
  EffectOutcome,
  ProviderOptionSelection,
  RuntimeMode,
  SessionCapabilities,
  SessionId,
  TurnHandle,
} from "@t3tools/contracts";

import { activeRun, type ConversationState, type OpenRequest, type RunRecord } from "./state.ts";
import { Rejected, type StepBuilder, isLive } from "./decide.step.ts";
import { armIdle, sessionClosed } from "./decide.sessions.ts";
import { reopenCarried } from "./decide.carried.ts";
import {
  admitNext,
  dispatch,
  updatePerson,
  endRun,
  markWaiting,
  markStarted,
} from "./decide.runs.ts";
import { leaseReleaseSettled } from "./decide.lease.ts";

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

export const effectSettled = (b: StepBuilder, id: EffectId, outcome: EffectOutcome): void => {
  const effect = b.state.effects[id];
  if (effect === undefined) throw new Rejected("unknown-effect");
  const answered = b.state.answering[id];
  const closing = b.state.closing?.effectId === id ? b.state.closing : null;
  b.emit({ _tag: "EffectOutcomeRecorded", effectId: id, kind: effect.kind, outcome });
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
    // A send its session's exit outran: the end left the message unknown while the send was in
    // flight; its outcome proving it never reached the agent settles it refused.
    if (
      run !== undefined &&
      effect.kind === "provider.send" &&
      outcome.kind === "failed" &&
      (outcome.undelivered === undefined || outcome.undelivered === true) &&
      run.trigger.kind === "person" &&
      run.personBody?.delivery.state === "unknown"
    ) {
      updatePerson(b, run, "refused");
    }
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
export const sendsAgain = (b: StepBuilder, run: RunRecord, reason: string): boolean => {
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

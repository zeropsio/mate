/**
 * A run's path through the step: queued, admitted, dispatched, started, waiting, ended; its watchdog and the words a continuation says.
 *
 * @module engine/domain/decide.runs
 */
import {
  runId as deriveRunId,
  wakeId as deriveWakeId,
  type ItemBody,
  type Principal,
  type ProviderInteractionMode,
  type RotateSessionReason,
  type RequestId,
  type RunEnd,
  type RunEndSource,
  type RunId,
  type RunTrigger,
  type TurnHandle,
  isCardAsk,
  ItemId,
} from "@t3tools/contracts";

import type { EventDraft } from "./command.ts";
import { activeRun, type ConversationState, type RunRecord } from "./state.ts";
import {
  ENGINE,
  ENGINE_ACTOR,
  Rejected,
  type StepBuilder,
  paused,
  needsPrepare,
} from "./decide.step.ts";
import {
  withLostWorkNote,
  spendLostWorkNote,
  releaseLostWork,
  workLives,
} from "./decide.lostWork.ts";
import { armIdle, endTurnDue, cancelIdle, closeSession, misfit } from "./decide.sessions.ts";
import { answerCarried, reopenCarried, askAgainByMessage } from "./decide.carried.ts";

/** Silence after which the watchdog marks a run unresponsive. */
export const WATCHDOG_SILENCE_MS = 10 * 60_000;

/** What a continuation or a usage resume tells the agent. */
export const CONTINUE_TEXT = "Continue where you left off.";

/**
 * What a continuation after a restart tells the agent: where the person's view of its words stops.
 * Its own session may hold more than reached the person (Milo's story ran on to its end there,
 * the person had it to "…calling out orders for coal"), so it carries on from what they have.
 */
export const continueText = (run: Pick<RunRecord, "lastSaid">): string => {
  switch (run.lastSaid?.kind) {
    case "answer":
      return [
        "The server restarted while you were writing your answer. The person has it only up to these last words:",
        `"${run.lastSaid.tail}"`,
        "Carry on from exactly there; don't repeat what they already have.",
      ].join("\n\n");
    case "thinking":
      return "The server restarted while you were thinking, before you wrote anything more: nothing after that thinking reached the person. Continue where you left off and give your answer in full.";
    default:
      return CONTINUE_TEXT;
  }
};

/** A message a restart cut mid-send goes again in its own words, marked so the agent knows. */
export const resentText = (text: string): string =>
  `(Sent again after a server restart; it may have reached you already.)\n\n${text}`;

/** What a run's end carries beyond its kind: its cost, its context, why it broke off. */
export type EndFacts = Pick<
  Extract<EventDraft, { readonly _tag: "RunEnded" }>,
  "costUsd" | "context" | "detail" | "refusal" | "credentialFingerprint"
>;

export const queueRun = (
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

/**
 * Admits the oldest queued run when nothing is active and no usage limit holds the queue; with
 * nothing to admit, an open session starts its idle time.
 */
export const admitNext = (b: StepBuilder): void => {
  if (b.state.activeRunId !== null) return;
  const next = paused(b) ? undefined : b.state.queue[0];
  if (next === undefined) {
    releaseLostWork(b);
    return armIdle(b);
  }
  cancelIdle(b);
  b.emit({ _tag: "RunAdmitted", runId: next });
  dispatch(b, b.run(next));
};

/**
 * Every run is admitted for its principal (D6) on the agent's current instance before the agent
 * starts work: the send waits. Each ask is a new effect (`n`): an id already asked is dropped.
 */
const askAdmission = (b: StepBuilder, run: RunRecord): void => {
  b.effect("run.prepare", run.id, run.prepareAsks + 1, run.id, {
    runId: run.id,
    instanceId: b.state.agent?.instanceId ?? null,
    principal: run.principal,
    trigger: run.trigger,
  });
};

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
 * V1's words). A run whose admission has not settled, or a session closing, waits. A run is sent
 * only on the instance its settled admission was asked for; for any other it is asked again.
 */
export const dispatch = (b: StepBuilder, run: RunRecord, justOpened = false): void => {
  if (needsPrepare(run)) {
    if (run.prepare === "asked") return;
    if (run.prepare === "none" || run.preparedFor !== (b.state.agent?.instanceId ?? null)) {
      return askAdmission(b, run);
    }
  }
  if (b.state.closing !== null) return;
  const opening = Object.values(b.state.effects).some(
    (effect) => effect.kind === "session.open" && effect.runId === run.id,
  );
  if (opening) return;
  // Every task of an automated Mate's one conversation is worked there: a task's run never goes on
  // with another task's work in mind (a review of an earlier change, say), so it starts afresh.
  const task = run.principal.kind === "task" ? run.principal.taskId : null;
  const held = b.state.sessionTask ?? null;
  if (task !== null && held !== null && held !== task) rotate(b, "task", true, null);
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

export const rotate = (
  b: StepBuilder,
  reason: RotateSessionReason,
  fresh: boolean,
  seed: string | null,
): void => {
  b.emit({ _tag: "SessionRotated", reason, fresh, seed });
  recordLoose(b, { kind: "marker", marker: { kind: "session-rotated", reason } });
  if (seed !== null) recordLoose(b, { kind: "context", notes: [seed] });
};

/** An item of the conversation's own, under no run, closed as it opens. */
export const recordLoose = (b: StepBuilder, body: ItemBody): void => {
  const id = ItemId.make(`${b.state.conversationId}/b/${b.state.headSeq + 1}`);
  b.emit({ _tag: "ItemOpened", runId: null, itemId: id, key: null, by: ENGINE_ACTOR, body });
  b.emit({ _tag: "ItemClosed", runId: null, itemId: id, body });
};

/** The admitted run sends now, if nothing holds it any more. */
export const redispatch = (b: StepBuilder): void => {
  const run = activeRun(b.state);
  if (run?.state === "admitted") dispatch(b, run);
};

type Delivery = "delivered" | "steered" | "refused" | "unknown";

const personBody = (run: RunRecord, delivery: Delivery, at: number): ItemBody | null =>
  run.personBody === null ? null : { ...run.personBody, delivery: { state: delivery, at } };

export const updatePerson = (b: StepBuilder, run: RunRecord, delivery: Delivery) => {
  const body = personBody(run, delivery, b.now);
  if (body === null || run.trigger.kind !== "person") return;
  b.emit({ _tag: "ItemUpdated", runId: run.id, itemId: run.trigger.itemId, body });
};

/**
 * Ends a run: its open items close (background work runs on and closes itself), its requests lapse, its watchdog is cancelled, and its
 * message never stays queued — refused when it never went out, or `unsent` (refused, or unknown
 * for a send that may have arrived) when it ends while sending.
 */
export const endRun = (
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
    // A question asked by message outlives its turn: the person answers it with a message. An
    // ask on a card outlives it too: the person answers it there. A helper's ask
    // outlives it while its helper waits on the answer.
    if (
      request.runId !== run.id ||
      request.dismissible === true ||
      request.byHelper === true ||
      isCardAsk(request.kind)
    )
      continue;
    b.emit({ _tag: "RequestClosed", runId: run.id, requestId: request.id, state: "lapsed" });
    askAgainByMessage(b, run, request, end);
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
};

export const settledBody = (body: ItemBody, end: RunEnd): ItemBody => {
  switch (body.kind) {
    case "call":
      // Only a call still running is settled by its run's end: one that came back keeps how it
      // came back (a helper's, after the turn that started its helper ended).
      return body.state !== "running"
        ? body
        : { ...body, state: end.kind === "stopped" ? "stopped" : "unreturned" };
    case "note":
    case "thought":
      return { ...body, streaming: false };
    default:
      return body;
  }
};

export const armWatchdog = (b: StepBuilder, run: RunRecord, from: number): void => {
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
export const markWaiting = (b: StepBuilder, run: RunRecord, request: RequestId): void => {
  b.emit({ _tag: "RunWaiting", runId: run.id, requestId: request });
  cancelWatchdog(b, run, "waiting on a person");
};

/** A waiting run runs again: its mark clears and the watchdog watches it again. */
export const markResumed = (b: StepBuilder, run: RunRecord): void => {
  b.emit({ _tag: "RunResumed", runId: run.id });
  armWatchdog(b, b.run(run.id), b.now);
};

/** A run spoke again: its mark clears and, while it runs, the watchdog watches it again. */
export const markResponsive = (b: StepBuilder, run: RunRecord): void => {
  b.emit({ _tag: "RunResponsive", runId: run.id });
  const live = b.run(run.id);
  if (live.state === "running") armWatchdog(b, live, b.now);
};

export const markStarted = (
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

/**
 * Every run's principal is a person or the principal a wake names (wakes run as the Mate's
 * signer): the engine may write items and markers, never be the one a run acts for.
 */
export const actsForSomeone = (b: StepBuilder): void => {
  if (b.envelope.principal.kind === "engine") {
    throw new Rejected("invalid-principal", "the engine is never a run's principal");
  }
};

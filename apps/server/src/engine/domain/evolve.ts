/**
 * `evolve(state, event)`: the one fold, shared by the actor after a commit and by rehydration
 * (snapshot plus tail). Pure; an event this build does not know only moves the head.
 *
 * @module engine/domain/evolve
 */
import {
  ENGINE_EVENT_VERSION,
  type EngineEvent,
  type KnownEngineEvent,
  type RunEnd,
  type RunId,
  type TurnHandle,
} from "@t3tools/contracts";

import type { Envelope, EventDraft } from "./command.ts";
import { KEPT_ENDED_RUNS, contentDigest, type ConversationState, type RunRecord } from "./state.ts";

/** Stamps drafts with the header the store writes: gapless seq after the head, one time. */
export const stampEvents = (
  headSeq: number,
  envelope: Pick<Envelope, "commandId" | "conversationId">,
  drafts: ReadonlyArray<EventDraft>,
  at: number,
): ReadonlyArray<KnownEngineEvent> =>
  drafts.map(
    (draft, index) =>
      ({
        ...draft,
        v: ENGINE_EVENT_VERSION,
        conversationId: envelope.conversationId,
        seq: headSeq + index + 1,
        at,
        commandId: envelope.commandId,
      }) as KnownEngineEvent,
  );

const withRun = (
  state: ConversationState,
  id: RunId | null,
  update: (run: RunRecord) => RunRecord,
): ConversationState => {
  if (id === null) return state;
  const run = state.runs[id];
  return run === undefined ? state : { ...state, runs: { ...state.runs, [id]: update(run) } };
};

const without = <V>(record: Readonly<Record<string, V>>, key: string): Record<string, V> => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

const withTurn = (state: ConversationState, turn: string, run: RunId): ConversationState =>
  state.turns[turn] === run ? state : { ...state, turns: { ...state.turns, [turn]: run } };

const touch = (state: ConversationState, id: RunId | null, at: number) =>
  withRun(state, id, (run) => ({ ...run, lastActivityAt: at }));

export const evolve = (previous: ConversationState, event: EngineEvent): ConversationState => {
  const state: ConversationState = { ...previous, headSeq: event.seq };
  if (event._tag === "Unknown") return state;
  return evolveKnown(state, event);
};

const evolveKnown = (state: ConversationState, event: KnownEngineEvent): ConversationState => {
  switch (event._tag) {
    case "RunQueued": {
      const run: RunRecord = {
        id: event.runId,
        ordinal: event.ordinal,
        seq: event.seq,
        sinceSeq: event.seq,
        trigger: event.trigger,
        joins: event.joins,
        principal: event.principal,
        maintenance: event.maintenance,
        text: event.text,
        state: "queued",
        sessionId: null,
        providerTurnId: null,
        turn: null,
        waitingOn: null,
        stopAsked: null,
        end: null,
        endSource: null,
        queuedAt: event.at,
        admittedAt: null,
        startedAt: null,
        endedAt: null,
        lastActivityAt: null,
        unresponsiveSince: null,
        nextItemOrdinal: 1,
        nextRequestOrdinal: 1,
        sessionOpenAttempts: 0,
        sendAttempts: 0,
        prepare: "none",
        personBody: null,
      };
      const next: ConversationState = {
        ...state,
        runs: { ...state.runs, [run.id]: run },
        queue: [...state.queue, run.id],
        nextRunOrdinal: Math.max(state.nextRunOrdinal, event.ordinal + 1),
        latestRunId: run.id,
      };
      const continuesCut =
        event.trigger.kind === "wake" && event.trigger.cause === "restart-continuation";
      return continuesCut
        ? withRun(next, event.joins, (joined) =>
            joined.end?.kind === "cut-by-restart"
              ? { ...joined, end: { ...joined.end, continuedBy: run.id } }
              : joined,
          )
        : next;
    }
    case "RunAdmitted":
      return withRun(
        {
          ...state,
          queue: state.queue.filter((id) => id !== event.runId),
          activeRunId: event.runId,
        },
        event.runId,
        (run) => ({ ...run, state: "admitted", admittedAt: event.at }),
      );
    case "RunSending":
      // The engine's handle for the message it sends is the run's own id.
      return withRun(withTurn(state, event.runId, event.runId), event.runId, (run) => ({
        ...run,
        state: "sending",
        sessionId: event.sessionId,
        turn: run.turn ?? (event.runId as string as TurnHandle),
      }));
    case "RunStarted": {
      const turned = event.turn === null ? state : withTurn(state, event.turn, event.runId);
      return withRun(turned, event.runId, (run) => ({
        ...run,
        state: "running",
        startedAt: event.at,
        providerTurnId: event.providerTurnId,
        turn: event.turn ?? run.turn,
        sessionId: run.sessionId ?? state.session?.id ?? null,
        lastActivityAt: event.at,
      }));
    }
    case "RunWaiting":
      return withRun(state, event.runId, (run) => ({
        ...run,
        state: "waiting",
        waitingOn: event.requestId,
      }));
    case "RunResumed":
      return withRun(state, event.runId, (run) => ({
        ...run,
        state: "running",
        waitingOn: null,
        lastActivityAt: event.at,
        unresponsiveSince: null,
      }));
    case "RunStopAsked":
      return withRun(state, event.runId, (run) => ({
        ...run,
        stopAsked: { by: event.by, at: event.at },
      }));
    case "RunEnded": {
      const ended = withRun(state, event.runId, (run) => ({
        ...run,
        state: "ended",
        end: event.end,
        endSource: event.source,
        endedAt: event.at,
        waitingOn: null,
      }));
      const kept = [...state.endedRuns.filter((id) => id !== event.runId), event.runId];
      const dropped = kept.length > KEPT_ENDED_RUNS ? kept.shift() : undefined;
      const prune = dropped !== undefined && dropped !== state.latestRunId;
      const runs = prune ? without(ended.runs, dropped) : ended.runs;
      const keep = <V>(record: Readonly<Record<string, V>>, runOf: (value: V) => RunId | null) =>
        prune
          ? Object.fromEntries(Object.entries(record).filter(([, v]) => runOf(v) !== dropped))
          : record;
      return {
        ...ended,
        runs,
        turns: keep(ended.turns, (run) => run),
        items: keep(ended.items, (item) => item.runId),
        closedItems: keep(ended.closedItems, (item) => item.runId),
        askedKeys: keep(ended.askedKeys, (run) => run),
        queue: state.queue.filter((id) => id !== event.runId),
        activeRunId: state.activeRunId === event.runId ? null : state.activeRunId,
        endedRuns: kept,
        pausedUntil: pauseAfter(event.end, state.pausedUntil),
        usageProbeMs: event.end.kind === "usage-limit" ? state.usageProbeMs : null,
      };
    }
    case "RunRequeued":
      return withRun(
        {
          ...state,
          queue: [event.runId, ...state.queue.filter((id) => id !== event.runId)],
          activeRunId: state.activeRunId === event.runId ? null : state.activeRunId,
        },
        event.runId,
        (run) => ({ ...run, state: "queued", sessionId: null, admittedAt: null }),
      );
    case "RunNotContinued":
      return withRun(state, event.runId, (run) =>
        run.end?.kind === "cut-by-restart"
          ? { ...run, end: { ...run.end, notContinued: event.reason } }
          : run,
      );
    case "RunUnresponsive":
      return withRun(state, event.runId, (run) => ({
        ...run,
        unresponsiveSince: event.silentSince,
      }));
    case "RunResponsive":
      return withRun(state, event.runId, (run) => ({
        ...run,
        unresponsiveSince: null,
        lastActivityAt: event.at,
      }));
    case "ItemOpened": {
      const body = event.body;
      const counted = withRun(state, event.runId, (run) => {
        const own =
          body.kind === "person" &&
          run.trigger.kind === "person" &&
          run.trigger.itemId === event.itemId;
        return {
          ...run,
          nextItemOrdinal: run.nextItemOrdinal + 1,
          lastActivityAt: body.kind === "person" ? run.lastActivityAt : event.at,
          sinceSeq: own ? event.seq : run.sinceSeq,
          personBody: own ? body : run.personBody,
        };
      });
      if (body.kind === "person" && body.delivery.state !== "steered") {
        // Only a message waiting for its own run is newer work.
        return body.delivery.state === "queued"
          ? { ...counted, lastPersonSeq: event.seq }
          : counted;
      }
      // A steered message joins the run, open with it: its steer's outcome may still change it.
      return {
        ...counted,
        items: {
          ...counted.items,
          [event.itemId]: {
            id: event.itemId,
            runId: event.runId,
            key: event.key,
            by: event.by,
            body: event.body,
          },
        },
      };
    }
    case "ItemUpdated": {
      const item = state.items[event.itemId];
      const body = event.body;
      const touched =
        body.kind === "person"
          ? withRun(state, event.runId, (run) =>
              run.trigger.kind === "person" && run.trigger.itemId === event.itemId
                ? { ...run, personBody: body }
                : run,
            )
          : touch(state, event.runId, event.at);
      if (item !== undefined) {
        return {
          ...touched,
          items: { ...touched.items, [item.id]: { ...item, body: event.body } },
        };
      }
      // An item closed before: its body changed in place (an upsert after its turn's end).
      const closed = Object.entries(touched.closedItems).find(([, c]) => c.itemId === event.itemId);
      return closed === undefined
        ? touched
        : {
            ...touched,
            closedItems: {
              ...touched.closedItems,
              [closed[0]]: { ...closed[1], digest: contentDigest(event.body) },
            },
          };
    }
    case "ItemClosed": {
      const touched = touch(state, event.runId, event.at);
      const item = touched.items[event.itemId];
      return {
        ...touched,
        items: without(touched.items, event.itemId),
        closedItems:
          item === undefined || item.key === null
            ? touched.closedItems
            : {
                ...touched.closedItems,
                [item.key]: {
                  itemId: event.itemId,
                  runId: event.runId,
                  digest: contentDigest(event.body),
                },
              },
      };
    }
    case "RequestOpened": {
      const counted = withRun(state, event.runId, (run) => ({
        ...run,
        nextRequestOrdinal: run.nextRequestOrdinal + 1,
        lastActivityAt: event.at,
      }));
      return {
        ...counted,
        askedKeys: { ...counted.askedKeys, [event.key]: event.runId },
        requests: {
          ...counted.requests,
          [event.requestId]: {
            id: event.requestId,
            runId: event.runId,
            key: event.key,
            answerable: event.answerable,
            principal: event.principal,
            answers: 0,
            kind: event.ask.kind,
          },
        },
      };
    }
    case "RequestAnswered": {
      const request = state.requests[event.requestId];
      return {
        ...state,
        requests: without(state.requests, event.requestId),
        answering:
          request === undefined
            ? state.answering
            : {
                ...state.answering,
                [event.effectId]: { ...request, answers: request.answers + 1 },
              },
      };
    }
    case "RequestReopened": {
      const answered = Object.values(state.answering).find((open) => open.id === event.requestId);
      return {
        ...state,
        requests: {
          ...state.requests,
          [event.requestId]: {
            id: event.requestId,
            runId: event.runId,
            key: event.key,
            answerable: true,
            principal: event.principal,
            answers: event.answers,
            ...(answered?.kind === undefined ? {} : { kind: answered.kind }),
          },
        },
        answering: Object.fromEntries(
          Object.entries(state.answering).filter(([, open]) => open.id !== event.requestId),
        ),
      };
    }
    case "RequestClosed":
      return {
        ...state,
        requests: without(state.requests, event.requestId),
        answering: Object.fromEntries(
          Object.entries(state.answering).filter(([, open]) => open.id !== event.requestId),
        ),
      };
    case "SessionOpened":
      return {
        ...state,
        session: {
          id: event.sessionId,
          driver: event.driver,
          requestedModel: event.requestedModel,
          instanceId: event.instanceId ?? null,
          model: event.model,
          nativeRef: event.nativeRef,
          capabilities: event.capabilities,
          closeAttempts: 0,
        },
        lastNativeRef: event.nativeRef ?? state.lastNativeRef,
        rotatingFrom: null,
      };
    case "SessionClosed":
      return {
        ...state,
        session: state.session?.id === event.sessionId ? null : state.session,
        closing: state.closing?.sessionId === event.sessionId ? null : state.closing,
        rotatingFrom: event.reason === "model" ? event.sessionId : state.rotatingFrom,
      };
    case "AgentAssigned":
      // The agent's own model, none included: null runs its driver's default. Another instance or
      // driver cannot resume this one's native session: the next session starts on a new thread.
      return {
        ...state,
        agent: event.agent,
        model: event.agent.model,
        threadGeneration:
          state.agent !== null &&
          (state.agent.instanceId !== event.agent.instanceId ||
            state.agent.driver !== event.agent.driver)
            ? state.threadGeneration + 1
            : state.threadGeneration,
      };
    case "ModelSwitched":
      return {
        ...state,
        model: event.model,
        agent: state.agent === null ? null : { ...state.agent, model: event.model },
      };
    case "ConversationArchived":
      return { ...state, archived: true };
    case "ConversationUnarchived":
      return { ...state, archived: false };
    case "EffectRequested": {
      const counted =
        event.kind === "session.open"
          ? withRun(state, event.runId, (run) => ({
              ...run,
              sessionOpenAttempts: run.sessionOpenAttempts + 1,
            }))
          : event.kind === "provider.send"
            ? withRun(state, event.runId, (run) => ({ ...run, sendAttempts: run.sendAttempts + 1 }))
            : event.kind === "run.prepare"
              ? withRun(state, event.runId, (run) => ({ ...run, prepare: "asked" }))
              : event.kind === "session.close" && state.session !== null
                ? {
                    ...state,
                    session: { ...state.session, closeAttempts: state.session.closeAttempts + 1 },
                  }
                : state;
      return {
        ...counted,
        effects: {
          ...counted.effects,
          [event.effectId]: { id: event.effectId, kind: event.kind, runId: event.runId },
        },
      };
    }
    case "EffectOutcomeRecorded": {
      const effect = state.effects[event.effectId];
      const prepared =
        effect?.kind === "run.prepare"
          ? withRun(state, effect.runId, (run) => ({ ...run, prepare: "done" }))
          : state;
      return {
        ...prepared,
        effects: without(prepared.effects, event.effectId),
        answering: without(prepared.answering, event.effectId),
        closing: prepared.closing?.effectId === event.effectId ? null : prepared.closing,
      };
    }
    case "SessionClosing":
      return {
        ...state,
        closing: { sessionId: event.sessionId, reason: event.reason, effectId: event.effectId },
      };
    case "WakeArmed":
      return {
        ...state,
        pausedUntil: event.kind === "usage-resume" ? event.dueAt : state.pausedUntil,
        usageProbeMs: event.kind === "usage-probe" ? event.dueAt - event.at : state.usageProbeMs,
        wakes: {
          ...state.wakes,
          [event.wakeId]: {
            id: event.wakeId,
            kind: event.kind,
            dueAt: event.dueAt,
            cron: event.cron,
            principal: event.principal,
            joins: event.joins,
            text: event.text,
            armedSeq: event.seq,
          },
        },
      };
    case "WakeFired": {
      const wake = state.wakes[event.wakeId];
      return {
        ...state,
        wakes: without(state.wakes, event.wakeId),
        pausedUntil: isUsageWake(wake?.kind) ? null : state.pausedUntil,
      };
    }
    case "WakeCancelled":
      return { ...state, wakes: without(state.wakes, event.wakeId) };
    case "UsagePauseLifted":
      return { ...state, pausedUntil: null };
  }
};

/** A usage limit holds the queue until its reset, or until a probe says when that is. */
const pauseAfter = (end: RunEnd, current: number | "unknown" | null) =>
  end.kind === "usage-limit" ? (end.resetsAt ?? "unknown") : current;

/** The wakes that end a usage pause when they fire or are cancelled. */
export const isUsageWake = (kind: string | undefined): boolean =>
  kind === "usage-resume" || kind === "usage-probe";

/** Folds events onto a state: rehydration's tail fold, and a full fold from the start. */
export const fold = (
  state: ConversationState,
  events: Iterable<EngineEvent>,
): ConversationState => {
  let next = state;
  for (const event of events) next = evolve(next, event);
  return next;
};

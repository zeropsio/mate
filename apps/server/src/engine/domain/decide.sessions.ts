/**
 * A session's life in the step: its idle wake, the agent's due turn, its close and what a close loses.
 *
 * @module engine/domain/decide.sessions
 */
import {
  wakeId as deriveWakeId,
  type SessionCloseReason,
  type SessionId,
  WORK_ENDED,
} from "@t3tools/contracts";
import { changedOptionIds } from "@t3tools/shared/modelOptions";

import type { ConversationState, SessionRecord } from "./state.ts";
import { ENGINE, type StepBuilder } from "./decide.step.ts";
import { LOST_HOW, noteLostWork } from "./decide.lostWork.ts";

/** How long an open session sits with nothing to do before the engine closes it. */
export const SESSION_IDLE_MS = 30 * 60_000;

export const idleWakeId = (b: StepBuilder, session: SessionId) =>
  deriveWakeId(b.state.conversationId, "session-idle", session);

export const armIdle = (b: StepBuilder): void => {
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

export const turnDueWakeId = (b: StepBuilder) =>
  deriveWakeId(b.state.conversationId, "agent-turn-due", "next");

/**
 * The Mate's finished work waits for the turn its agent opens to take the result
 * (`reportsDue`): with no run on, the conversation goes on until that turn opens, within
 * `AGENT_TURN_DUE_MS` of now. A run on, or one waiting to go, is the conversation going on.
 */
export const expectAgentTurn = (b: StepBuilder): void => {
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
export const endTurnDue = (b: StepBuilder): void => {
  if (b.state.wakes[turnDueWakeId(b)] === undefined) return;
  b.emit({ _tag: "WakeCancelled", wakeId: turnDueWakeId(b), reason: "a run started" });
};

export const cancelIdle = (b: StepBuilder): void => {
  for (const wake of Object.values(b.state.wakes)) {
    if (wake.kind === "session-idle") {
      b.emit({ _tag: "WakeCancelled", wakeId: wake.id, reason: "a run was admitted" });
    }
  }
};

/** Asks the session to close; nothing goes into it until it has. */
export const closeSession = (b: StepBuilder, reason: SessionCloseReason): void => {
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
export const misfit = (
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
export const sessionClosed = (
  b: StepBuilder,
  sessionId: SessionId,
  reason: SessionCloseReason,
): void => {
  b.emit({ _tag: "SessionClosed", sessionId, reason });
  // Its agent is gone: the turn it would have opened on its finished work never comes.
  if (b.state.wakes[turnDueWakeId(b)] !== undefined) {
    b.emit({ _tag: "WakeCancelled", wakeId: turnDueWakeId(b), reason: "its session closed" });
  }
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

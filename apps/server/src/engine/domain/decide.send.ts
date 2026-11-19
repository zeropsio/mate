/**
 * A person's or a Mate's message, and Stop.
 *
 * @module engine/domain/decide.send
 */
import {
  itemId as deriveItemId,
  runId as deriveRunId,
  type RunId,
  type SessionId,
  WORK_ENDED,
} from "@t3tools/contracts";

import type { Command } from "./command.ts";
import type { RunRecord } from "./state.ts";
import { toldWith } from "./told.ts";
import { ENGINE_ACTOR, Rejected, type StepBuilder, isLive } from "./decide.step.ts";
import { workLives } from "./decide.lostWork.ts";
import { turnDueWakeId, closeSession } from "./decide.sessions.ts";
import { queueRun, admitNext, endRun, actsForSomeone } from "./decide.runs.ts";
import { refuseOverWork } from "./decide.settings.ts";
import { steerInto } from "./decide.steer.ts";
import { cancelUsageWakes } from "./decide.usage.ts";

export const send = (b: StepBuilder, command: Extract<Command, { _tag: "Send" }>): void => {
  actsForSomeone(b);
  if (b.state.archived) throw new Rejected("archived");
  const attachments = command.attachments ?? [];
  if (command.text.trim() === "" && attachments.length === 0) throw new Rejected("empty-message");
  refuseOverWork(b);
  // The agent hears the context with the words; the person's item keeps only what they typed.
  const told =
    command.told ??
    (command.maintenance === true || command.card !== undefined
      ? command.text
      : toldWith(command.text, command.context));
  // A Mate's message waits for the turn asleep on the person's answer: it is never that answer.
  const sleeping = command.mateMessage === undefined ? sleepingTurn(b) : undefined;
  if (sleeping !== undefined) {
    // Queued behind it, the message would never come: the turn waits for it.
    steerInto(b, sleeping.run, sleeping.sessionId, command.text, attachments, told, command.about);
    return;
  }
  const ordinal = b.state.nextRunOrdinal;
  const item = deriveItemId(deriveRunId(b.state.conversationId, ordinal), 1);
  const run = queueRun(b, {
    trigger: () => ({ kind: "person", itemId: item }),
    joins: null,
    principal: b.envelope.principal,
    maintenance: command.maintenance === true,
    text: told,
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
            ...(command.fromPanel === true ? { fromPanel: true as const } : {}),
            ...(command.about === undefined ? {} : { about: command.about }),
            ...(command.task === undefined ? {} : { task: command.task }),
            ...(command.taskAsk === undefined ? {} : { taskAsk: command.taskAsk }),
            ...(command.taskMessage === undefined ? {} : { taskMessage: command.taskMessage }),
            ...(command.taskId === undefined ? {} : { taskId: command.taskId }),
            ...(command.mateMessage === undefined ? {} : { mateMessage: command.mateMessage }),
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
  if (b.state.pausedUntil === "unknown" && command.mateMessage === undefined) {
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
 * living on in the session its turn ended in, and the turn its agent would open on its own to take
 * a finished helper's result. Nothing stops one piece of an agent's background work across
 * drivers, so the session closes (V1's Claude Stop is the same hard boundary); its work ends as
 * stopped, and the next message resumes the conversation on a new session.
 */
const stopWork = (b: StepBuilder): void => {
  const session = b.state.session;
  const awaited = b.state.wakes[turnDueWakeId(b)] !== undefined;
  if (session === null || !(workLives(b.state) || awaited)) throw new Rejected("run-not-running");
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

export const stop = (b: StepBuilder, target: RunId | undefined): void => {
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
  // One Stop stops what the turn started too: its helpers and shells live in its session, which
  // closes with the Stop — beside the interrupt, never behind it — unless the driver's own Stop
  // closes it (Claude: a close racing its interrupt could kill a first turn it never saved).
  const session = b.state.session;
  if (
    workLives(b.state) &&
    session !== null &&
    session.id === run.sessionId &&
    session.capabilities.stopClosesSession !== true
  ) {
    closeSession(b, "stop");
  }
};

/**
 * Background work a lost or stopped session took with it: the note that tells the Mate,
 * its wake, and when it is spent.
 *
 * @module engine/domain/decide.lostWork
 */
import { wakeId as deriveWakeId, type SessionCloseReason, WORK_ENDED } from "@t3tools/contracts";

import { activeRun, type ConversationState, type RunRecord } from "./state.ts";
import {
  ENGINE,
  type StepBuilder,
  needsPrepare,
  type LostWork,
  crewCarriesOn,
} from "./decide.step.ts";

/** How the note says a person's Stop ended the work: never a restart (Milo called it one). */
export const BY_THE_PERSON = "by the person";

/** How the note says the work's session went, by why it closed; a close not listed tells nothing. */
export const LOST_HOW: Partial<Record<SessionCloseReason, string>> = {
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
export const stoppedWorkWakeId = (b: StepBuilder) =>
  deriveWakeId(b.state.conversationId, "lost-work", "stopped");

/** The lost-work notes waiting for the next message: the person's Stop's first. */
const workNotes = (b: StepBuilder) =>
  [b.state.wakes[stoppedWorkWakeId(b)], b.state.wakes[lostWorkWakeId(b)]].filter(
    (wake): wake is NonNullable<typeof wake> => wake !== undefined && wake.text !== null,
  );

/** A person's Stop is in force: the close it asked, or the latest run it stopped. */
export const personStopped = (state: ConversationState): boolean =>
  state.closing?.reason === "stop" ||
  (state.latestRunId !== null && state.runs[state.latestRunId]?.stopAsked != null);

/** A lost-work note held for the next send: it never fires on its own. */
export const HELD_FOR_SEND = Number.MAX_SAFE_INTEGER;

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
export const runPending = (state: ConversationState): boolean => {
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
export const noteLostWork = (b: StepBuilder): void => {
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
export const withLostWorkNote = (b: StepBuilder, run: RunRecord): string => {
  const notes = workNotes(b);
  if (notes.length === 0 || run.maintenance) return run.text;
  for (const wake of notes) {
    if (wake.dueAt !== HELD_FOR_SEND) rearmLostWork(b, wake, HELD_FOR_SEND);
  }
  return `${notes.map((wake) => wake.text).join(" ")}\n\n${run.text}`;
};

export const rearmLostWork = (
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
export const spendLostWorkNote = (b: StepBuilder, run: RunRecord): void => {
  if (run.maintenance || !needsPrepare(run)) return;
  for (const wake of workNotes(b)) {
    b.emit({ _tag: "WakeCancelled", wakeId: wake.id, reason: "went with the run's message" });
  }
};

/** A note held for a message that will not go any more fires on its own. */
export const releaseLostWork = (b: StepBuilder): void => {
  const wake = b.state.wakes[lostWorkWakeId(b)];
  if (wake === undefined || wake.dueAt !== HELD_FOR_SEND || runPending(b.state)) return;
  rearmLostWork(b, wake, b.now);
};

/** The agent's background work lives in the session: a new session would end it. */
export const workLives = (state: ConversationState): boolean =>
  Object.values(state.items).some(
    (item) => item.body.kind === "work" && !WORK_ENDED.has(item.body.status),
  );

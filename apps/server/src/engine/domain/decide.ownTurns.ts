/**
 * Turns the agent starts itself and the run each joins.
 *
 * @module engine/domain/decide.ownTurns
 */
import type { Principal, RunId, RunTrigger, TurnHandle } from "@t3tools/contracts";

import { activeRun, type RunRecord } from "./state.ts";
import { steeredWith } from "./told.ts";
import type { StepBuilder } from "./decide.step.ts";
import { withLostWorkNote } from "./decide.lostWork.ts";
import { misfit } from "./decide.sessions.ts";
import { queueRun, markStarted } from "./decide.runs.ts";

/** A turn the agent started on its own: a run that joins the run whose work it reports. */
/**
 * The run a self turn joins (the bridge's word, else the latest that ran; none when that run was
 * stopped) and its principal.
 */
export const selfJoins = (
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
export const steerOpened = (b: StepBuilder, turn: TurnHandle): RunId | undefined => {
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
export const waitingMessage = (b: StepBuilder): RunRecord | undefined => {
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
export const joinOwnTurn = (
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

export const selfStarted = (
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

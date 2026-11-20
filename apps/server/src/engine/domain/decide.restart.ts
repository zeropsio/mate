/**
 * A restart: what the cut run becomes and whether a continuation follows.
 *
 * @module engine/domain/decide.restart
 */
import {
  wakeId as deriveWakeId,
  type EffectId,
  type MateRestart,
  type RunId,
} from "@t3tools/contracts";

import { activeRun, type ConversationState, type RunRecord } from "./state.ts";
import { type StepBuilder, isLive, crewCarriesOn } from "./decide.step.ts";
import { sessionClosed } from "./decide.sessions.ts";
import { reopenCarried, waitsOnQuestion } from "./decide.carried.ts";
import { continueText, resentText, admitNext, dispatch, endRun } from "./decide.runs.ts";

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

export const recovered = (
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

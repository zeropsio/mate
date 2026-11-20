/**
 * The engine's watch lines: what an operator reads in the server log when a Mate misbehaves. Each
 * comes from a commit, so a step told again (a retried settle, a duplicate) logs nothing twice:
 *
 * - a run that ends failed, crashed or cut by a restart, with its reason;
 * - an effect that fails for good: its kind, conversation and reason.
 *
 * A line holds ids, states, counts and the engine's own reasons, cut to their first line. Never a
 * person's words: a message's text, an answer or a call's input stays in the record.
 *
 * @module engine/watch
 */
import * as Effect from "effect/Effect";
import type { ConversationId, KnownEngineEvent, RunEnd } from "@t3tools/contracts";

const REASON_CHARS = 300;

/** A reason as a line: its first line, at most `REASON_CHARS`; a stack or a dump stays out. */
export const reasonLine = (reason: string): string => {
  const first = (reason.split("\n")[0] ?? "").trim();
  return first.length > REASON_CHARS ? `${first.slice(0, REASON_CHARS - 1)}…` : first;
};

const runEndFields = (end: RunEnd) => {
  switch (end.kind) {
    case "failed":
    case "crashed":
      return { end: end.kind, reason: reasonLine(end.reason) };
    case "cut-by-restart":
      return {
        end: end.kind,
        reason: reasonLine(end.words ?? "the server restarted"),
        ...(end.notContinued === undefined ? {} : { notContinued: reasonLine(end.notContinued) }),
      };
    default:
      return null;
  }
};

const lineOf = (conversation: ConversationId, event: KnownEngineEvent): Effect.Effect<void> => {
  switch (event._tag) {
    case "RunEnded": {
      const fields = runEndFields(event.end);
      if (fields === null) return Effect.void;
      const line = { conversation, run: event.runId, ...fields };
      return event.end.kind === "cut-by-restart"
        ? Effect.logInfo("Mate engine: a run did not complete", line)
        : Effect.logWarning("Mate engine: a run did not complete", line);
    }
    case "EffectOutcomeRecorded": {
      const outcome = event.outcome;
      const reason =
        outcome.kind === "failed"
          ? outcome.reason
          : outcome.kind === "timed-out"
            ? `no answer within ${outcome.after} ms`
            : null;
      if (reason === null) return Effect.void;
      return Effect.logWarning("Mate engine: an effect failed for good", {
        kind: event.kind,
        conversation,
        effect: event.effectId,
        reason: reasonLine(reason),
      });
    }
    default:
      return Effect.void;
  }
};

/** The watch lines a commit's events call for; a line that cannot be written is let go. */
export const watchCommit = (
  conversation: ConversationId,
  events: ReadonlyArray<KnownEngineEvent>,
): Effect.Effect<void> =>
  Effect.forEach(events, (event) => lineOf(conversation, event), {
    discard: true,
  }).pipe(Effect.catchCause(() => Effect.void));

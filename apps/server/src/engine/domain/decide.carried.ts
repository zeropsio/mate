/**
 * A question a run carries: answered with the run, reopened when the run ends without it, asked again by message.
 *
 * @module engine/domain/decide.carried
 */
import {
  requestId as deriveRequestId,
  wakeId as deriveWakeId,
  type RunEnd,
} from "@t3tools/contracts";

import type { ConversationState, OpenRequest, RunRecord } from "./state.ts";
import type { StepBuilder } from "./decide.step.ts";

/** The answer a run's message carries: its own, or the one of the run it continues after a restart. */
export const answerCarried = (b: StepBuilder, run: RunRecord): OpenRequest | undefined => {
  const own = b.state.answering[run.id];
  if (own !== undefined || run.joins === null || run.trigger.kind !== "wake") return own;
  const continues =
    run.trigger.wakeId === deriveWakeId(b.state.conversationId, "restart-continuation", run.joins);
  return continues ? b.state.answering[run.joins] : undefined;
};

/** The message carrying an answer never reached the agent: the person answers again. */
export const reopenCarried = (b: StepBuilder, carried: OpenRequest, reason: string): void => {
  b.emit({
    _tag: "RequestReopened",
    runId: carried.runId,
    requestId: carried.id,
    key: carried.key,
    principal: carried.principal,
    reason,
    answers: carried.answers,
  });
};

/** The ends that take the session a question waits in, not the person's or the agent's choice. */
const SESSION_ENDS: ReadonlySet<RunEnd["kind"]> = new Set(["cut-by-restart", "crashed"]);

/**
 * A question whose turn waited on it, cut with its session (a restart, a crash): the session
 * that would take the answer is gone, so the question is asked again by message, for every
 * driver alike. It stays on the person's screen, and their answer reaches the agent as their
 * message (`answerByMessage`) — never lost with the turn, never typed again from memory.
 */
export const askAgainByMessage = (
  b: StepBuilder,
  run: RunRecord,
  request: OpenRequest,
  end: RunEnd,
): void => {
  if (!SESSION_ENDS.has(end.kind) || request.kind !== "question" || request.asked === undefined)
    return;
  b.emit({
    _tag: "RequestOpened",
    runId: run.id,
    requestId: deriveRequestId(run.id, b.run(run.id).nextRequestOrdinal),
    key: `${request.key}/by-message`,
    ask: { kind: "question", questions: [...request.asked], dismissible: true },
    answerable: true,
    principal: request.principal,
  });
};

/** Whether the run waits on a question a session's end asks again by message. */
export const waitsOnQuestion = (state: ConversationState, run: RunRecord): boolean =>
  run.state === "waiting" &&
  Object.values(state.requests).some(
    (request) =>
      request.runId === run.id && request.kind === "question" && request.asked !== undefined,
  );

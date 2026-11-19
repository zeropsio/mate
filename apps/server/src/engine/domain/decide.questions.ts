/**
 * An agent's question: answered on its card or by a message, dismissed, and the run resumed.
 *
 * @module engine/domain/decide.questions
 */
import {
  runId as deriveRunId,
  type ProviderUserInputAnswers,
  type RequestId,
  type RunId,
  type UserInputAttachments,
  isCardAsk,
} from "@t3tools/contracts";

import type { Command, EventDraft } from "./command.ts";
import type { OpenRequest } from "./state.ts";
import { Rejected, type StepBuilder } from "./decide.step.ts";
import { markResumed } from "./decide.runs.ts";
import { steerInto } from "./decide.steer.ts";
import { send } from "./decide.send.ts";
import { answerVault, answerSecret, answerOrigin, answerMirror } from "./decide.asks.ts";

export const answer = (b: StepBuilder, command: Extract<Command, { _tag: "Answer" }>): void => {
  const request = b.state.requests[command.requestId];
  if (request === undefined) throw new Rejected("unknown-request");
  if (!request.answerable) throw new Rejected("not-answerable");
  if (request.kind === "vault") return answerVault(b, request, command);
  if (request.kind === "secret") return answerSecret(b, request, command);
  if (request.kind === "origin") return answerOrigin(b, request, command);
  if (request.kind === "mirror") return answerMirror(b, request, command);
  if (request.dismissible === true) return answerByMessage(b, request, command);
  // A helper's ask may outlive the run the state keeps: the session it asked in takes the answer.
  const run = b.state.runs[request.runId];
  const sessionId =
    run?.sessionId ?? (request.byHelper === true ? (b.state.session?.id ?? null) : null);
  const effect = b.effect("provider.respond", request.id, request.answers + 1, request.runId, {
    requestId: request.id,
    key: request.key,
    sessionId,
    answer: command.answer,
  });
  b.emit({
    _tag: "RequestAnswered",
    runId: request.runId,
    requestId: request.id,
    by: b.envelope.principal,
    summary: command.summary,
    effectId: effect,
    ...(request.kind === "question" ? questionAnswer(command.answer) : {}),
  });
  b.result = { ...b.result, requestId: request.id, runId: request.runId };
  resumeIfAnswered(b, request.runId);
};

/**
 * A question asked by message (Codex's async question) takes its answer as V1 gives it: the
 * person's message, each question with its answer and the names of the files attached to it, the
 * pictures beside it. The driver has no call waiting for it. The request is answered once that
 * message reaches the agent (`markStarted`), and opens again if it never does (`endRun`).
 */
const answerByMessage = (
  b: StepBuilder,
  request: OpenRequest,
  command: Extract<Command, { _tag: "Answer" }>,
): void => {
  const given = questionAnswer(command.answer);
  const answers = (given.answers ?? {}) as Readonly<Record<string, unknown>>;
  const byQuestion = given.attachmentsByQuestionId ?? {};
  const unanswered = () => new Rejected("empty-message", "Answer each question before sending.");
  const questions = request.questions ?? [];
  if (questions.length === 0) throw unanswered();
  const replies = questions.map((question) => {
    const said = answers[question.id];
    const files = byQuestion[question.id] ?? [];
    if (typeof said !== "string" || (said.trim() === "" && files.length === 0)) throw unanswered();
    const named = files.map((file) => `Attached file: ${file.name} (${file.id})`).join("\n");
    return [`${question.question}\n${said.trim()}`, named].filter(Boolean).join("\n");
  });
  // The message carries every attachment as V1's does: pictures and files, each also named.
  const attachments = Object.values(byQuestion).flat();
  const text = replies.join("\n\n");
  // The person's message shows the answer, so the question's record keeps its summary alone.
  const answered = {
    _tag: "RequestAnswered",
    runId: request.runId,
    requestId: request.id,
    by: b.envelope.principal,
    summary: command.summary,
  } as const;
  const asking = b.state.runs[request.runId];
  const session = b.state.session;
  if (
    asking !== undefined &&
    (asking.state === "running" || asking.state === "waiting") &&
    session !== null &&
    session.id === asking.sessionId
  ) {
    // The agent waits inside the turn that asked (Codex sleeps until the input comes): the
    // answer goes into that turn, as V1's turn start does, measured on Codex 0.161.0.
    const effect = steerInto(b, asking, session.id, text, attachments);
    b.emit({ ...answered, effectId: effect });
    b.result = { ...b.result, requestId: request.id, runId: asking.id };
    return;
  }
  // Its turn is over: the answer is the next message, a run of its own.
  const carrier = deriveRunId(b.state.conversationId, b.state.nextRunOrdinal);
  send(b, {
    _tag: "Send",
    text,
    attachments,
    ...(b.state.interactionMode === null ? {} : { interactionMode: b.state.interactionMode }),
  });
  b.emit({ ...answered, bySend: carrier });
  b.result = { ...b.result, requestId: request.id, runId: carrier };
};

/**
 * A request closed unanswered: only one its agent does not wait on, so nothing reaches the agent
 * (as V1's dismissal). The run it held resumes.
 */
export const dismiss = (b: StepBuilder, id: RequestId): void => {
  const request = b.state.requests[id];
  if (request === undefined) throw new Rejected("unknown-request");
  if (request.dismissible !== true) throw new Rejected("not-dismissible");
  b.emit({ _tag: "RequestClosed", runId: request.runId, requestId: id, state: "dismissed" });
  b.result = { ...b.result, requestId: id, runId: request.runId };
  resumeIfAnswered(b, request.runId);
};

/** What a question's record keeps of its answer: the words and pictures, by question id. */
const questionAnswer = (
  answer: unknown,
): Pick<
  Extract<EventDraft, { _tag: "RequestAnswered" }>,
  "answers" | "attachmentsByQuestionId"
> => {
  if (typeof answer !== "object" || answer === null) return {};
  const given = answer as {
    readonly answers?: ProviderUserInputAnswers;
    readonly attachmentsByQuestionId?: UserInputAttachments;
  };
  return {
    ...(given.answers === undefined ? {} : { answers: given.answers }),
    ...(given.attachmentsByQuestionId === undefined
      ? {}
      : { attachmentsByQuestionId: given.attachmentsByQuestionId }),
  };
};

export const resumeIfAnswered = (b: StepBuilder, id: RunId): void => {
  // A question asked by message outlives its run, which the state may no longer hold.
  const run = b.state.runs[id];
  if (run === undefined || run.state !== "waiting") return;
  const holds = (request: OpenRequest) => request.runId === id && !isCardAsk(request.kind);
  if (Object.values(b.state.requests).some(holds)) return;
  markResumed(b, run);
};

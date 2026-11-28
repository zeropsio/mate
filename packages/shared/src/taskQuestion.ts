/**
 * The line a task's agent ends its turn on when it cannot go on without a person's answer — its
 * last line, `QUESTION: …`, with nothing after it — read in one place: the server posts the
 * question where the task came from and drops the line from a summary; a task conversation draws
 * it as the Mate asking.
 */
import { MATE_TASK_BODY_MAX } from "@t3tools/contracts";

/** What starts the line; the agent's brief tells it so. */
export const TASK_QUESTION_MARK = "QUESTION:";

/**
 * The question the agent's last words end on, and those words without it; no question when they
 * end on anything else.
 */
export const taskQuestionOf = (
  text: string,
): { readonly question: string | undefined; readonly rest: string } => {
  const lines = text.trimEnd().split("\n");
  // The line as the agent may dress it in markdown: bold, code, a quote.
  const last = (lines.at(-1) ?? "").trim().replace(/^[>*_`\s]+|[*_`\s]+$/gu, "");
  const marked = last.startsWith(TASK_QUESTION_MARK) ? last.slice(TASK_QUESTION_MARK.length) : "";
  const question = marked.replace(/^[*_`\s]+/u, "").trim();
  if (question === "") return { question: undefined, rest: text };
  return {
    question: question.slice(0, MATE_TASK_BODY_MAX),
    rest: lines.slice(0, -1).join("\n").trim(),
  };
};

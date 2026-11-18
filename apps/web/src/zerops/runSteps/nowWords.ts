/**
 * What a Mate does this moment, in words: thinking, writing, a step, an operation it waits on, or
 * a wait on the person. The run card's now line and a working Mate's menu and crew rows say it in
 * these one words.
 */
import {
  browserCheckCaption,
  browserPageWords,
  operationLineWords,
  type ZeropsOperation,
} from "@t3tools/client-runtime/zerops/model";

import type { StepKind, WorkStep } from "./steps";

export const THINKING_WORDS = "Thinking";
export const WRITING_WORDS = "Writing";

/** One call at work this moment: a step, a platform operation, or a wait on the person. */
export type CallNow =
  | { readonly kind: "step"; readonly step: WorkStep }
  | { readonly kind: "operation"; readonly operation: ZeropsOperation }
  | { readonly kind: "waiting"; readonly on: "answer" | "approval" };

/** Several steps of one kind at once, said by their kind: "Running 3 commands", "Reading 2 files". */
const SEVERAL: Partial<Record<StepKind, (count: number) => string>> = {
  command: (count) => `Running ${count} commands`,
  read: (count) => `Reading ${count} files`,
  edit: (count) => `Editing ${count} files`,
  search: (count) => `Running ${count} searches`,
  web: (count) => `Reading ${count} pages`,
  look: (count) => `Looking at ${count} pictures`,
};

/** Several steps at once, in words: by their kind when they share one. */
export function severalWords(steps: ReadonlyArray<WorkStep>): string {
  const kinds = new Set(steps.map((step) => step.kind));
  const [only] = kinds;
  const say = kinds.size === 1 && only !== undefined ? SEVERAL[only] : undefined;
  return say === undefined ? `Running ${steps.length} steps` : say(steps.length);
}

/** A step as the now line says it: its own words, else its command. */
export function stepNowWords(step: WorkStep): string {
  return step.words ?? step.code ?? "Running a command";
}

/** A platform operation as the now line says it: a check names its page. */
export function operationNowWords(operation: ZeropsOperation): string {
  return operation.kind === "browser"
    ? `Checking ${browserPageWords(browserCheckCaption(operation))} in the browser`
    : operationLineWords(operation);
}

/** A wait on the person, in words: their answer to its question, or their approval. */
export function waitingWords(on: "answer" | "approval"): string {
  return on === "approval" ? "Waiting for your approval" : "Waiting for your answer";
}

/** One call at work this moment, in words. */
export function callNowWords(line: CallNow): string {
  switch (line.kind) {
    case "step":
      return stepNowWords(line.step);
    case "operation":
      return operationNowWords(line.operation);
    case "waiting":
      return waitingWords(line.on);
  }
}

import type { ComposerWaits } from "./facts.ts";

/** What the empty prompt field says, as a kind: the words are the surface's. */
export type PromptFieldSays =
  | "approval"
  | "choose-option"
  | "own-answer"
  | "plan-feedback"
  | "choose-project"
  | "sign-in"
  | "enable-provider"
  | "idle"
  | "connected";

/** Does the prompt field show what the draft carries: its pictures, files and terminal contexts? */
export function promptFieldCarriesDraft(waits: ComposerWaits): boolean {
  return !waits.approval && !waits.questions;
}

/** What does the empty prompt field say, given what stands between the person and a message? */
export function promptFieldSays(input: {
  waits: ComposerWaits;
  planFollowUp: boolean;
  projectMissing: boolean;
  signInRequired: boolean;
  providerUnavailable: boolean;
  disconnected: boolean;
}): PromptFieldSays {
  const { waits } = input;
  if (waits.approval) return "approval";
  if (waits.answering) return waits.openQuestion === "choice-only" ? "choose-option" : "own-answer";
  if (input.planFollowUp) return "plan-feedback";
  if (input.projectMissing) return "choose-project";
  if (input.signInRequired) return "sign-in";
  if (input.providerUnavailable) return "enable-provider";
  return input.disconnected ? "idle" : "connected";
}

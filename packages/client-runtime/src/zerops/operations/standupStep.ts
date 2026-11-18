import type { ZeropsOperationStep } from "../model/types.ts";

/** A held stage's step label: it waits on what did not stand up. */
export const HELD_LABEL = "Waits";

/** What a stand-up step is to its call: its own, the next call's, or held back by what did not stand up. */
export function standupStepRole(step: ZeropsOperationStep): "own" | "next" | "held" {
  if (step.state !== "queued") return "own";
  return step.stateLabel === HELD_LABEL ? "held" : "next";
}

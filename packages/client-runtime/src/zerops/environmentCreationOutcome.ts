// What a press reports of each step of an environment's creation while it runs, as values, and
// what a creation says where Zerops no longer confirms a write.

import type { EnvironmentCreationStep } from "./createEnvironment.ts";

export type EnvironmentCreationStepState = "queued" | "running" | "done" | "failed";

export interface EnvironmentCreationStepProgress {
  readonly step: EnvironmentCreationStep;
  readonly state: EnvironmentCreationStepState;
  /** Set on `failed`: what the platform said. */
  readonly error?: string;
  readonly startedAtMs?: number;
  readonly finishedAtMs?: number;
}

/** Where the project's `project.create` can no longer be followed to its end. */
export const UNCONFIRMED_PROJECT = "Zerops did not confirm the project was created.";
/** Where a write's end can no longer be followed. */
export const UNCONFIRMED_WRITE =
  "Zerops may have accepted this operation, but its response was lost. Check the project and its services before starting another operation.";

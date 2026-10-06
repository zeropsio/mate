/**
 * Where a creation's steps stand — its application in HQ, its first Mate's birth there, its
 * project at Zerops — read off the operations each step was recorded under. A projection cannot
 * list operations, so a creation names each step's request id from its own id
 * (`creationStepId`): `c1:app`, `c1:birth`, `c1:project`, and a step the person tried again
 * `c1:project#2`, the newest attempt the one read. What a step made — the application, the birth,
 * the project — is its owner's answer; a step stopped says why in its owner's words.
 *
 * @module data/projections/creationSteps
 */
import { operationResult, type OperationRecord } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";
import { operationEnd, operationStop } from "./operationEnd.ts";

export type CreationStep = "app" | "birth" | "project";

export type CreationStepRead =
  | { readonly state: "not-sent"; readonly attempt: 0 }
  | { readonly state: "running" | "done"; readonly attempt: number }
  | {
      readonly state: "stopped";
      readonly attempt: number;
      /** Its owner's words; `null` where only the step can say it lost sight of it. */
      readonly reason: string | null;
      /** It may have landed: tried again, it could be made twice. */
      readonly uncertain: boolean;
    };

export interface CreationRead {
  readonly steps: Readonly<Record<CreationStep, CreationStepRead>>;
  /** The application HQ made for it, once HQ answered. */
  readonly appId: string | null;
  /** Its first Mate's birth intent HQ recorded, once HQ answered. */
  readonly birthId: string | null;
  /** The project Zerops took for it, from the moment it took it — before its creation ends. */
  readonly projectId: string | null;
}

/** The request id a creation's step is recorded under: its first attempt, then `#2`, `#3`… */
export function creationStepId(creationId: string, step: CreationStep, attempt: number): string {
  return attempt <= 1 ? `${creationId}:${step}` : `${creationId}:${step}#${attempt}`;
}

/** The newest attempt recorded of a step: 0 where none was. */
function newestAttempt(read: ProjectionReads, creationId: string, step: CreationStep): number {
  let attempt = 0;
  while (read.operation(creationStepId(creationId, step, attempt + 1)) !== undefined) attempt += 1;
  return attempt;
}

const STEPS: ReadonlyArray<CreationStep> = ["app", "birth", "project"];

/** The project an accepted creation step made: a create's or an import's answer. */
function projectOf(record: OperationRecord | undefined): string | null {
  return (
    operationResult(record, "create-project")?.projectId ??
    operationResult(record, "import-project")?.projectId ??
    null
  );
}

export const creationSteps: Projection<
  { readonly orgId: string; readonly creationId: string },
  CreationRead
> = {
  name: "creationSteps",
  keyOf: ({ orgId, creationId }) => `${orgId}/${creationId}`,
  equals: sameValue,
  derive: (read, { orgId, creationId }) => {
    const records = {} as Record<CreationStep, OperationRecord | undefined>;
    const steps = {} as Record<CreationStep, CreationStepRead>;
    for (const step of STEPS) {
      const attempt = newestAttempt(read, creationId, step);
      if (attempt === 0) {
        steps[step] = { state: "not-sent", attempt: 0 };
        continue;
      }
      const requestId = creationStepId(creationId, step, attempt);
      const record = read.operation(requestId);
      records[step] = record;
      const end = operationEnd.derive(read, { requestId, orgId });
      const stop = end === null ? undefined : operationStop(end, record);
      steps[step] =
        stop === undefined
          ? { state: "running", attempt }
          : stop === null
            ? { state: "done", attempt }
            : { state: "stopped", attempt, ...stop };
    }
    return {
      steps,
      appId: operationResult(records.app, "create-app")?.appId ?? null,
      birthId: operationResult(records.birth, "record-birth")?.birthId ?? null,
      projectId: projectOf(records.project),
    };
  },
};

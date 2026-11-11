/**
 * Stopping a pipeline whose build has not ended, at Zerops (the GUI's Cancel build). Zerops's
 * answer ends the write; it shows once the build's process says it is canceling or canceled, or
 * the version itself says cancelled — never before Zerops does.
 *
 * @module data/operations/cancelBuild
 */
import type { ProjectionReads } from "../store.ts";
import type { IntentOf, OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "cancel-build": {
      readonly orgId: string;
      readonly projectId: string;
      readonly appVersionId: string;
      /** The build's process, where the project's processes hold it. */
      readonly processId: string | null;
    };
  }
}

const CANCELED: ReadonlySet<string> = new Set(["CANCELING", "CANCELED"]);

function cancelShown(read: ProjectionReads, intent: IntentOf<"cancel-build">): boolean {
  if (intent.processId !== null) {
    const process = read.fact("process", intent.processId);
    if (process.kind === "known" && CANCELED.has(process.value.status)) return true;
  }
  const pipeline = read.fact("pipeline", intent.appVersionId);
  return pipeline.kind === "known" && pipeline.value.status === "CANCELLED";
}

export const cancelBuild: OperationKind<"cancel-build"> = {
  kind: "cancel-build",
  executor: "zerops",
  ...shownInFacts<IntentOf<"cancel-build">>((intent) => intent.appVersionId, cancelShown),
};

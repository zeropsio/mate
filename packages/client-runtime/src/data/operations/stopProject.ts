/**
 * Stopping a running project — every service in it — at Zerops. Its answer is its end; the
 * project's row reading STOPPED reflects it and, after a lost answer, adopts it.
 *
 * @module data/operations/stopProject
 */
import type { OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "stop-project": {
      readonly orgId: string;
      readonly projectId: string;
    };
  }
}

export const stopProject: OperationKind<"stop-project"> = {
  kind: "stop-project",
  executor: "zerops",
  ...shownInFacts(
    (intent) => intent.projectId,
    (read, intent) => {
      const project = read.fact("project", intent.projectId);
      return project.kind === "known" && project.value.status === "STOPPED";
    },
  ),
};

/**
 * Starting a stopped project — every service in it — at Zerops. Its answer is its end; the
 * project's row reading ACTIVE reflects it and, after a lost answer, adopts it.
 *
 * @module data/operations/startProject
 */
import type { OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "start-project": {
      readonly orgId: string;
      readonly projectId: string;
    };
  }
}

export const startProject: OperationKind<"start-project"> = {
  kind: "start-project",
  executor: "zerops",
  ...shownInFacts(
    (intent) => intent.projectId,
    (read, intent) => {
      const project = read.fact("project", intent.projectId);
      return project.kind === "known" && project.value.status === "ACTIVE";
    },
  ),
};

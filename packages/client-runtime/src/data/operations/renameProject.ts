/**
 * Renaming a project, at Zerops, through the account's one writer of a project's record: its tags
 * put back as a fresh read holds them, and — given the name it was planned from — only a project
 * still named so. The writer's read-back confirms it, so its answer is its end; the project's row
 * carrying the name reflects it and, after a lost answer, adopts it.
 *
 * @module data/operations/renameProject
 */
import type { OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "rename-project": {
      readonly orgId: string;
      readonly projectId: string;
      readonly name: string;
      /** The name it was planned from: a project renamed since is refused, nothing written. */
      readonly from?: string;
    };
  }
}

export const renameProject: OperationKind<"rename-project"> = {
  kind: "rename-project",
  executor: "zerops",
  ...shownInFacts(
    (intent) => intent.projectId,
    (read, intent) => {
      const project = read.fact("project", intent.projectId);
      return project.kind === "known" && project.value.name === intent.name;
    },
  ),
};

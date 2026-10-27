/**
 * Changing a project's tags — declaring it a Mate — at Zerops, through the account's one writer of
 * a project's record, which confirms it by reading it back: its answer is its end. The project's
 * row carrying the change reflects it and, after a lost answer, adopts it.
 *
 * @module data/operations/updateProjectTags
 */
import {
  applyProjectTagPatch,
  sameProjectTags,
  type ProjectTagPatch,
} from "../../zerops/data/tagPatch.ts";
import type { OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "update-project-tags": {
      readonly orgId: string;
      readonly projectId: string;
      readonly patch: ProjectTagPatch;
    };
  }
}

export const updateProjectTags: OperationKind<"update-project-tags"> = {
  kind: "update-project-tags",
  executor: "zerops",
  ...shownInFacts(
    (intent) => intent.projectId,
    (read, intent) => {
      const project = read.fact("project", intent.projectId);
      if (project.kind !== "known") return false;
      const tags = project.value.tagList ?? [];
      return sameProjectTags(applyProjectTagPatch(tags, intent.patch), tags);
    },
  ),
};

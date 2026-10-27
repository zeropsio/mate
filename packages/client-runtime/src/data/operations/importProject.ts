/**
 * Importing a whole project at Zerops — the project and its services from one document
 * (`POST /client/{id}/project/import`): done once Zerops answers with the project, its result.
 * After a lost answer, the one project of its name that appeared since is it.
 *
 * @module data/operations/importProject
 */
import { projectsScope } from "../families/project.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "import-project": {
      readonly orgId: string;
      /** The project the document names. */
      readonly name: string;
      readonly yaml: string;
    };
  }
  interface OperationResults {
    readonly "import-project": { readonly projectId: string };
  }
}

export const importProject: OperationKind<"import-project"> = {
  kind: "import-project",
  executor: "zerops",
  reflected: (read, _intent, receipt) =>
    read.fact("project", receipt.handles[0] ?? "").kind === "known",
  effectHandles: (read, intent) =>
    read.members(projectsScope(intent.orgId)).ids.filter((id) => {
      const project = read.fact("project", id);
      return project.kind === "known" && project.value.name === intent.name;
    }),
  adoptedResult: (projectId) => ({ projectId }),
  // Its answer is its end: an adopted one is done as its project shows.
  settledBy: (read, _intent, receipt) =>
    read.fact("project", receipt.handles[0] ?? "").kind === "known" ? { kind: "succeeded" } : null,
};

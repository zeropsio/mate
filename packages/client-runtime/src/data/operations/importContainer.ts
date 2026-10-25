/**
 * Importing a Mate's container — its key and the tier's runtimes for zcp to import on boot — at
 * Zerops: done once Zerops answers, with the container's service and, where it named one, its
 * creation process. Safe to ask again: a project holding its container already makes no write.
 *
 * @module data/operations/importContainer
 */
import type { ZeropsAgentType } from "../../zerops/newProject.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "import-container": {
      readonly orgId: string;
      readonly projectId: string;
      /** What the project is called: its key is named after it. */
      readonly projectName: string;
      readonly agents: ReadonlyArray<ZeropsAgentType>;
      readonly setupRuntimesYaml?: string;
    };
  }
  interface OperationResults {
    readonly "import-container": {
      readonly serviceName: string;
      /** Imported now; `false` where the project held its container already. */
      readonly imported: boolean;
      readonly processId?: string;
    };
  }
}

export const importContainer: OperationKind<"import-container"> = {
  kind: "import-container",
  executor: "zerops",
  reflected: () => true,
};

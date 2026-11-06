/**
 * Importing a Mate at Zerops — its container holding its key, and its tier beside it, as one import
 * (`ZeropsApiClient.importDevelopmentContainer`): done once Zerops answers, with the container's
 * service and, where it named one, its creation process. Safe to ask again: a project holding its
 * container already makes no write.
 *
 * @module data/operations/importContainer
 */
import type { MateBirthplace, ZeropsAgentType } from "../../zerops/newProject.ts";
import type { TierProjectVariable } from "../../zerops/recipeTier.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "import-container": {
      readonly orgId: string;
      readonly projectId: string;
      /** What the project is called: its key is named after it. */
      readonly projectName: string;
      readonly agents: ReadonlyArray<ZeropsAgentType>;
      /** The tier's services as the birth imports them (`mateTier`). */
      readonly tierYaml?: string;
      readonly birthplace?: MateBirthplace;
    };
    readonly "prepare-tier-variables": {
      readonly orgId: string;
      readonly projectId: string;
      readonly variables: ReadonlyArray<TierProjectVariable>;
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

/** Preparation is idempotent by key and runs before the non-idempotent import claim. */
export const prepareTierVariables: OperationKind<"prepare-tier-variables"> = {
  kind: "prepare-tier-variables",
  executor: "zerops",
  reflected: () => true,
};

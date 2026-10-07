/**
 * Importing services into a project at Zerops (`POST /project/{id}/service-stack/import`): done
 * once Zerops answers. A second import is refused for the hostnames the first made, so a lost
 * answer stays uncertain — never sent again.
 *
 * @module data/operations/importServices
 */
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "import-services": {
      readonly orgId: string;
      readonly projectId: string;
      readonly yaml: string;
    };
  }
}

export const importServices: OperationKind<"import-services"> = {
  kind: "import-services",
  executor: "zerops",
  reflected: () => true,
};

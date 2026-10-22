/** HQ owns application names and deletion; its answer or its explicit facts decide the end. */
import type { OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "rename-app": {
      readonly orgId: string;
      readonly appId: string;
      readonly name: string;
    };
    readonly "delete-app": {
      readonly orgId: string;
      readonly appId: string;
    };
  }
}

export const renameApp: OperationKind<"rename-app"> = {
  kind: "rename-app",
  executor: "hq",
  ...shownInFacts(
    (intent) => intent.appId,
    (read, intent) => {
      const app = read.fact("hqApp", intent.appId);
      return app.kind === "known" && app.value.name === intent.name.trim();
    },
  ),
};
export const deleteApp: OperationKind<"delete-app"> = {
  kind: "delete-app",
  executor: "hq",
  ...shownInFacts(
    (intent) => intent.appId,
    (read, intent) => read.fact("hqApp", intent.appId).kind === "deleted",
  ),
};

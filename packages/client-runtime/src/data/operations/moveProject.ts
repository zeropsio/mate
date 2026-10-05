/**
 * Moving a project into an application, at HQ: reflected once HQ's navigation places it there.
 *
 * @module data/operations/moveProject
 */
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "move-project": {
      readonly projectId: string;
      readonly to: { readonly appId: string; readonly role: string };
    };
  }
}

export const moveProject: OperationKind<"move-project"> = {
  kind: "move-project",
  executor: "hq",
  reflected: (read, intent) => {
    const placement = read.fact("placement", intent.projectId);
    return (
      placement.kind === "known" &&
      placement.value.kind === "app" &&
      placement.value.appId === intent.to.appId
    );
  },
};

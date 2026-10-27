/** A demanded contents answer from the Mate; source values stay in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateWorkspaceContents: EnvironmentRpcSuccess<typeof WS_METHODS.projectsSearchContents>;
  }
}
export const mateWorkspaceContentsFamily: FamilySpec<"mateWorkspaceContents"> = {
  family: "mateWorkspaceContents",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-contents",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

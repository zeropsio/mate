/** A demanded file answer from the Mate; source values stay in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateWorkspaceFile: EnvironmentRpcSuccess<typeof WS_METHODS.projectsReadFile>;
  }
}
export const mateWorkspaceFileFamily: FamilySpec<"mateWorkspaceFile"> = {
  family: "mateWorkspaceFile",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-file",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

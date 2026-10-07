/** A demanded paths answer from the Mate; source values stay in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateWorkspacePaths: EnvironmentRpcSuccess<typeof WS_METHODS.projectsSearchEntries>;
  }
}
export const mateWorkspacePathsFamily: FamilySpec<"mateWorkspacePaths"> = {
  family: "mateWorkspacePaths",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-paths",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

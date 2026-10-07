/** A demanded entries answer from the Mate; source values stay in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateWorkspaceEntries: EnvironmentRpcSuccess<typeof WS_METHODS.projectsListEntries>;
  }
}
export const mateWorkspaceEntriesFamily: FamilySpec<"mateWorkspaceEntries"> = {
  family: "mateWorkspaceEntries",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-entries",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

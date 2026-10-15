/** The Mate's demanded runChanges answer: its conversation's runs that changed its workspace. */
import { ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateRunChanges: EnvironmentRpcSuccess<typeof ORCHESTRATION_WS_METHODS.getRunChanges>;
  }
}
export const mateRunChangesFamily: FamilySpec<"mateRunChanges"> = {
  family: "mateRunChanges",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-runChanges",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

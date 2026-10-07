/** The Mate's demanded turnDiff answer; retained only in account memory. */
import { ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateTurnDiff: EnvironmentRpcSuccess<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
  }
}
export const mateTurnDiffFamily: FamilySpec<"mateTurnDiff"> = {
  family: "mateTurnDiff",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-turnDiff",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

/** The Mate's demanded fullThreadDiff answer; retained only in account memory. */
import { ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateThreadDiff: EnvironmentRpcSuccess<
      typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff
    >;
  }
}
export const mateThreadDiffFamily: FamilySpec<"mateThreadDiff"> = {
  family: "mateThreadDiff",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-fullThreadDiff",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

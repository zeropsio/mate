/** The Mate's demanded resourceTelemetryHistory answer; retained only in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateResourceTelemetryHistory: EnvironmentRpcSuccess<
      typeof WS_METHODS.serverGetResourceTelemetryHistory
    >;
  }
}
export const mateResourceTelemetryHistoryFamily: FamilySpec<"mateResourceTelemetryHistory"> = {
  family: "mateResourceTelemetryHistory",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-resourceTelemetryHistory",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

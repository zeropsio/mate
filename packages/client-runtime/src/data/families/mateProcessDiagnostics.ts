/** The Mate's demanded processDiagnostics answer; retained only in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateProcessDiagnostics: EnvironmentRpcSuccess<
      typeof WS_METHODS.serverGetProcessDiagnostics
    >;
  }
}
export const mateProcessDiagnosticsFamily: FamilySpec<"mateProcessDiagnostics"> = {
  family: "mateProcessDiagnostics",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-processDiagnostics",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

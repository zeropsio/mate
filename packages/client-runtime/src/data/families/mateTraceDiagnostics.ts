/** The Mate's demanded traceDiagnostics answer; retained only in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateTraceDiagnostics: EnvironmentRpcSuccess<
      typeof WS_METHODS.serverGetTraceDiagnostics
    >;
  }
}
export const mateTraceDiagnosticsFamily: FamilySpec<"mateTraceDiagnostics"> = {
  family: "mateTraceDiagnostics",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-traceDiagnostics",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

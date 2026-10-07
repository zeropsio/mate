/** The Mate's demanded workflowScript answer; retained only in account memory. */
import { ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateWorkflowScript: EnvironmentRpcSuccess<
      typeof ORCHESTRATION_WS_METHODS.getWorkflowScript
    >;
  }
}
export const mateWorkflowScriptFamily: FamilySpec<"mateWorkflowScript"> = {
  family: "mateWorkflowScript",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-workflowScript",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

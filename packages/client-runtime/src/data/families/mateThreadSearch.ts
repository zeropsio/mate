/** The Mate's demanded threadSearch answer; retained only in account memory. */
import { ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateThreadSearch: EnvironmentRpcSuccess<typeof ORCHESTRATION_WS_METHODS.searchThreads>;
  }
}
export const mateThreadSearchFamily: FamilySpec<"mateThreadSearch"> = {
  family: "mateThreadSearch",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-threadSearch",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

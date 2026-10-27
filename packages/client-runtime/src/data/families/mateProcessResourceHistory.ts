/** The Mate's demanded processResourceHistory answer; retained only in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateProcessResourceHistory: EnvironmentRpcSuccess<
      typeof WS_METHODS.serverGetProcessResourceHistory
    >;
  }
}
export const mateProcessResourceHistoryFamily: FamilySpec<"mateProcessResourceHistory"> = {
  family: "mateProcessResourceHistory",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-processResourceHistory",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

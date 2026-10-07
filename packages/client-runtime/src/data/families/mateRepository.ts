/** The Mate's demanded repository answer; retained only in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateRepository: EnvironmentRpcSuccess<typeof WS_METHODS.sourceControlLookupRepository>;
  }
}
export const mateRepositoryFamily: FamilySpec<"mateRepository"> = {
  family: "mateRepository",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-repository",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

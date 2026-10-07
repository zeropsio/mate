/** A demanded refs answer from the Mate; source values stay in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateVcsRefs: EnvironmentRpcSuccess<typeof WS_METHODS.vcsListRefs>;
  }
}
export const mateVcsRefsFamily: FamilySpec<"mateVcsRefs"> = {
  family: "mateVcsRefs",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-refs",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

/** A demanded reviewFile answer from the Mate; source values stay in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateReviewFile: EnvironmentRpcSuccess<typeof WS_METHODS.reviewGetDiffFileContents>;
  }
}
export const mateReviewFileFamily: FamilySpec<"mateReviewFile"> = {
  family: "mateReviewFile",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-reviewFile",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

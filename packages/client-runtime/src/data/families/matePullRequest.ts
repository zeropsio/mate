/** A demanded pullRequest answer from the Mate; source values stay in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly matePullRequest: EnvironmentRpcSuccess<typeof WS_METHODS.gitResolvePullRequest>;
  }
}
export const matePullRequestFamily: FamilySpec<"matePullRequest"> = {
  family: "matePullRequest",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-pullRequest",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

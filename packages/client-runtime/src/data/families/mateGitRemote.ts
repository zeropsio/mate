/** The Mate's demanded gitRemote answer; retained only in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateGitRemote: EnvironmentRpcSuccess<typeof WS_METHODS.zeropsGitProbeRemote>;
  }
}
export const mateGitRemoteFamily: FamilySpec<"mateGitRemote"> = {
  family: "mateGitRemote",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-gitRemote",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

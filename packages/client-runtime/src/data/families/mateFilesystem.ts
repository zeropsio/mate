/** A demanded filesystem answer from the Mate; source values stay in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateFilesystem: EnvironmentRpcSuccess<typeof WS_METHODS.filesystemBrowse>;
  }
}
export const mateFilesystemFamily: FamilySpec<"mateFilesystem"> = {
  family: "mateFilesystem",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-filesystem",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

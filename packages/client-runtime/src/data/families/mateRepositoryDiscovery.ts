/** The Mate's demanded repositoryDiscovery answer; retained only in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateRepositoryDiscovery: EnvironmentRpcSuccess<
      typeof WS_METHODS.serverDiscoverSourceControl
    >;
  }
}
export const mateRepositoryDiscoveryFamily: FamilySpec<"mateRepositoryDiscovery"> = {
  family: "mateRepositoryDiscovery",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-repositoryDiscovery",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

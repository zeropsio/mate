/** A demanded assetUrl answer from the Mate; source values stay in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateAssetUrl: EnvironmentRpcSuccess<typeof WS_METHODS.assetsCreateUrl> & {
      readonly expired?: true;
    };
  }
}
export const mateAssetUrlFamily: FamilySpec<"mateAssetUrl"> = {
  family: "mateAssetUrl",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-assetUrl",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

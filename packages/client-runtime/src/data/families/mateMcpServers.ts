/** A demanded mcp answer from the Mate; source values stay in account memory. */
import { WS_METHODS } from "@t3tools/contracts";
import type { EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { FamilySpec } from "./spec.ts";
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateMcpServers: EnvironmentRpcSuccess<typeof WS_METHODS.mcpServersList>;
  }
}
export const mateMcpServersFamily: FamilySpec<"mateMcpServers"> = {
  family: "mateMcpServers",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "workspace-mcp",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};

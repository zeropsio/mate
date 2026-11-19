// The MCP tab's methods (`zerops/mcp/McpServers.ts`).
import { McpServersError, WS_METHODS, type WsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import type { RpcAdmit } from "../../RpcUpdateAdmission.ts";
import type { McpServers } from "./McpServers.ts";

type McpRpcTag =
  | typeof WS_METHODS.mcpServersList
  | typeof WS_METHODS.mcpServersAdd
  | typeof WS_METHODS.mcpServersRemove
  | typeof WS_METHODS.mcpServersSetEnabled
  | typeof WS_METHODS.mcpServersReconnect
  | typeof WS_METHODS.mcpServersSignIn
  | typeof WS_METHODS.mcpServersUpdate
  | typeof WS_METHODS.mcpServersSignOut
  | typeof WS_METHODS.mcpServersFinishSignIn;

type McpRpc = Extract<RpcGroup.Rpcs<typeof WsRpcGroup>, { readonly _tag: McpRpcTag }>;

type McpRpcHandlers = {
  readonly [Current in McpRpc as Rpc.Tag<Current>]: Rpc.ToHandlerFn<Current, never>;
};

interface RegisterMcpRpcDeps {
  readonly mcpServers: Option.Option<McpServers["Service"]>;
  readonly admit: RpcAdmit;
}

export const registerMcpRpc = ({ mcpServers, admit }: RegisterMcpRpcDeps) => {
  const withMcpServers = <A>(
    operation: string,
    run: (service: McpServers["Service"]) => Effect.Effect<A, McpServersError>,
  ) =>
    Option.isSome(mcpServers)
      ? run(mcpServers.value)
      : Effect.fail(
          new McpServersError({ operation, detail: "MCP servers can't be managed here." }),
        );

  return {
    [WS_METHODS.mcpServersList]: (input) =>
      withMcpServers(WS_METHODS.mcpServersList, (mcp) => mcp.list(input)),
    [WS_METHODS.mcpServersAdd]: (input) =>
      admit(
        WS_METHODS.mcpServersAdd,
        withMcpServers(WS_METHODS.mcpServersAdd, (mcp) => mcp.add(input)),
      ),
    [WS_METHODS.mcpServersRemove]: (input) =>
      admit(
        WS_METHODS.mcpServersRemove,
        withMcpServers(WS_METHODS.mcpServersRemove, (mcp) => mcp.remove(input)),
      ),
    [WS_METHODS.mcpServersSetEnabled]: (input) =>
      admit(
        WS_METHODS.mcpServersSetEnabled,
        withMcpServers(WS_METHODS.mcpServersSetEnabled, (mcp) => mcp.setEnabled(input)),
      ),
    [WS_METHODS.mcpServersReconnect]: (input) =>
      admit(
        WS_METHODS.mcpServersReconnect,
        withMcpServers(WS_METHODS.mcpServersReconnect, (mcp) => mcp.reconnect(input)),
      ),
    [WS_METHODS.mcpServersSignIn]: (input) =>
      admit(
        WS_METHODS.mcpServersSignIn,
        withMcpServers(WS_METHODS.mcpServersSignIn, (mcp) => mcp.signIn(input)),
      ),
    [WS_METHODS.mcpServersUpdate]: (input) =>
      admit(
        WS_METHODS.mcpServersUpdate,
        withMcpServers(WS_METHODS.mcpServersUpdate, (mcp) => mcp.update(input)),
      ),
    [WS_METHODS.mcpServersSignOut]: (input) =>
      admit(
        WS_METHODS.mcpServersSignOut,
        withMcpServers(WS_METHODS.mcpServersSignOut, (mcp) => mcp.signOut(input)),
      ),
    [WS_METHODS.mcpServersFinishSignIn]: (input) =>
      admit(
        WS_METHODS.mcpServersFinishSignIn,
        withMcpServers(WS_METHODS.mcpServersFinishSignIn, (mcp) => mcp.finishSignIn(input)),
      ),
  } satisfies McpRpcHandlers;
};

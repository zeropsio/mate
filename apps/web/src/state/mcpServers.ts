import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

/** The MCP tab's five calls; each answers the Mate's fresh `McpServersList`. */
export const mcpServersEnvironment = {
  list: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-command:mcp:servers:list",
    tag: WS_METHODS.mcpServersList,
  }),
  add: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-command:mcp:servers:add",
    tag: WS_METHODS.mcpServersAdd,
  }),
  remove: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-command:mcp:servers:remove",
    tag: WS_METHODS.mcpServersRemove,
  }),
  setEnabled: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-command:mcp:servers:set-enabled",
    tag: WS_METHODS.mcpServersSetEnabled,
  }),
  reconnect: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-command:mcp:servers:reconnect",
    tag: WS_METHODS.mcpServersReconnect,
  }),
};

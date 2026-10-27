import { workspaceQuery, workspaceCommand } from "./workspace";
export const mcpServersEnvironment = {
  list: workspaceQuery("mcp"),
  add: workspaceCommand("mate-mcp-add"),
  remove: workspaceCommand("mate-mcp-remove"),
  setEnabled: workspaceCommand("mate-mcp-set-enabled"),
  reconnect: workspaceCommand("mate-mcp-reconnect"),
};

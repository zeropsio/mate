import { workspaceQuery, workspaceCommand } from "./workspace";
export const mcpServersEnvironment = {
  list: workspaceQuery("mcp"),
  add: workspaceCommand("mate-mcp-add"),
  remove: workspaceCommand("mate-mcp-remove"),
  setEnabled: workspaceCommand("mate-mcp-set-enabled"),
  reconnect: workspaceCommand("mate-mcp-reconnect"),
  signIn: workspaceCommand("mate-mcp-sign-in"),
  finishSignIn: workspaceCommand("mate-mcp-finish-sign-in"),
  signOut: workspaceCommand("mate-mcp-sign-out"),
  update: workspaceCommand("mate-mcp-update"),
};

import { workspaceQuery } from "./workspace";
export const orchestrationEnvironment = {
  turnDiff: workspaceQuery("turnDiff"),
  workflowScript: workspaceQuery("workflowScript"),
  fullThreadDiff: workspaceQuery("fullThreadDiff"),
  threadSearch: workspaceQuery("threadSearch"),
};

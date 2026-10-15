import { workspaceQuery } from "./workspace";
export const orchestrationEnvironment = {
  turnDiff: workspaceQuery("turnDiff"),
  workflowScript: workspaceQuery("workflowScript"),
  fullThreadDiff: workspaceQuery("fullThreadDiff"),
  runChanges: workspaceQuery("runChanges"),
  threadSearch: workspaceQuery("threadSearch"),
};

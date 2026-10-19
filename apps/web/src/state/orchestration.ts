import { workspaceQuery } from "./workspace";
export const orchestrationEnvironment = {
  workflowScript: workspaceQuery("workflowScript"),
  threadSearch: workspaceQuery("threadSearch"),
};

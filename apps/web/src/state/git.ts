import { workspaceQuery, workspaceCommand } from "./workspace";
export const gitEnvironment = {
  pullRequestResolution: workspaceQuery("pullRequest"),
  preparePullRequestThread: workspaceCommand("mate-prepare-pull-request-thread"),
};

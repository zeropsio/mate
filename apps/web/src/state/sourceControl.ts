import { workspaceQuery, workspaceCommand } from "./workspace";

export const sourceControlEnvironment = {
  discovery: workspaceQuery("repositoryDiscovery"),
  publishRepository: workspaceCommand("mate-publish-repository"),
};

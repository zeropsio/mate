import { Atom } from "effect/unstable/reactivity";
import { workspaceQuery, workspaceCommand } from "./workspace";
import { mateFeedAsyncAtom } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
const projectClones = Atom.family((environmentId: EnvironmentId) =>
  mateFeedAsyncAtom({ family: "mateProjectClone", environmentId, input: {} }),
);
export const sourceControlEnvironment = {
  discovery: workspaceQuery("repositoryDiscovery"),
  repository: workspaceQuery("repository"),
  cloneRepository: workspaceCommand("mate-clone-repository"),
  startProjectClone: workspaceCommand("mate-project-clone-start"),
  cancelProjectClone: workspaceCommand("mate-project-clone-cancel"),
  retryProjectClone: workspaceCommand("mate-project-clone-retry"),
  publishRepository: workspaceCommand("mate-publish-repository"),
  projectClones: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: Record<string, never>;
  }) => projectClones(target.environmentId),
};

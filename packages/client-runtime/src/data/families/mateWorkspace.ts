/** The reviewed Mate workspace reads: distinct source identities and fact families. */
import { ORCHESTRATION_WS_METHODS, WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentRpcInput, EnvironmentRpcSuccess } from "../../rpc/client.ts";
import type { ScopeKey } from "../model.ts";
export const WORKSPACE_READS = {
  gitRemote: {
    family: "mateGitRemote",
    tag: WS_METHODS.zeropsGitProbeRemote,
    suffix: "workspace-gitRemote",
  },
  repositoryDiscovery: {
    family: "mateRepositoryDiscovery",
    tag: WS_METHODS.serverDiscoverSourceControl,
    suffix: "workspace-repositoryDiscovery",
  },
  repository: {
    family: "mateRepository",
    tag: WS_METHODS.sourceControlLookupRepository,
    suffix: "workspace-repository",
  },
  threadSearch: {
    family: "mateThreadSearch",
    tag: ORCHESTRATION_WS_METHODS.searchThreads,
    suffix: "workspace-threadSearch",
  },
  turnDiff: {
    family: "mateTurnDiff",
    tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
    suffix: "workspace-turnDiff",
  },
  fullThreadDiff: {
    family: "mateThreadDiff",
    tag: ORCHESTRATION_WS_METHODS.getFullThreadDiff,
    suffix: "workspace-fullThreadDiff",
  },
  workflowScript: {
    family: "mateWorkflowScript",
    tag: ORCHESTRATION_WS_METHODS.getWorkflowScript,
    suffix: "workspace-workflowScript",
  },
  traceDiagnostics: {
    family: "mateTraceDiagnostics",
    tag: WS_METHODS.serverGetTraceDiagnostics,
    suffix: "workspace-traceDiagnostics",
  },
  processDiagnostics: {
    family: "mateProcessDiagnostics",
    tag: WS_METHODS.serverGetProcessDiagnostics,
    suffix: "workspace-processDiagnostics",
  },
  processResourceHistory: {
    family: "mateProcessResourceHistory",
    tag: WS_METHODS.serverGetProcessResourceHistory,
    suffix: "workspace-processResourceHistory",
  },
  resourceTelemetryHistory: {
    family: "mateResourceTelemetryHistory",
    tag: WS_METHODS.serverGetResourceTelemetryHistory,
    suffix: "workspace-resourceTelemetryHistory",
  },

  assetUrl: {
    family: "mateAssetUrl",
    tag: WS_METHODS.assetsCreateUrl,
    suffix: "workspace-assetUrl",
  },
  filesystem: {
    family: "mateFilesystem",
    tag: WS_METHODS.filesystemBrowse,
    suffix: "workspace-filesystem",
  },
  pullRequest: {
    family: "matePullRequest",
    tag: WS_METHODS.gitResolvePullRequest,
    suffix: "workspace-pullRequest",
  },
  reviewPreview: {
    family: "mateReview",
    tag: WS_METHODS.reviewGetDiffPreview,
    suffix: "workspace-reviewPreview",
  },
  reviewFile: {
    family: "mateReviewFile",
    tag: WS_METHODS.reviewGetDiffFileContents,
    suffix: "workspace-reviewFile",
  },
  file: { family: "mateWorkspaceFile", tag: WS_METHODS.projectsReadFile, suffix: "workspace-file" },
  entries: {
    family: "mateWorkspaceEntries",
    tag: WS_METHODS.projectsListEntries,
    suffix: "workspace-entries",
  },
  paths: {
    family: "mateWorkspacePaths",
    tag: WS_METHODS.projectsSearchEntries,
    suffix: "workspace-paths",
  },
  contents: {
    family: "mateWorkspaceContents",
    tag: WS_METHODS.projectsSearchContents,
    suffix: "workspace-contents",
  },
  mcp: { family: "mateMcpServers", tag: WS_METHODS.mcpServersList, suffix: "workspace-mcp" },
  refs: { family: "mateVcsRefs", tag: WS_METHODS.vcsListRefs, suffix: "workspace-refs" },
} as const;
export type WorkspaceRead = keyof typeof WORKSPACE_READS;
export type WorkspaceTarget<K extends WorkspaceRead> = {
  readonly environmentId: EnvironmentId;
  readonly input: EnvironmentRpcInput<(typeof WORKSPACE_READS)[K]["tag"]>;
};
export type WorkspaceValue<K extends WorkspaceRead> = EnvironmentRpcSuccess<
  (typeof WORKSPACE_READS)[K]["tag"]
>;
export const workspaceId = <K extends WorkspaceRead>(target: WorkspaceTarget<K>): string =>
  JSON.stringify([target.environmentId, target.input]);
export const workspaceScope = <K extends WorkspaceRead>(
  kind: K,
  target: WorkspaceTarget<K>,
): ScopeKey =>
  `mate:${encodeURIComponent(target.environmentId)}:${WORKSPACE_READS[kind].suffix}:${encodeURIComponent(workspaceId(target))}`;

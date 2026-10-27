import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import { buildProjectGroups, type ProjectGroupingSettings } from "./logicalProject";
import type { Project } from "./types";

export type EnvironmentPresence = "local-only" | "remote-only" | "mixed";

export interface SidebarProjectGroupMember extends Project {
  physicalProjectKey: string;
  environmentLabel: string | null;
}

export interface SidebarProjectSnapshot extends Project {
  projectKey: string;
  displayName: string;
  groupedProjectCount: number;
  environmentPresence: EnvironmentPresence;
  memberProjects: readonly SidebarProjectGroupMember[];
  memberProjectRefs: readonly ScopedProjectRef[];
  remoteEnvironmentLabels: readonly string[];
}

export interface SidebarProjectPickerEntry {
  group: SidebarProjectSnapshot;
  targetProject: SidebarProjectGroupMember;
  isPreferred: boolean;
}

interface SidebarProjectThreadBranchSource {
  readonly projectKey: string;
  readonly displayName: string;
  readonly memberProjects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string | null;
    readonly workspaceRoot: string;
    readonly title: string;
  }>;
}

interface SidebarThreadBranchSource {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

export interface SidebarProjectThreadMember<TThread extends SidebarThreadBranchSource> {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly displayName: string;
  readonly workspaceLabel: string;
  readonly threads: ReadonlyArray<TThread>;
}

export interface SidebarProjectThreadBranch<TThread extends SidebarThreadBranchSource> {
  readonly key: string;
  readonly displayName: string;
  readonly members: ReadonlyArray<SidebarProjectThreadMember<TThread>>;
}

function nonEmptyLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function workspaceBasename(workspaceRoot: string): string | null {
  const normalized = workspaceRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  return nonEmptyLabel(normalized.split("/").at(-1));
}

/**
 * Builds only the hierarchy that the shell can prove. Platform project names
 * are an optional presentation input; absent one, the environment descriptor
 * label remains authoritative and the workspace basename is the final
 * truthful fallback.
 */
export function buildSidebarProjectThreadBranches<
  TThread extends SidebarThreadBranchSource,
>(input: {
  readonly projectGroups: ReadonlyArray<SidebarProjectThreadBranchSource>;
  readonly threads: ReadonlyArray<TThread>;
  readonly zeropsProjectNameByEnvironment?: ReadonlyMap<EnvironmentId, string>;
}): ReadonlyArray<SidebarProjectThreadBranch<TThread>> {
  const threadsByProject = new Map<string, TThread[]>();
  for (const thread of input.threads) {
    const key = `${thread.environmentId}:${thread.projectId}`;
    const existing = threadsByProject.get(key);
    if (existing) {
      existing.push(thread);
    } else {
      threadsByProject.set(key, [thread]);
    }
  }

  return input.projectGroups.map((group) => ({
    key: group.projectKey,
    displayName: group.displayName,
    members: group.memberProjects.map((member) => {
      const key = `${member.environmentId}:${member.id}`;
      const workspaceLabel = workspaceBasename(member.workspaceRoot) ?? member.title;
      const displayName =
        nonEmptyLabel(input.zeropsProjectNameByEnvironment?.get(member.environmentId)) ??
        nonEmptyLabel(member.environmentLabel) ??
        nonEmptyLabel(workspaceLabel) ??
        member.title;
      return {
        key,
        environmentId: member.environmentId,
        projectId: member.id,
        displayName,
        workspaceLabel,
        threads: threadsByProject.get(key) ?? [],
      };
    }),
  }));
}

export function buildPhysicalToLogicalProjectKeyMap(input: {
  projects: ReadonlyArray<Project>;
  settings: ProjectGroupingSettings;
  primaryEnvironmentId: EnvironmentId | null;
}): Map<string, string> {
  const mapping = new Map<string, string>();
  const groups = buildProjectGroups({
    projects: input.projects,
    settings: input.settings,
    preferredEnvironmentId: input.primaryEnvironmentId,
  });
  for (const group of groups) {
    for (const member of group.members) {
      mapping.set(member.physicalProjectKey, group.key);
    }
  }
  return mapping;
}

export function buildSidebarProjectSnapshots(input: {
  projects: ReadonlyArray<Project>;
  settings: ProjectGroupingSettings;
  primaryEnvironmentId: EnvironmentId | null;
  resolveEnvironmentLabel: (environmentId: EnvironmentId) => string | null;
}): SidebarProjectSnapshot[] {
  return buildProjectGroups({
    projects: input.projects,
    settings: input.settings,
    preferredEnvironmentId: input.primaryEnvironmentId,
  }).map((group): SidebarProjectSnapshot => {
    const members = group.members.map(
      ({ physicalProjectKey, project }): SidebarProjectGroupMember => ({
        ...project,
        physicalProjectKey,
        environmentLabel: input.resolveEnvironmentLabel(project.environmentId),
      }),
    );
    const representative =
      members.find(
        (member) =>
          member.environmentId === group.representative.environmentId &&
          member.id === group.representative.id,
      ) ?? members[0]!;

    const hasLocal =
      input.primaryEnvironmentId !== null &&
      members.some((member) => member.environmentId === input.primaryEnvironmentId);
    const hasRemote =
      input.primaryEnvironmentId !== null
        ? members.some((member) => member.environmentId !== input.primaryEnvironmentId)
        : false;
    const remoteMembers = members.filter(
      (member) =>
        input.primaryEnvironmentId !== null && member.environmentId !== input.primaryEnvironmentId,
    );
    const remoteEnvironmentLabels = remoteMembers
      .flatMap((member) => (member.environmentLabel ? [member.environmentLabel] : []))
      .filter((label, index, labels) => labels.indexOf(label) === index);

    return {
      ...representative,
      projectKey: group.key,
      displayName: group.label,
      groupedProjectCount: members.length,
      environmentPresence:
        hasLocal && hasRemote ? "mixed" : hasRemote ? "remote-only" : "local-only",
      memberProjects: members,
      memberProjectRefs: group.memberProjectRefs,
      remoteEnvironmentLabels,
    };
  });
}

export function buildSidebarProjectPickerEntries(input: {
  groups: ReadonlyArray<SidebarProjectSnapshot>;
  preferredProjectRef: ScopedProjectRef | null;
}) {
  const entries = input.groups.flatMap((group): SidebarProjectPickerEntry[] => {
    const isPreferred = input.preferredProjectRef
      ? group.memberProjectRefs.some(
          (projectRef) =>
            projectRef.environmentId === input.preferredProjectRef?.environmentId &&
            projectRef.projectId === input.preferredProjectRef.projectId,
        )
      : false;
    const preferredProject = isPreferred
      ? (group.memberProjects.find(
          (project) =>
            project.environmentId === input.preferredProjectRef?.environmentId &&
            project.id === input.preferredProjectRef?.projectId,
        ) ??
        group.memberProjects.find(
          (project) => project.environmentId === input.preferredProjectRef?.environmentId,
        ))
      : null;
    const targetProject =
      preferredProject ??
      group.memberProjects.find(
        (project) => project.environmentId === group.environmentId && project.id === group.id,
      ) ??
      group.memberProjects[0];
    if (!targetProject) return [];

    return [{ group, targetProject, isPreferred }];
  });
  const preferredIndex = entries.findIndex((entry) => entry.isPreferred);
  if (preferredIndex <= 0) return entries;

  return [
    entries[preferredIndex]!,
    ...entries.slice(0, preferredIndex),
    ...entries.slice(preferredIndex + 1),
  ];
}

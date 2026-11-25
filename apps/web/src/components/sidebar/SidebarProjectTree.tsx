import { ChevronDownIcon, FolderIcon, ServerIcon } from "lucide-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
import type { ReactNode } from "react";

import type {
  SidebarProjectThreadBranch,
  SidebarProjectThreadMember,
} from "../../sidebarProjectGrouping";
import { useZeropsTopology } from "../../zerops/useZeropsFeeds";
import { Button } from "../ui/button";

interface SidebarProjectTreeThread {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

interface SidebarProjectTreeProps<TThread extends SidebarProjectTreeThread> {
  readonly branches: ReadonlyArray<SidebarProjectThreadBranch<TThread>>;
  /** Non-null switches to the intentionally flat search presentation. */
  readonly searchResults: ReadonlyArray<TThread> | null;
  readonly activeThreadKey: string | null;
  readonly collapsedProjectKeys: ReadonlySet<string>;
  readonly collapsedMemberKeys: ReadonlySet<string>;
  readonly getThreadKey: (thread: TThread) => string;
  readonly onToggleProject: (projectKey: string) => void;
  readonly onToggleMember: (memberKey: string) => void;
  /** Selects at most one existing thread to present as the workspace shortcut. */
  readonly getCompactThreadShortcut?: (threads: ReadonlyArray<TThread>) => TThread | null;
  /** Renders the persistent workspace-level new-thread action. */
  readonly renderWorkspaceThreadAction?: (input: {
    readonly compactThread: TThread | null;
    readonly member: SidebarProjectThreadMember<TThread>;
    readonly workspaceName: string;
  }) => ReactNode;
  readonly renderThread: (thread: TThread) => ReactNode;
  readonly renderSearchResult?: (thread: TThread, index: number) => ReactNode;
}

const GENERIC_ZEROPS_PROJECTS_KEY = "sidebar:generic-zerops-projects";

export function SidebarProjectTree<TThread extends SidebarProjectTreeThread>(
  props: SidebarProjectTreeProps<TThread>,
) {
  if (props.searchResults !== null) {
    return (
      <ul
        id="sidebar-thread-search-results"
        role="listbox"
        aria-label="Thread search results"
        className="flex flex-col gap-px"
      >
        {props.searchResults.map(
          (thread, index) =>
            props.renderSearchResult?.(thread, index) ?? props.renderThread(thread),
        )}
      </ul>
    );
  }

  const members = props.branches.flatMap((project) => project.members);

  return (
    <li className="list-none">
      <ul role="list" aria-label="Projects and threads" className="flex flex-col gap-1">
        <SidebarProjectTopologyMembers
          projects={props.branches}
          members={members}
          memberIndex={0}
          topologyByMember={new Map()}
          treeProps={props}
        />
      </ul>
    </li>
  );
}

function SidebarProjectMemberTopology(props: {
  readonly environmentId: EnvironmentId;
  readonly children: (topology: ZeropsTopologyView | undefined) => ReactNode;
}) {
  return props.children(useZeropsTopology(props.environmentId));
}

function SidebarProjectTopologyMembers<TThread extends SidebarProjectTreeThread>(props: {
  readonly projects: ReadonlyArray<SidebarProjectThreadBranch<TThread>>;
  readonly members: ReadonlyArray<SidebarProjectThreadBranch<TThread>["members"][number]>;
  readonly memberIndex: number;
  readonly topologyByMember: ReadonlyMap<string, ZeropsTopologyView | undefined>;
  readonly treeProps: SidebarProjectTreeProps<TThread>;
}): ReactNode {
  const member = props.members[props.memberIndex];
  if (member === undefined) {
    const projects = coalesceGenericZeropsProjects(props.projects, props.topologyByMember);
    return projects.map((project) => (
      <SidebarProjectBranch
        key={project.key}
        project={project}
        topologyByMember={props.topologyByMember}
        treeProps={props.treeProps}
      />
    ));
  }

  return (
    <SidebarProjectMemberTopology environmentId={member.environmentId}>
      {(topology) => {
        const nextTopologyByMember = new Map(props.topologyByMember);
        nextTopologyByMember.set(member.key, topology);
        return (
          <SidebarProjectTopologyMembers
            projects={props.projects}
            members={props.members}
            memberIndex={props.memberIndex + 1}
            topologyByMember={nextTopologyByMember}
            treeProps={props.treeProps}
          />
        );
      }}
    </SidebarProjectMemberTopology>
  );
}

function nonEmptyLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isGenericWorkspaceLabel(label: string): boolean {
  return label.trim().toLowerCase() === "www";
}

function hasAvailableZeropsTopology<TThread extends SidebarProjectTreeThread>(
  project: SidebarProjectThreadBranch<TThread>,
  topologyByMember: ReadonlyMap<string, ZeropsTopologyView | undefined>,
): boolean {
  return project.members.some((member) => topologyByMember.get(member.key) !== undefined);
}

function coalesceGenericZeropsProjects<TThread extends SidebarProjectTreeThread>(
  projects: ReadonlyArray<SidebarProjectThreadBranch<TThread>>,
  topologyByMember: ReadonlyMap<string, ZeropsTopologyView | undefined>,
): ReadonlyArray<SidebarProjectThreadBranch<TThread>> {
  const genericProjects = projects.filter(
    (project) =>
      isGenericWorkspaceLabel(project.displayName) &&
      hasAvailableZeropsTopology(project, topologyByMember),
  );
  if (genericProjects.length < 2) return projects;

  const firstGenericProject = genericProjects[0];
  return projects.flatMap((project) => {
    if (!genericProjects.includes(project)) return [project];
    if (project !== firstGenericProject) return [];
    return [
      {
        key: GENERIC_ZEROPS_PROJECTS_KEY,
        displayName: project.displayName,
        members: genericProjects.flatMap((genericProject) => genericProject.members),
      },
    ];
  });
}

function SidebarProjectBranch<TThread extends SidebarProjectTreeThread>(props: {
  readonly project: SidebarProjectThreadBranch<TThread>;
  readonly topologyByMember: ReadonlyMap<string, ZeropsTopologyView | undefined>;
  readonly treeProps: SidebarProjectTreeProps<TThread>;
}) {
  const { project, topologyByMember, treeProps } = props;
  const containsActiveThread = project.members.some((member) =>
    member.threads.some((thread) => treeProps.getThreadKey(thread) === treeProps.activeThreadKey),
  );
  const projectExpanded = containsActiveThread || !treeProps.collapsedProjectKeys.has(project.key);
  const hasZeropsTopology = hasAvailableZeropsTopology(project, topologyByMember);
  const projectDisplayName =
    hasZeropsTopology && isGenericWorkspaceLabel(project.displayName)
      ? "Projects"
      : project.displayName;

  return (
    <li className="list-none">
      <Button
        variant="sidebar"
        className="group w-full justify-start"
        aria-expanded={projectExpanded}
        aria-label={`${projectExpanded ? "Collapse" : "Expand"} project ${projectDisplayName}`}
        onClick={() => treeProps.onToggleProject(project.key)}
      >
        <ChevronDownIcon
          aria-hidden
          className={`size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform ${
            projectExpanded ? "" : "-rotate-90"
          }`}
        />
        <FolderIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-start text-body font-semibold text-sidebar-foreground">
          {projectDisplayName}
        </span>
        <span className="shrink-0 text-2xs tabular-nums text-sidebar-muted-foreground">
          {project.members.length} {project.members.length === 1 ? "workspace" : "workspaces"}
        </span>
      </Button>

      {projectExpanded ? (
        <ul role="list" className="ml-3 border-l border-sidebar-border/70 pl-2">
          {project.members.map((member) => {
            const topology = topologyByMember.get(member.key);
            const topologyProjectName =
              topology === undefined ? null : nonEmptyLabel(topology.project.name);
            const memberDisplayName = topologyProjectName ?? member.displayName;
            const memberContainsActiveThread = member.threads.some(
              (thread) => treeProps.getThreadKey(thread) === treeProps.activeThreadKey,
            );
            const memberExpanded =
              memberContainsActiveThread || !treeProps.collapsedMemberKeys.has(member.key);
            const workspaceIsDistinct =
              member.workspaceLabel !== memberDisplayName &&
              (topologyProjectName === null || !isGenericWorkspaceLabel(member.workspaceLabel));
            const meta =
              topology === undefined
                ? `${member.threads.length} ${member.threads.length === 1 ? "thread" : "threads"}`
                : `${topology.services.length} ${topology.services.length === 1 ? "service" : "services"} · zcp`;
            const compactThread =
              treeProps.renderWorkspaceThreadAction === undefined
                ? null
                : (treeProps.getCompactThreadShortcut?.(member.threads) ?? null);
            const visibleThreads =
              compactThread === null
                ? member.threads
                : member.threads.filter((thread) => thread !== compactThread);

            return (
              <li key={member.key} className="list-none">
                <div className="group flex min-h-8 w-full items-center rounded-control text-sidebar-foreground">
                  <Button
                    variant="sidebar"
                    className="min-w-0 flex-1 justify-start"
                    aria-expanded={memberExpanded}
                    aria-label={`${memberExpanded ? "Collapse" : "Expand"} workspace ${memberDisplayName}`}
                    onClick={() => treeProps.onToggleMember(member.key)}
                  >
                    <ChevronDownIcon
                      aria-hidden
                      className={`size-3 shrink-0 text-sidebar-muted-foreground transition-transform ${
                        memberExpanded ? "" : "-rotate-90"
                      }`}
                    />
                    <ServerIcon
                      aria-hidden
                      className="size-3.5 shrink-0 text-sidebar-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 text-start">
                      <span className="block truncate text-body font-medium text-sidebar-foreground">
                        {memberDisplayName}
                      </span>
                      {workspaceIsDistinct ? (
                        <span className="block truncate text-3xs text-sidebar-muted-foreground">
                          {member.workspaceLabel}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-2xs tabular-nums text-sidebar-muted-foreground">
                      {meta}
                    </span>
                  </Button>
                  {treeProps.renderWorkspaceThreadAction?.({
                    compactThread,
                    member,
                    workspaceName: memberDisplayName,
                  })}
                </div>

                {memberExpanded && visibleThreads.length > 0 ? (
                  <ul role="list" className="ml-2 border-l border-sidebar-border/50 pl-1">
                    {visibleThreads.map(treeProps.renderThread)}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

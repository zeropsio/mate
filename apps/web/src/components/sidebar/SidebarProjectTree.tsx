import { ChevronDownIcon, FolderIcon, ServerIcon } from "lucide-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ReactNode } from "react";

import type { SidebarProjectThreadBranch } from "../../sidebarProjectGrouping";

interface SidebarProjectTreeThread {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

export function SidebarProjectTree<TThread extends SidebarProjectTreeThread>(props: {
  readonly branches: ReadonlyArray<SidebarProjectThreadBranch<TThread>>;
  /** Non-null switches to the intentionally flat search presentation. */
  readonly searchResults: ReadonlyArray<TThread> | null;
  readonly activeThreadKey: string | null;
  readonly collapsedProjectKeys: ReadonlySet<string>;
  readonly collapsedMemberKeys: ReadonlySet<string>;
  readonly getThreadKey: (thread: TThread) => string;
  readonly onToggleProject: (projectKey: string) => void;
  readonly onToggleMember: (memberKey: string) => void;
  readonly renderThread: (thread: TThread) => ReactNode;
  readonly renderSearchResult?: (thread: TThread, index: number) => ReactNode;
}) {
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

  return (
    <li className="list-none">
      <ul role="list" aria-label="Projects and threads" className="flex flex-col gap-1">
        {props.branches.map((project) => {
          const containsActiveThread = project.members.some((member) =>
            member.threads.some((thread) => props.getThreadKey(thread) === props.activeThreadKey),
          );
          const projectExpanded =
            containsActiveThread || !props.collapsedProjectKeys.has(project.key);
          return (
            <li key={project.key} className="list-none">
              <button
                type="button"
                aria-expanded={projectExpanded}
                aria-label={`${projectExpanded ? "Collapse" : "Expand"} project ${project.displayName}`}
                onClick={() => props.onToggleProject(project.key)}
                className="group flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDownIcon
                  aria-hidden
                  className={`size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform ${
                    projectExpanded ? "" : "-rotate-90"
                  }`}
                />
                <FolderIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {project.displayName}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-sidebar-muted-foreground">
                  {project.members.length}{" "}
                  {project.members.length === 1 ? "workspace" : "workspaces"}
                </span>
              </button>

              {projectExpanded ? (
                <ul role="list" className="ml-3 border-l border-sidebar-border/70 pl-2">
                  {project.members.map((member) => {
                    const memberContainsActiveThread = member.threads.some(
                      (thread) => props.getThreadKey(thread) === props.activeThreadKey,
                    );
                    const memberExpanded =
                      memberContainsActiveThread || !props.collapsedMemberKeys.has(member.key);
                    const workspaceIsDistinct = member.workspaceLabel !== member.displayName;

                    return (
                      <li key={member.key} className="list-none">
                        <button
                          type="button"
                          aria-expanded={memberExpanded}
                          aria-label={`${memberExpanded ? "Collapse" : "Expand"} workspace ${member.displayName}`}
                          onClick={() => props.onToggleMember(member.key)}
                          className="group flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
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
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {member.displayName}
                            </span>
                            {workspaceIsDistinct ? (
                              <span className="block truncate text-[10px] text-sidebar-muted-foreground">
                                {member.workspaceLabel}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-sidebar-muted-foreground">
                            {member.threads.length}{" "}
                            {member.threads.length === 1 ? "thread" : "threads"}
                          </span>
                        </button>

                        {memberExpanded && member.threads.length > 0 ? (
                          <ul role="list" className="ml-2 border-l border-sidebar-border/50 pl-1">
                            {member.threads.map(props.renderThread)}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

import type { EnvironmentId } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { ProjectFavicon } from "./ProjectFavicon";
import { Button } from "./ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import { SidebarInput, SidebarMenuButton } from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function SidebarThreadSearchField({
  threadSearchInputRef,
  threadSearchQuery,
  setThreadSearchQuery,
  setActiveSearchResultIndex,
  handleThreadSearchKeyDown,
  isSearchingThreads,
  threadSearchResults,
  activeSearchResultIndex,
  threadSearch,
  clearThreadSearch,
}: {
  threadSearchInputRef: RefObject<HTMLInputElement | null>;
  threadSearchQuery: string;
  setThreadSearchQuery: (query: string) => void;
  setActiveSearchResultIndex: (index: number) => void;
  handleThreadSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearchingThreads: boolean;
  threadSearchResults: ReadonlyArray<unknown>;
  activeSearchResultIndex: number;
  threadSearch: { readonly isPending: boolean; readonly incomplete: boolean };
  clearThreadSearch: () => void;
}) {
  return (
    <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
      <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80" />
      <SidebarInput
        ref={threadSearchInputRef}
        nativeInput
        type="search"
        value={threadSearchQuery}
        onChange={(event) => {
          setThreadSearchQuery(event.currentTarget.value);
          setActiveSearchResultIndex(0);
        }}
        onKeyDown={handleThreadSearchKeyDown}
        placeholder="Search"
        aria-label="Search threads"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isSearchingThreads && threadSearchResults.length > 0}
        aria-controls={
          isSearchingThreads && threadSearchResults.length > 0
            ? "sidebar-thread-search-results"
            : undefined
        }
        aria-activedescendant={
          isSearchingThreads && threadSearchResults[activeSearchResultIndex]
            ? `sidebar-thread-search-result-${activeSearchResultIndex}`
            : undefined
        }
        className="min-w-0 flex-1"
      />
      {isSearchingThreads &&
      threadSearch.incomplete &&
      !threadSearch.isPending &&
      threadSearchResults.length > 0 ? (
        <p role="status" className="px-2 text-xs text-sidebar-muted-foreground">
          Some conversations could not be searched.
        </p>
      ) : null}
      {isSearchingThreads ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="shrink-0 text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
          aria-label="Clear thread search"
          onClick={() => {
            clearThreadSearch();
            threadSearchInputRef.current?.focus();
          }}
        >
          <XIcon className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

export function SidebarNewThreadButton({
  handleNewThreadClick,
  projects,
  projectGroups,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
}: {
  handleNewThreadClick: (event?: ReactMouseEvent) => void;
  projects: ReadonlyArray<unknown>;
  projectGroups: ReadonlyArray<unknown>;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null;
}) {
  return (
    <div className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              size="icon"
              type="button"
              className="relative focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
              onClick={handleNewThreadClick}
              disabled={projects.length === 0}
              aria-label="New thread"
            />
          }
        >
          <SquarePenIcon />
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
            aria-hidden="true"
          />
        </TooltipTrigger>
        <TooltipPopup side="right">
          {projectGroups.length > 1 ? (
            <span className="flex flex-col gap-0.5">
              <span>
                {newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"}
              </span>
              <span className="text-muted-foreground">
                New thread in current project: Shift+click
                {newThreadInProjectShortcutLabel ? ` (${newThreadInProjectShortcutLabel})` : ""}
              </span>
            </span>
          ) : newThreadShortcutLabel ? (
            `New thread (${newThreadShortcutLabel})`
          ) : (
            "New thread"
          )}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

export function SidebarProjectScopeRow({
  projectGroups,
  projectScopeMenuOpen,
  setProjectScopeMenuOpen,
  scopedProjectGroup,
  projectScopeKey,
  setProjectScopeKey,
  openAddProjectSourcePicker,
  handleProjectSettings,
  roleOffered,
  openNewZeropsProject,
}: {
  projectGroups: ReadonlyArray<SidebarProjectSnapshot>;
  projectScopeMenuOpen: boolean;
  setProjectScopeMenuOpen: (open: boolean) => void;
  scopedProjectGroup: SidebarProjectSnapshot | null;
  projectScopeKey: string | null;
  setProjectScopeKey: (projectKey: string | null) => void;
  openAddProjectSourcePicker: (environmentId: EnvironmentId) => void;
  handleProjectSettings: (
    event: ReactMouseEvent<HTMLButtonElement>,
    projectGroup: SidebarProjectSnapshot,
  ) => void;
  roleOffered: { readonly newProject: boolean };
  openNewZeropsProject: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Menu open={projectScopeMenuOpen} onOpenChange={setProjectScopeMenuOpen}>
        <MenuTrigger
          render={
            <SidebarMenuButton
              aria-label="Filter threads by project"
              className="min-w-0 flex-1 ps-[calc(var(--sidebar-row-content-inset)-1px)] focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            />
          }
        >
          {scopedProjectGroup ? (
            <ProjectFavicon
              environmentId={scopedProjectGroup.environmentId}
              cwd={scopedProjectGroup.workspaceRoot}
              faviconPath={scopedProjectGroup.faviconPath}
              className="size-4 shrink-0"
            />
          ) : (
            <FolderIcon className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {scopedProjectGroup?.displayName ?? "All projects"}
          </span>
          <ChevronDownIcon className="-mr-px size-4 shrink-0" />
        </MenuTrigger>
        <MenuPopup align="start" className="w-(--anchor-width)">
          <MenuRadioGroup
            value={projectScopeKey ?? "all"}
            onValueChange={(value) =>
              setProjectScopeKey(value === "all" ? null : (value as string))
            }
          >
            <MenuRadioItem
              value="all"
              closeOnClick
              className="h-8 min-h-8 py-0 text-sm font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
            >
              <FolderIcon className="size-4 shrink-0" />
              <span className="min-w-0 truncate text-sm">All projects</span>
            </MenuRadioItem>
            {projectGroups.map((project) => {
              const scopeKey = project.projectKey;
              return (
                <MenuRadioItem
                  key={scopeKey}
                  value={scopeKey}
                  closeOnClick
                  className="h-8 min-h-8 py-0 text-sm font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
                >
                  <ProjectFavicon
                    environmentId={project.environmentId}
                    cwd={project.workspaceRoot}
                    faviconPath={project.faviconPath}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 truncate text-sm">{project.displayName}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Add source to ${project.displayName}`}
                    title={`Add source to ${project.displayName}`}
                    className="ml-auto"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openAddProjectSourcePicker(project.environmentId);
                    }}
                  >
                    <GitBranchIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Project settings for ${project.displayName}`}
                    title={`Project settings for ${project.displayName}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      void handleProjectSettings(event, project);
                    }}
                  >
                    <SettingsIcon className="size-3.5" />
                  </Button>
                </MenuRadioItem>
              );
            })}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
      {roleOffered.newProject ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <SidebarMenuButton
                size="icon"
                className="relative shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                onClick={openNewZeropsProject}
                type="button"
                aria-label="New project"
              />
            }
          >
            <FolderPlusIcon />
            <span
              className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
              aria-hidden="true"
            />
          </TooltipTrigger>
          <TooltipPopup side="right">New project</TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}

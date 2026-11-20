"use client";

import { useRoleOffers } from "~/zerops/usePlatformCapabilities";

import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { type ClientSettings, EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ChartNoAxesColumnIcon,
  Drama as PersonaIcon,
  FileSearchIcon,
  FolderIcon,
  FolderPlusIcon,
  MessageSquareIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  ServerIcon,
  SettingsIcon,
  SquarePenIcon,
  SunIcon,
  TextSearchIcon,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useAtomValue } from "@effect/atom-react";

import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useClientSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { useCustomThemes } from "../hooks/useCustomThemes";
import { BUILT_IN_THEMES } from "@t3tools/shared/themePalettes";
import { getThemeDefinition } from "../themePalette";
import {
  STANDARD_THEME_CARDS,
  getThemeCardDefinition,
  ThemePreviewCircle,
} from "./settings/ThemePreviewCircles";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useServerConfigs,
  useThreadShells,
} from "../state/entities";
import { useRightPanelStore } from "../rightPanelStore";
import { zeropsMateAt } from "../zerops/mateIdentities";
import { zeropsMatesAtom } from "../zerops/useZeropsMates";
import { useThreadSearch } from "../state/queries";
import {
  shownHqListedMatesAtom,
  shownHqListNavigationAtom,
  shownHqMateDirectoryAtom,
  shownMateVisibilitiesAtom,
  isListedMateEnvironment,
} from "@t3tools/client-runtime/data";
import { useEnvironmentLinks } from "../routes/-environmentTargets";
import { resolveThreadActionProjectRef, startNewThreadFromContext } from "../lib/chatThreadActions";
import { COMMAND_PALETTE_ID, onOpenCommandPalette } from "../commandPaletteBus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { getLatestThreadForProject, sortThreads } from "../lib/threadSort";
import { cn } from "../lib/utils";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import {
  ADDON_ICON_CLASS,
  buildProjectActionItems,
  buildRootGroups,
  buildThreadActionItems,
  enumerateCommandPaletteItems,
  type CommandPaletteActionItem,
  type CommandPaletteHqThreads,
  type CommandPaletteOpenIntent,
  type CommandPaletteSubmenuItem,
  type CommandPaletteView,
  filterCommandPaletteGroups,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteMode,
  hqChatMateApps,
  hqChatMateNames,
  ITEM_ICON_CLASS,
  RECENT_THREAD_LIMIT,
  reduceCommandPaletteUiState,
  type SearchOverlayMode,
  paletteNoMatchMessage,
  paletteListsRead,
} from "./CommandPalette.logic";
import { orderItemsByPreferredIds, sortLogicalProjectsForSidebar } from "./Sidebar.logic";
import { CommandPaletteContent } from "./CommandPaletteContent";
import { CommandPaletteResults } from "./CommandPaletteResults";
import { ProjectFavicon } from "./ProjectFavicon";
import { ProjectFilePicker } from "./files/ProjectFilePicker";
import { ProjectContentSearchDialog } from "./search/ProjectContentSearchDialog";
import { toggleThemeEditorForTheme } from "./settings/themeEditorStore";
import {
  COMMAND_PALETTE_META_ICON_CLASS,
  CommandPaletteMetaDot,
  ThreadCommandSubtitle,
} from "./ThreadCommandSubtitle";
import {
  ThreadRowLeadingStatus,
  ThreadRowResolvedStatus,
  ThreadRowTrailingStatus,
} from "./ThreadStatusIndicators";
import { SidebarJumpBox } from "./zerops/SidebarJumpBox";
import { useSidebarJump } from "./zerops/sidebarJump";
import { askNewProject } from "../zerops/newProjectAsk";
import { useHqMatesRead } from "../zerops/useHqMatesRead";
import { useZeropsSessionOptional } from "../zerops/ZeropsSessionProvider";
import { candidateListingAtom } from "../zerops/useZeropsCandidates";
import { slashKeyOpensJumpBox } from "./zerops/jumpSlash";
import { primaryServerKeybindingsAtom, primaryServerProvidersAtom } from "../state/server";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../providerInstances";
import { resolveShortcutCommand, threadJumpIndexFromCommand } from "../keybindings";
import { CommandDialog, CommandDialogPopup } from "./ui/command";
import { stackedThreadToast, toastManager } from "~/lib/toasts";
import { ComposerHandleContext, useComposerHandleContext } from "../composerHandleContext";
import type { ChatComposerHandle } from "./chat/ChatComposer";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../logicalProject";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "../sidebarProjectGrouping";
import type { Project } from "../types";

const selectCommandPaletteSortOrders = (settings: ClientSettings) => ({
  sidebarProjectSortOrder: settings.sidebarProjectSortOrder,
  sidebarThreadSortOrder: settings.sidebarThreadSortOrder,
});

const APPEARANCE_OPTIONS = [
  { mode: "system", label: "System", icon: MonitorIcon },
  { mode: "light", label: "Light", icon: SunIcon },
  { mode: "dark", label: "Dark", icon: MoonIcon },
] as const;

function notifyThemeSaveFailure(): void {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Couldn't save theme selection",
      description: "Try again.",
    }),
  );
}

function projectFavicon(project: Project) {
  return (
    <ProjectFavicon
      environmentId={project.environmentId}
      cwd={project.workspaceRoot}
      faviconPath={project.faviconPath}
      className={ITEM_ICON_CLASS}
    />
  );
}

const OVERLAY_MODE_BY_COMMAND = {
  "commandPalette.toggle": "command",
  "filePicker.toggle": "files",
  "projectSearch.toggle": "content",
} as const satisfies Partial<Record<string, SearchOverlayMode>>;

function overlayModeForCommand(command: string | null): SearchOverlayMode | null {
  if (command === null) return null;
  return command in OVERLAY_MODE_BY_COMMAND
    ? OVERLAY_MODE_BY_COMMAND[command as keyof typeof OVERLAY_MODE_BY_COMMAND]
    : null;
}

export function CommandPalette({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduceCommandPaletteUiState, {
    open: false,
    mode: "command",
    openIntent: null,
  });
  const setOpen = useCallback((open: boolean) => dispatch({ _tag: "SetOpen", open }), []);
  const toggleMode = useCallback(
    (mode: SearchOverlayMode) => dispatch({ _tag: "ToggleMode", mode }),
    [],
  );
  const navigate = useNavigate();
  // New project opens its dialog over whatever is on screen (`ZeropsNewProjectHost`).
  const openAddProject = useCallback(
    (_environmentId?: EnvironmentId) => {
      setOpen(false);
      askNewProject();
    },
    [setOpen],
  );
  const openNewThreadIn = useCallback(() => dispatch({ _tag: "OpenNewThreadIn" }), []);
  const clearOpenIntent = useCallback(() => dispatch({ _tag: "ClearOpenIntent" }), []);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { theme, themeHalves, resolvedTheme, appearanceMode, setAppearanceMode } = useTheme();
  const composerHandleRef = useRef<ChatComposerHandle | null>(null);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const terminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );

  useEffect(() => {
    if (!state.open || state.mode === "command") return;
    const onEscapeKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      toggleMode("command");
    };
    window.addEventListener("keydown", onEscapeKeyDown, true);
    return () => window.removeEventListener("keydown", onEscapeKeyDown, true);
  }, [state.mode, state.open, toggleMode]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // "/" opens the palette too, wherever nothing is being typed.
      if (slashKeyOpensJumpBox(event)) {
        event.preventDefault();
        setOpen(true);
        return;
      }
      // Resolve with the complete shortcut context so customized bindings
      // using any documented `when` condition work.
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          modelPickerOpen: composerHandleRef.current?.isModelPickerOpen() ?? false,
        },
      });
      if (command === "appearance.cycle") {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        const nextMode =
          appearanceMode === "system" ? "light" : appearanceMode === "light" ? "dark" : "system";
        if (!setAppearanceMode(nextMode)) {
          notifyThemeSaveFailure();
        } else {
          toastManager.add({
            id: "appearance-cycle",
            title: `Appearance: ${APPEARANCE_OPTIONS.find((option) => option.mode === nextMode)?.label}`,
            timeout: 1500,
          });
        }
        return;
      }
      if (command === "theme.select") {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        dispatch({ _tag: "OpenChangeTheme" });
        return;
      }
      if (command === "themeEditor.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleThemeEditorForTheme({
          theme,
          themeHalves,
          initialAppearance: resolvedTheme,
        });
        return;
      }
      if (command === "usage.open") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        void navigate({ to: "/usage" });
        return;
      }
      const mode = overlayModeForCommand(command);
      if (mode === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleMode(mode);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    appearanceMode,
    keybindings,
    navigate,
    resolvedTheme,
    setAppearanceMode,
    setOpen,
    terminalOpen,
    theme,
    themeHalves,
    toggleMode,
  ]);

  useEffect(
    () =>
      onOpenCommandPalette((detail) => {
        if (detail.open === "new-thread-in") {
          openNewThreadIn();
        } else if (detail.open === "add-project") {
          openAddProject(
            detail.environmentId !== undefined
              ? EnvironmentId.make(detail.environmentId)
              : undefined,
          );
        } else {
          setOpen(true);
        }
      }),
    [openAddProject, openNewThreadIn, setOpen],
  );

  return (
    <ComposerHandleContext value={composerHandleRef}>
      <CommandDialog
        open={state.open}
        onOpenChange={(open, eventDetails) => {
          if (!open && eventDetails.reason === "escape-key" && state.mode !== "command") {
            eventDetails.cancel();
            toggleMode("command");
            return;
          }
          setOpen(open);
        }}
      >
        {/* Block background focus calls for the entire time the palette is open. */}
        <div className="contents" inert={state.open}>
          {children}
        </div>
        <CommandPaletteDialog
          mode={state.mode}
          openIntent={state.openIntent}
          setOpen={setOpen}
          openOverlayMode={toggleMode}
          clearOpenIntent={clearOpenIntent}
        />
      </CommandDialog>
    </ComposerHandleContext>
  );
}

function CommandPaletteDialog(props: {
  readonly mode: SearchOverlayMode;
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
  readonly openOverlayMode: (mode: SearchOverlayMode) => void;
  readonly clearOpenIntent: () => void;
}) {
  const composerHandleRef = useComposerHandleContext();

  return (
    <CommandDialogPopup
      aria-label={
        props.mode === "files"
          ? "File picker"
          : props.mode === "content"
            ? "Search project contents"
            : "Command palette"
      }
      className={cn("overflow-hidden", props.mode === "content" && "h-105")}
      data-command-palette="true"
      id={COMMAND_PALETTE_ID}
      data-palette-mode={props.mode}
      data-testid="command-palette"
      finalFocus={() => {
        composerHandleRef?.current?.focusAtEnd();
        return false;
      }}
      onBackdropPointerDown={() => {
        props.setOpen(false);
      }}
    >
      {props.mode === "files" ? (
        <ProjectFilePicker setOpen={props.setOpen} />
      ) : props.mode === "content" ? (
        <ProjectContentSearchDialog onOpenChange={props.setOpen} />
      ) : (
        <CommandRootDialog
          openIntent={props.openIntent}
          setOpen={props.setOpen}
          openOverlayMode={props.openOverlayMode}
          clearOpenIntent={props.clearOpenIntent}
        />
      )}
    </CommandDialogPopup>
  );
}

/**
 * Signed in to Zerops, the palette opens as the jump box (`SidebarJumpBox`),
 * which finds what the left menu holds; its `>` hands over to the commands
 * here, from that `>`. Anything opened for a purpose — a theme, a new
 * thread's project — is the commands' own.
 */
function CommandRootDialog(props: {
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
  readonly openOverlayMode: (mode: SearchOverlayMode) => void;
  readonly clearOpenIntent: () => void;
}) {
  const zeropsSignedIn = useZeropsSessionOptional()?.status === "signed-in";
  const jumpIndex = useSidebarJump((store) => store.index);
  const [commandsFrom, setCommandsFrom] = useState<string | null>(null);
  if (zeropsSignedIn && jumpIndex !== null && props.openIntent === null && commandsFrom === null) {
    return (
      <SidebarJumpBox index={jumpIndex} onCommands={setCommandsFrom} setOpen={props.setOpen} />
    );
  }
  return (
    <OpenCommandPaletteDialog
      {...props}
      initialQuery={commandsFrom ?? ""}
      {...(commandsFrom === null
        ? {}
        : {
            // The ">" taken away again: back to finding.
            onLeaveCommands: () => {
              setCommandsFrom(null);
            },
          })}
    />
  );
}

export function OpenCommandPaletteDialog(props: {
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
  readonly openOverlayMode: (mode: SearchOverlayMode) => void;
  readonly clearOpenIntent: () => void;
  readonly initialQuery?: string;
  /** Opened from the jump box's ">": its query without the ">" hands back to it. */
  readonly onLeaveCommands?: () => void;
}) {
  const navigate = useNavigate();
  const roleOffered = useRoleOffers();
  const { clearOpenIntent, openIntent, openOverlayMode, setOpen } = props;
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = deferredQuery.startsWith(">");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const clientSettings = useClientSettings(selectCommandPaletteSortOrders);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const { environments: allEnvironments } = useEnvironments();
  const mateDirectory = useAtomValue(shownHqMateDirectoryAtom);
  const environments = useMemo(
    () =>
      allEnvironments.filter((environment) =>
        isListedMateEnvironment(mateDirectory, environment.environmentId),
      ),
    [allEnvironments, mateDirectory],
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const zeropsMates = useAtomValue(zeropsMatesAtom);
  const serverConfigs = useServerConfigs();
  const allProjects = useProjects();
  const projects = useMemo(
    () =>
      allProjects.filter((project) =>
        isListedMateEnvironment(mateDirectory, project.environmentId),
      ),
    [allProjects, mateDirectory],
  );
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const threadShells = useThreadShells();
  // Unopened Mates' chats come from HQ, independently of this tab's socket shells.
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const { organizationId, settled: hqMatesRead } = useHqMatesRead();
  const readInput = { organizationId, bootstrapped, hqMatesRead };
  const [listReadState, setListReadState] = useState(() => paletteListsRead(null, readInput));
  const nextListReadState = paletteListsRead(listReadState, readInput);
  if (nextListReadState !== listReadState) setListReadState(nextListReadState);
  const listsRead = nextListReadState.read;
  // Every thread link the palette offers — a thread row, a project's latest
  // thread — opens only into an environment the route gate would open, and
  // never into a crewmate's thread, which is the crew's to open.
  const { linkable } = useEnvironmentLinks();
  const threads = useMemo(
    () =>
      threadShells.filter(
        (thread) =>
          linkable(thread.environmentId) &&
          thread.crew === undefined &&
          isListedMateEnvironment(mateDirectory, thread.environmentId),
      ),
    [linkable, threadShells, mateDirectory],
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const {
    theme,
    themeHalves,
    resolvedTheme,
    appearanceMode,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
  } = useTheme();
  const customThemes = useCustomThemes();
  const themeCards = useMemo(() => {
    const seen = new Set<string>();
    return [
      ...STANDARD_THEME_CARDS.map((card) => ({ ...card, id: null })),
      ...[...BUILT_IN_THEMES, ...customThemes]
        .filter((definition) => {
          if (seen.has(definition.id)) return false;
          seen.add(definition.id);
          return true;
        })
        .map(getThemeCardDefinition),
    ];
  }, [customThemes]);
  const providers = useAtomValue(primaryServerProvidersAtom);
  const providerEntryByEnvironmentAndInstanceId = useMemo(() => {
    const map = new Map<string, ProviderInstanceEntry>();
    for (const environment of environments) {
      const environmentProviders =
        environment.serverConfig?.providers ??
        (environment.environmentId === primaryEnvironmentId ? providers : []);
      for (const entry of deriveProviderInstanceEntries(environmentProviders)) {
        map.set(`${environment.environmentId}:${entry.instanceId}`, entry);
      }
    }
    return map;
  }, [environments, primaryEnvironmentId, providers]);
  const [viewStack, setViewStack] = useState<CommandPaletteView[]>([]);
  const currentView = viewStack.at(-1) ?? null;
  const environmentIds = useMemo(
    () => environments.map((environment) => environment.environmentId),
    [environments],
  );
  const threadSearchQuery = currentView === null && !isActionsOnly ? deferredQuery : "";
  const threadSearch = useThreadSearch(environmentIds, threadSearchQuery);
  const threadContentMatchByKey = useMemo(
    () =>
      new Map(
        threadSearch.matches.flatMap((match) =>
          match.source === "user" || match.source === "assistant"
            ? [[threadSearchMatchKey(match), match] as const]
            : [],
        ),
      ),
    [threadSearch.matches],
  );
  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectEnvironmentLocationById = useMemo(
    () =>
      new Map(
        environments.map((environment) => {
          const isPrimary = environment.entry.target._tag === "PrimaryConnectionTarget";
          return [
            environment.environmentId,
            {
              kind: isPrimary ? "local" : "remote",
              label: isPrimary ? "Local" : environment.label,
            },
          ] as const;
        }),
      ),
    [environments],
  );
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
        getPreferenceIds: (project) => [
          getProjectOrderKey(project),
          legacyProjectCwdPreferenceKey(project.workspaceRoot),
        ],
      }),
    [projectOrder, projects],
  );
  const unsortedProjectGroups = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: clientSettings.sidebarProjectSortOrder === "manual" ? orderedProjects : projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      }),
    [
      clientSettings.sidebarProjectSortOrder,
      environmentLabelById,
      orderedProjects,
      primaryEnvironmentId,
      projectGroupingSettings,
      projects,
    ],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        unsortedProjectGroups,
        threads,
        clientSettings.sidebarProjectSortOrder,
      ),
    [clientSettings.sidebarProjectSortOrder, threads, unsortedProjectGroups],
  );
  const contextualProjectRef = useMemo(
    () =>
      resolveThreadActionProjectRef({
        activeDraftThread,
        activeThread: activeThread ?? undefined,
        defaultProjectRef,
        handleNewThread,
      }),
    [activeDraftThread, activeThread, defaultProjectRef, handleNewThread],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: contextualProjectRef,
      }),
    [contextualProjectRef, projectGroups],
  );
  const pickerProjects = useMemo(
    () =>
      projectPickerEntries.map(({ group, targetProject }) => ({
        ...targetProject,
        displayName: group.displayName,
      })),
    [projectPickerEntries],
  );
  const projectGroupByTargetKey = useMemo(
    () =>
      new Map(
        projectPickerEntries.map(({ group, targetProject }) => [
          `${targetProject.environmentId}:${targetProject.id}`,
          group,
        ]),
      ),
    [projectPickerEntries],
  );

  const projectCwdById = useMemo(
    () =>
      new Map<ProjectId, string>(projects.map((project) => [project.id, project.workspaceRoot])),
    [projects],
  );
  const projectFaviconPathById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.faviconPath ?? null] as const)),
    [projects],
  );
  const projectTitleById = useMemo(
    () => new Map<ProjectId, string>(projects.map((project) => [project.id, project.title])),
    [projects],
  );

  const activeThreadId = activeThread?.id;
  const currentProjectEnvironmentId =
    activeThread?.environmentId ?? activeDraftThread?.environmentId ?? null;
  const currentProjectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? null;
  const openProjectFromSearch = useMemo(
    () => async (project: (typeof projects)[number]) => {
      const group = projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`);
      const groupedProjectKeys = group
        ? new Set(
            group.memberProjectRefs.map(
              (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
            ),
          )
        : null;
      const latestThread = groupedProjectKeys
        ? (sortThreads(
            threads.filter(
              (thread) =>
                thread.archivedAt === null &&
                groupedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`),
            ),
            clientSettings.sidebarThreadSortOrder,
          )[0] ?? null)
        : getLatestThreadForProject(
            threads.filter((thread) => thread.environmentId === project.environmentId),
            project.id,
            clientSettings.sidebarThreadSortOrder,
          );
      if (latestThread) {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(latestThread.environmentId, latestThread.id),
          ),
        });
        return;
      }

      await handleNewThread(scopeProjectRef(project.environmentId, project.id));
    },
    [
      clientSettings.sidebarThreadSortOrder,
      handleNewThread,
      navigate,
      projectGroupByTargetKey,
      threads,
    ],
  );

  const projectSearchItems = useMemo(
    () =>
      buildProjectActionItems({
        projects: pickerProjects,
        valuePrefix: "project",
        searchTerms: (project) => {
          const group = projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`);
          return (
            group?.memberProjects.flatMap((member) => [member.title, member.workspaceRoot]) ?? []
          );
        },
        icon: projectFavicon,
        runProject: openProjectFromSearch,
      }),
    [openProjectFromSearch, pickerProjects, projectGroupByTargetKey],
  );

  const projectThreadItems = useMemo(
    () =>
      enumerateCommandPaletteItems(
        buildProjectActionItems({
          projects: pickerProjects,
          valuePrefix: "new-thread-in",
          searchTerms: (project) => {
            const group = projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`);
            const location = projectEnvironmentLocationById.get(project.environmentId);
            return [
              ...(group?.memberProjects.flatMap((member) => [member.title, member.workspaceRoot]) ??
                []),
              ...(location ? [location.label] : []),
            ];
          },
          renderDescription: (project) => {
            const location = projectEnvironmentLocationById.get(project.environmentId) ?? {
              kind: "remote",
              label: "Remote",
            };
            return (
              <span className="flex min-w-0 items-center gap-1">
                <span className="inline-flex min-w-0 items-center gap-1">
                  {location.kind === "remote" ? (
                    <ServerIcon aria-hidden className={COMMAND_PALETTE_META_ICON_CLASS} />
                  ) : null}
                  <span className="truncate">{location.label}</span>
                </span>
                <CommandPaletteMetaDot />
                <span className="truncate">{project.workspaceRoot}</span>
              </span>
            );
          },
          icon: projectFavicon,
          runProject: async (project) => {
            const group = projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`);
            const contextualRefBelongsToGroup =
              contextualProjectRef !== null &&
              group?.memberProjectRefs.some(
                (projectRef) =>
                  projectRef.environmentId === contextualProjectRef.environmentId &&
                  projectRef.projectId === contextualProjectRef.projectId,
              );
            await handleNewThread(
              contextualRefBelongsToGroup
                ? contextualProjectRef
                : scopeProjectRef(project.environmentId, project.id),
            );
          },
        }),
      ),
    [
      contextualProjectRef,
      handleNewThread,
      pickerProjects,
      projectEnvironmentLocationById,
      projectGroupByTargetKey,
    ],
  );

  const hqMates = useAtomValue(shownHqListedMatesAtom);
  const mateVisibilities = useAtomValue(
    shownMateVisibilitiesAtom(Object.keys(hqMates.mates).join(",")),
  );
  const candidateListing = useAtomValue(candidateListingAtom);
  const hqStructure = useAtomValue(shownHqListNavigationAtom);
  const mateNames = useMemo(
    () => hqChatMateNames(heldCandidates(candidateListing).rows, hqStructure?.structure ?? null),
    [candidateListing, hqStructure],
  );
  const mateApps = useMemo(
    () => hqChatMateApps(heldCandidates(candidateListing).rows, hqStructure?.structure ?? null),
    [candidateListing, hqStructure],
  );
  const threadLastVisitedAtById = useUiStateStore((store) => store.threadLastVisitedAtById);
  // Every Mate's chats HQ lists, of those this browser holds no socket to: titles and status only.
  const hqThreads = useMemo((): CommandPaletteHqThreads => {
    const connected = new Set(
      environments
        .filter((environment) => environment.connection.phase === "connected")
        .map((environment) => environment.environmentId),
    );
    return {
      mates: new Map(Object.entries(hqMates.mates)),
      connected: (environmentId) => connected.has(environmentId),
      linkable,
      visibilityByProject: mateVisibilities,
      lastVisitedAt: (environmentId, threadId) =>
        threadLastVisitedAtById[scopedThreadKey(scopeThreadRef(environmentId, threadId))],
      mateName: (projectId) => mateNames.get(projectId),
      mateApp: (projectId) => mateApps.get(projectId),
      renderStatus: (status) => <ThreadRowResolvedStatus status={status} />,
    };
  }, [
    environments,
    hqMates,
    mateNames,
    mateApps,
    mateVisibilities,
    linkable,
    threadLastVisitedAtById,
  ]);
  const allThreadItems = useMemo(
    () =>
      buildThreadActionItems({
        threads,
        hq: hqThreads,
        ...(activeThreadId ? { activeThreadId } : {}),
        projectTitleById,
        sortOrder: clientSettings.sidebarThreadSortOrder,
        icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
        renderLeadingContent: (thread) => <ThreadRowLeadingStatus thread={thread} />,
        renderTrailingContent: (thread) => <ThreadRowTrailingStatus thread={thread} />,
        renderDescription: (thread, { projectTitle }) => {
          const modelInstanceId =
            thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
          const providerEntry =
            providerEntryByEnvironmentAndInstanceId.get(
              `${thread.environmentId}:${modelInstanceId}`,
            ) ?? null;
          return (
            <ThreadCommandSubtitle
              environmentId={thread.environmentId}
              projectCwd={projectCwdById.get(thread.projectId) ?? null}
              projectFaviconPath={projectFaviconPathById.get(thread.projectId) ?? null}
              projectTitle={projectTitle ?? null}
              branch={thread.branch}
              worktreePath={thread.worktreePath}
              isCurrent={thread.id === activeThreadId}
              driverKind={providerEntry?.driverKind ?? null}
              providerDisplayName={
                thread.session?.providerName ?? providerEntry?.displayName ?? modelInstanceId
              }
            />
          );
        },
        getContentMatch: (thread) => {
          const match = threadContentMatchByKey.get(
            threadSearchMatchKey({
              environmentId: thread.environmentId,
              threadId: thread.id,
            }),
          );
          return match && (match.source === "user" || match.source === "assistant")
            ? {
                source: match.source,
                snippet: match.snippet,
                query: threadSearchQuery,
              }
            : undefined;
        },
        runThread: async (thread) => {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
          });
        },
      }),
    [
      activeThreadId,
      clientSettings.sidebarThreadSortOrder,
      hqThreads,
      navigate,
      projectCwdById,
      projectFaviconPathById,
      projectTitleById,
      providerEntryByEnvironmentAndInstanceId,
      threadContentMatchByKey,
      threadSearchQuery,
      threads,
    ],
  );
  const recentThreadItems = allThreadItems.slice(0, RECENT_THREAD_LIMIT);

  const pushPaletteView = useCallback((view: CommandPaletteView): void => {
    setViewStack((previousViews) => [...previousViews, view]);
    setHighlightedItemValue(null);
    setQuery("");
  }, []);

  function pushView(item: CommandPaletteSubmenuItem): void {
    pushPaletteView({
      addonIcon: item.addonIcon,
      groups: item.groups,
    });
  }

  function popView(): void {
    setViewStack((previousViews) => previousViews.slice(0, -1));
    setHighlightedItemValue(null);
    setQuery("");
  }

  function handleQueryChange(nextQuery: string): void {
    if (props.onLeaveCommands !== undefined && currentView === null && !nextQuery.startsWith(">")) {
      props.onLeaveCommands();
      return;
    }
    setHighlightedItemValue(null);
    setQuery(nextQuery);
  }

  useLayoutEffect(() => {
    if (openIntent?.kind !== "new-thread-in" || projectThreadItems.length === 0) {
      return;
    }
    clearOpenIntent();
    setViewStack([]);
    setQuery("");
    const currentPrefix =
      currentProjectEnvironmentId && currentProjectId
        ? `new-thread-in:${currentProjectEnvironmentId}:${currentProjectId}`
        : null;
    const prioritized = currentPrefix
      ? [
          ...projectThreadItems.filter((item) => item.value === currentPrefix),
          ...projectThreadItems.filter((item) => item.value !== currentPrefix),
        ]
      : projectThreadItems;
    pushPaletteView({
      addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
      groups: [
        {
          value: "projects",
          label: "Projects",
          items: enumerateCommandPaletteItems(prioritized),
        },
      ],
    });
  }, [
    clearOpenIntent,
    currentProjectEnvironmentId,
    currentProjectId,
    openIntent,
    projectThreadItems,
    pushPaletteView,
  ]);

  const actionItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];

  if (projects.length > 0) {
    const activeProjectTitle =
      projectPickerEntries.find((entry) => entry.isPreferred)?.group.displayName ??
      (currentProjectId ? (projectTitleById.get(currentProjectId) ?? null) : null);

    if (activeProjectTitle) {
      actionItems.push({
        kind: "action",
        value: "action:new-thread",
        searchTerms: ["new thread", "chat", "create", "draft"],
        title: (
          <>
            New thread in <span className="font-semibold">{activeProjectTitle}</span>
          </>
        ),
        icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
        shortcutCommand: "chat.new",
        run: async () => {
          await startNewThreadFromContext({
            activeDraftThread,
            activeThread: activeThread ?? undefined,
            defaultProjectRef,
            handleNewThread,
          });
        },
      });
    }

    actionItems.push({
      kind: "submenu",
      value: "action:new-thread-in",
      searchTerms: ["new thread", "project", "pick", "choose", "select"],
      title: "New thread in...",
      icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
      addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
      groups: [{ value: "projects", label: "Projects", items: projectThreadItems }],
    });
  }

  actionItems.push({
    kind: "action",
    value: "action:open-file-picker",
    searchTerms: ["go to file", "open file", "file picker", "find file", "quick open"],
    title: "Go to file",
    icon: <FileSearchIcon className={ITEM_ICON_CLASS} />,
    keepOpen: true,
    shortcutCommand: "filePicker.toggle",
    run: async () => {
      openOverlayMode("files");
    },
  });

  actionItems.push({
    kind: "action",
    value: "action:search-project-contents",
    searchTerms: ["search project", "find in files", "grep", "content search", "text search"],
    title: "Search project contents",
    icon: <TextSearchIcon className={ITEM_ICON_CLASS} />,
    keepOpen: true,
    shortcutCommand: "projectSearch.toggle",
    run: async () => {
      openOverlayMode("content");
    },
  });

  if (roleOffered.newProject) {
    actionItems.push({
      kind: "action",
      value: "action:add-project",
      searchTerms: ["add project", "create", "zerops", "environment"],
      title: "Create Zerops project",
      icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        setOpen(false);
        askNewProject();
      },
    });
  }

  const changeThemeItem: CommandPaletteSubmenuItem = {
    kind: "submenu",
    value: "action:change-theme",
    searchTerms: ["change theme", "appearance", "colors", "palette"],
    title: "Change theme",
    icon: <PaletteIcon className={ITEM_ICON_CLASS} />,
    addonIcon: <PaletteIcon className={ADDON_ICON_CLASS} />,
    shortcutCommand: "theme.select",
    groups: [
      {
        value: "themes",
        label: "Change theme",
        items: themeCards.map(({ id, label, previews }) => ({
          kind: "action",
          value: id === null ? "theme:standard" : `theme:palette:${id}`,
          title: label,
          description: previews.length === 1 ? `For ${previews[0]!.mode} mode` : undefined,
          searchTerms: [label, "theme", "appearance"],
          icon: <PaletteIcon className={ITEM_ICON_CLASS} />,
          titleTrailingContent: (
            <span className="flex shrink-0 items-center gap-2">
              {(themeHalves?.[resolvedTheme] ?? getThemeDefinition(theme)?.id ?? null) === id ? (
                <span className="text-xs text-muted-foreground/70">Current</span>
              ) : null}
              <span className="flex items-center gap-1" aria-hidden>
                {previews.map((preview) => (
                  <ThemePreviewCircle
                    key={preview.mode}
                    colors={preview.colors}
                    mode={preview.mode}
                    className="size-3 border-0"
                  />
                ))}
              </span>
            </span>
          ),
          run: async () => {
            const saved =
              previews.length === 1 && id !== null
                ? setThemeHalf(previews[0]!.mode, id)
                : setTheme(id ?? appearanceMode);
            if (!saved) notifyThemeSaveFailure();
          },
        })),
      },
    ],
  };
  actionItems.push(changeThemeItem);

  const changeAppearanceItem: CommandPaletteSubmenuItem = {
    kind: "submenu",
    value: "action:change-appearance",
    searchTerms: ["change appearance", "light", "dark", "system", "mode", "toggle"],
    title: "Change appearance",
    icon: <MonitorIcon className={ITEM_ICON_CLASS} />,
    addonIcon: <MonitorIcon className={ADDON_ICON_CLASS} />,
    shortcutCommand: "appearance.cycle",
    groups: [
      {
        value: "appearance",
        label: "Change appearance",
        items: APPEARANCE_OPTIONS.map(({ mode, label, icon: Icon }) => ({
          kind: "action",
          value: `appearance:${mode}`,
          title: label,
          searchTerms: [label, "appearance", "mode"],
          icon: <Icon className={ITEM_ICON_CLASS} />,
          titleTrailingContent:
            appearanceMode === mode ? (
              <span className="text-xs text-muted-foreground/70">Current</span>
            ) : undefined,
          run: async () => {
            if (!setAppearanceMode(mode)) notifyThemeSaveFailure();
          },
        })),
      },
    ],
  };
  actionItems.push(changeAppearanceItem);

  useLayoutEffect(() => {
    if (openIntent?.kind !== "change-theme") return;
    clearOpenIntent();
    setViewStack([]);
    pushPaletteView({
      addonIcon: <PaletteIcon className={ADDON_ICON_CLASS} />,
      groups: [{ value: "themes", label: "Change theme", items: [] }],
    });
  }, [clearOpenIntent, openIntent, pushPaletteView]);

  actionItems.push({
    kind: "action",
    value: "action:theme-editor",
    searchTerms: ["theme", "appearance", "colors", "palette", "customize"],
    title: "Toggle theme editor",
    icon: <PaletteIcon className={ITEM_ICON_CLASS} />,
    shortcutCommand: "themeEditor.toggle",
    run: async () => {
      toggleThemeEditorForTheme({
        theme,
        themeHalves,
        initialAppearance: resolvedTheme,
      });
    },
  });

  actionItems.push({
    kind: "action",
    value: "action:usage",
    searchTerms: ["usage", "use", "tokens", "cost", "spend", "limits", "stats", "analytics"],
    title: "Open usage",
    icon: <ChartNoAxesColumnIcon className={ITEM_ICON_CLASS} />,
    shortcutCommand: "usage.open",
    run: async () => {
      await navigate({ to: "/usage" });
    },
  });

  // A Mate's own persona, from any of its chats; the Chief takes none.
  const personaMate = activeThread ? zeropsMateAt(zeropsMates, activeThread.environmentId) : null;
  if (activeThread && personaMate?.kind === "mate" && personaMate.mate.chief !== true) {
    const threadRef = scopeThreadRef(activeThread.environmentId, activeThread.id);
    const mateName = personaMate.mate.name;
    // An update is said only once the Mate's server answered without persona support.
    const config = serverConfigs.get(activeThread.environmentId);
    const takesPersona = config?.environment.capabilities.matePersona === true;
    actionItems.push({
      kind: "action",
      value: "action:persona",
      searchTerms: [
        "persona",
        "personality",
        "voice",
        "style",
        "instructions",
        "template",
        "talks",
      ],
      title: `Choose ${mateName}'s persona`,
      icon: <PersonaIcon className={ITEM_ICON_CLASS} />,
      ...(takesPersona
        ? {}
        : {
            disabled: true,
            description:
              config === undefined
                ? `Waiting for ${mateName} to answer.`
                : `Update ${mateName} to give it a persona.`,
          }),
      run: async () => {
        useRightPanelStore.getState().open(threadRef, "persona");
      },
    });
  }

  actionItems.push({
    kind: "action",
    value: "action:settings",
    searchTerms: ["settings", "preferences", "configuration", "keybindings"],
    title: "Open settings",
    icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/settings" });
    },
  });

  // There is no projects listing page; the action targets the contextual
  // project (active thread/draft, falling back to the first sidebar group).
  const contextualProjectGroup =
    (contextualProjectRef
      ? projectGroupByTargetKey.get(
          `${contextualProjectRef.environmentId}:${contextualProjectRef.projectId}`,
        )
      : null) ??
    projectGroups[0] ??
    null;
  if (contextualProjectGroup) {
    actionItems.push({
      kind: "action",
      value: "action:project-settings",
      searchTerms: ["project", "settings", "scripts", "grouping", "checkout"],
      title: "Project settings",
      description: contextualProjectGroup.displayName,
      icon: <FolderIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({
          to: "/projects/$projectKey",
          params: { projectKey: contextualProjectGroup.projectKey },
        });
      },
    });
  }

  const rootGroups = buildRootGroups({ actionItems, recentThreadItems });
  const activeGroups =
    currentView?.groups[0]?.value === "themes"
      ? changeThemeItem.groups
      : currentView?.groups[0]?.value === "appearance"
        ? changeAppearanceItem.groups
        : (currentView?.groups ?? rootGroups);

  const filteredGroups = filterCommandPaletteGroups({
    activeGroups,
    query: deferredQuery,
    isInSubmenu: currentView !== null,
    projectSearchItems: projectSearchItems,
    threadSearchItems: allThreadItems,
  });

  const paletteMode = getCommandPaletteMode(currentView);
  const isSubmenu = paletteMode === "submenu";

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) {
      // Confirming an IME candidate must not select a row.
      (event as typeof event & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
      return;
    }

    const command = resolveShortcutCommand(event, keybindings, {
      platform: navigator.platform,
      context: { modelPickerOpen: false },
    });
    if (threadJumpIndexFromCommand(command ?? "") !== null) {
      event.preventDefault();
      event.stopPropagation();
      const matchingItem = filteredGroups
        .flatMap((group) => group.items)
        .find((item) => item.shortcutCommand === command);
      if (matchingItem) {
        executeItem(matchingItem);
      }
      return;
    }

    if (event.key === "Backspace" && query === "" && isSubmenu) {
      event.preventDefault();
      popView();
    }
  }

  function executeItem(item: CommandPaletteActionItem | CommandPaletteSubmenuItem): void {
    if (item.disabled) {
      return;
    }

    if (item.kind === "submenu") {
      pushView(item);
      return;
    }

    if (!item.keepOpen) {
      setOpen(false);
    }

    void item.run().catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to run command",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    });
  }

  return (
    <CommandPaletteContent
      key={viewStack.length}
      aria-label="Command palette"
      autoHighlight="always"
      footerActionLabel="Select"
      inputProps={{
        placeholder: getCommandPaletteInputPlaceholder(paletteMode),
        ...(isSubmenu
          ? {
              startAddon: (
                <button
                  type="button"
                  className="flex cursor-pointer items-center"
                  aria-label="Back"
                  onClick={popView}
                >
                  <ArrowLeftIcon />
                </button>
              ),
            }
          : {}),
        onKeyDown: handleKeyDown,
      }}
      mode="none"
      onItemHighlighted={(value) => {
        setHighlightedItemValue(typeof value === "string" ? value : null);
      }}
      onValueChange={handleQueryChange}
      showBackHint={isSubmenu}
      value={query}
    >
      {threadSearch.incomplete && !threadSearch.isPending ? (
        <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">
          Some conversations could not be searched.
        </p>
      ) : null}
      <CommandPaletteResults
        groups={filteredGroups}
        highlightedItemValue={highlightedItemValue}
        isActionsOnly={isActionsOnly}
        keybindings={keybindings}
        onExecuteItem={executeItem}
        emptyStateMessage={
          threadSearch.incomplete && !threadSearch.isPending
            ? "Some conversations could not be searched."
            : threadSearch.isPending
              ? "Searching thread messages…"
              : paletteNoMatchMessage({ isActionsOnly, listsRead })
        }
      />
    </CommandPaletteContent>
  );
}

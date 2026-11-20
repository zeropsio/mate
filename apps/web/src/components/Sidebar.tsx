import { ownChiefCandidateAtom } from "~/zerops/useZeropsCandidates";
import {
  shownHqMateDirectoryAtom,
  isListedMateEnvironment,
  shownHqListNavigationAtom,
} from "@t3tools/client-runtime/data";
import { useAtomValue } from "@effect/atom-react";
import { shownHqPersonFactsAtom } from "@t3tools/client-runtime/data";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { arrayElementsEqual } from "@t3tools/client-runtime/state/entities";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { Building2Icon, SquarePenIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useLocation, useMatch, useParams, useRouter } from "@tanstack/react-router";

import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isElectron } from "../env";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { useShortcutModifierState } from "../shortcutModifierState";
import { useTerminalFocus } from "../hooks/useTerminalFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "../localApi";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../logicalProject";
import {
  buildSidebarProjectThreadBranches,
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useThreadActions } from "../hooks/useThreadActions";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { useClientSettings } from "../hooks/useSettings";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { shareEqual } from "@t3tools/shared/structuralSharing";
import { useStableHandlers } from "../hooks/useStableHandlers";
import { useStandingGetter } from "../hooks/useStandingGetter";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import {
  useAllEnvironmentProjectSnapshotsReady,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { environmentServerConfigsAtom, primaryServerKeybindingsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useThreadSearch } from "../state/queries";
import { useMateCommand } from "../zerops/accountEnvironments";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { cn } from "~/lib/utils";
import { buildThreadActionMenuItems } from "./threadActionMenu.logic";
import {
  buildBulkTitleRegenerationContextMenuItem,
  isSidebarNestedLinkClick,
  isUntouchedSidebarThread,
  isTrailingDoubleClick,
  orderItemsByPreferredIds,
  openAddProjectFromSidebar,
  openMenuMate,
  resolveAdjacentThreadId,
  resolveWorkspaceNewThreadAction,
  searchSidebarThreads,
  shouldCreateNewThreadInCurrentProject,
  sortLogicalProjectsForSidebar,
  sortThreadsForSidebar,
  shouldShowProjectIdentityInSidebarSection,
  useThreadJumpHintVisibility,
} from "./Sidebar.logic";
import {
  setThreadChangeRequestSnapshot,
  threadChangeRequestSnapshotsAtom,
} from "./ThreadStatusIndicators";
import {
  deriveProviderEntriesByEnvironment,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { stackedThreadToast, toastManager } from "~/lib/toasts";
import { Button } from "./ui/button";
import { SidebarContent, SidebarGroup, useSidebar } from "./ui/sidebar";
import {
  SidebarChromeFooter,
  SidebarChromeHeader,
  SidebarCreateButton,
  sidebarAccountDestinationIcon,
} from "./sidebar/SidebarChrome";
import { newMateView, useAddAutomatedMates, useAddMate } from "../zerops/newMate";
import { useAddMateOffer } from "../zerops/useHqOffers";
import { useAddMateDoor } from "../zerops/addMateDoor";
import { useOpenPutLive, usePutLive } from "../zerops/putLive";
import { releaseOffered } from "~/zerops/waiting.logic";
import { useSetUpEnvironment } from "../zerops/setUpEnvironment";
import { useAskNewProject } from "../zerops/newProjectAsk";
import { useRoleOffers, useTeamOffers } from "../zerops/usePlatformCapabilities";
import { useCreations } from "../zerops/creations";
import { newProjectView, placedNewProjects } from "../zerops/newProjectBirth";
import { placedSharedBirths, useSharedBirths } from "../zerops/sharedBirths";
import {
  useMateComingOf,
  useMateConversationsRead,
  useMateRowActivity,
} from "../zerops/useMenuMateReadings";
import { useAskMateToFix } from "../zerops/fixRequest";
import { useZeropsCandidates } from "../zerops/useZeropsCandidates";
import { useMenuRows } from "../zerops/useMenuRows";
import { useZeropsMateOwners } from "../zerops/useZeropsMateOwners";
import { useZeropsSession } from "../zerops/ZeropsSessionProvider";
import { AccountVoiceLine } from "./zerops/AccountVoiceLine";
import { useListingPatience } from "../zerops/useListingPatience";
import { useHqOutage } from "../zerops/hqNavigation";
import { useAccountDataOptional } from "../zerops/ZeropsAccountData";
import { useNowMs } from "../zerops/useNowMs";
import { SidebarProjectTree } from "./sidebar/SidebarProjectTree";
import {
  SidebarHqStatus,
  SidebarZeropsTree,
  type SidebarProjectFlow,
  type SidebarZeropsTreeProps,
} from "./zerops/SidebarZeropsTree";
import { rollbacksOf } from "./zerops/SidebarProductionChip.logic";
import { useMatesActivity } from "../zerops/useZeropsAgentActivity";
import { useSidebarMateMenus } from "./zerops/mateActions/useSidebarMateMenus";
import { menuPressHeld, type MenuPress } from "./zerops/menuPress.logic";
import { menuDrawsLoadingRows } from "./zerops/SidebarProjects.logic";
import { useViewerWaits, useWaitingNext } from "./zerops/useSidebarWaiting";
import { shownInScope, useMateScope } from "../zerops/mateScope";
import {
  hqPlacementKnownAtom,
  isPlatformProject,
  usePlatformProjects,
} from "../zerops/platformProjects";
import { SidebarScopeButton } from "./zerops/SidebarScopeButton";
import { SidebarJumpButton } from "./zerops/SidebarJumpButton";
import { openCrewTab } from "../zerops/crew/crewTab";
import { useOpenMate } from "../zerops/useOpenMate";
import { overviewProjectsOf, useMenuProjects, useOverviewKey } from "./zerops/SidebarOverview";
import { overviewHeadline } from "./zerops/SidebarOverview.logic";
import { useChiefSetupLine } from "~/zerops/chiefSetup";
import { usePaintedOwnChief } from "~/zerops/ownChief";
import { chiefTopShown } from "./zerops/chief/chiefTop.logic";
import { SidebarChiefPlace } from "./zerops/chief/SidebarChiefRow";
import { SidebarChiefTop } from "./zerops/chief/SidebarChiefTop";
import { SidebarRail, useRailTiles } from "./zerops/SidebarRail";
import { SidebarStage } from "./zerops/SidebarStage";
import { SidebarZeropsAccountRow } from "./zerops/SidebarZeropsAccount";

import { useProjectFlows } from "../zerops/projectFlows";
import { placedPressesIn, useForgetConnectedPresses, useMatePresses } from "../zerops/matePress";
import { releaseFailureOf, type CanonicalEnvironmentRow } from "@t3tools/client-runtime/zerops";
import {
  candidatesNotice,
  findCandidate,
  heldCandidates,
} from "@t3tools/client-runtime/zerops/projections";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { composerDraftHasUserContent, DraftId, useComposerDraftStore } from "../composerDraftStore";
import { SidebarSearchResultRow, SidebarThreadRow } from "./SidebarThreadRows";
import {
  SidebarThreadSearchField,
  SidebarNewThreadButton,
  SidebarProjectScopeRow,
} from "./SidebarThreadListHeader";
import { SidebarDraftBlock } from "./SidebarDraftRows";
import { SidebarThreadListEmpty, SidebarThreadSearchEmpty } from "./SidebarThreadListEmpty";
import { useZeropsListHeld } from "./useZeropsListHeld";

const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, ProviderInstanceEntry> = new Map();

/** How long a press stands for the Mate it opens before its route must have arrived. */
const MENU_PRESS_BOUND_MS = 6_000;

/** A listed Mate by its list key: a project can hold several containers, each a row of its own. */
const listedMateKey = (candidate: { readonly key: string }): string => candidate.key;

/** Two readings of plain data say the same (`shareEqual`). */
const sameAsRead = <T,>(previous: T, next: T): boolean => shareEqual(previous, next) === previous;

/** Runs `run` once the browser has painted the frame now being drawn; at once where none paints. */
function afterNextPaint(run: () => void): void {
  if (typeof requestAnimationFrame !== "function") {
    run();
    return;
  }
  requestAnimationFrame(() => {
    window.setTimeout(run, 0);
  });
}

/** How the menu's Mate tree names the listing it is drawn from. */
const ZEROPS_SIDEBAR_SURFACE = {
  subject: "your projects",
  entity: "project",
  source: "zerops",
  checking: "Reading your projects…",
  negative: null,
} as const;

/** A reader of successive arrays giving back the last one while its elements are the same. */
function createElementsKeeper<A>(): (next: ReadonlyArray<A>) => ReadonlyArray<A> {
  let last: ReadonlyArray<A> = [];
  return (next) => {
    if (!arrayElementsEqual(last, next)) last = next;
    return last;
  };
}

/** What one of the Mate tree's verbs is called with. */
type TreeVerbArgs<K extends "onNoticeAct" | "onSetUp" | "onAskToFix"> = Parameters<
  NonNullable<SidebarZeropsTreeProps<never>[K]>
>;

export default function Sidebar() {
  const projects = useProjects();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const threads = useThreadShells();

  // HQ owns the menu rows. Platform inventory enriches names/state and access gates actions;
  // neither a sleeping container nor unfinished inventory changes placement membership.
  const zeropsSession = useZeropsSession();
  const zeropsSignedIn = zeropsSession.status === "signed-in";
  const { listing: zeropsListing, refresh: refreshZeropsCandidates } = useZeropsCandidates();
  const zeropsHeld = useMemo(() => heldCandidates(zeropsListing), [zeropsListing]);
  // Until every source the rows come from answered, none is drawn and the menu is loading.
  const { rows: zeropsCandidates, settled: zeropsMenuSettled } = useMenuRows(zeropsHeld.rows);
  const zeropsMenuComplete = zeropsHeld.complete && zeropsMenuSettled;
  // The creations under way in the organization in view, drawn in their
  // groups before the listing holds them — the projects page's own placing —
  // and the New projects this tab is making, from the press.
  const zeropsPresses = useMatePresses();
  // A press ends once its Mate connects: nothing of it is left to say.
  useForgetConnectedPresses(zeropsCandidates);
  const zeropsMade = useCreations();
  const sharedBirths = useSharedBirths();
  const zeropsPlacedBirths = useMemo(
    () =>
      placedSharedBirths(
        sharedBirths,
        placedPressesIn(
          zeropsPresses,
          zeropsSession.activeOrganization?.id,
          placedNewProjects(zeropsMade, zeropsSession.activeOrganization?.id, Date.now()),
        ),
        zeropsSession.user?.id,
        (birthId) => zeropsMade.find((made) => made.birthId === birthId)?.startedAt,
      ),
    [
      sharedBirths,
      zeropsPresses,
      zeropsMade,
      zeropsSession.activeOrganization?.id,
      zeropsSession.user?.id,
    ],
  );
  // Whose each Mate is, for the badge on the corner of its face.
  const zeropsMateOwner = useZeropsMateOwners();
  // Each container's health, as the container store holds it — the tree's
  // "some Mate in the group is up" part of *Put it live*'s gate.
  // Until the listing may say "none", the tree says what it can instead.
  const zeropsNowMs = useNowMs();
  const zeropsPatient = useListingPatience(zeropsListing);
  const zeropsNotice = useMemo(
    () =>
      candidatesNotice(zeropsListing, ZEROPS_SIDEBAR_SURFACE, zeropsNowMs, {
        patient: zeropsPatient,
        // The page says the projects are read, once; the menu holds its rows' room quietly.
        readingSilent: true,
      }),
    [zeropsListing, zeropsNowMs, zeropsPatient],
  );
  // A Mate's conversation, from its row — the jump box opens it the same way.
  const openMate = useOpenMate();
  // Each project's flow — what its Mates have waiting, what its environments
  // run — drawn under the project as a timeline. What a release would put live
  // is no part of the menu: it is compared where a release is shown.
  const zeropsProjectFlows = useProjectFlows("every").flows;
  // Production being made by Put it live is released by it: no row or header asks for a release
  // meanwhile (the onboarding run's "Release 2" beside "Making production").
  const putLiveRuns = usePutLive((state) => state.runs);
  const zeropsSidebarFlow = useCallback(
    (groupId: string): SidebarProjectFlow | undefined => {
      const flow = zeropsProjectFlows.get(groupId);
      if (flow === undefined) return undefined;
      return {
        pullRequests: flow.pullRequests,
        // Until HQ tells them, the tree draws the change rows it remembers.
        changesKnown: flow.changesKnown,
        // The pull requests that have landed on `main`: without it `groupFlow`
        // never sees a group's own merged code, so it read `main` as empty.
        merged: flow.merged,
        environments: new Map(flow.environments.map((entry) => [entry.id, entry])),
        // The one gate every surface asks (`releaseOffered`): what waits on the viewer reads it too.
        releaseOffered: releaseOffered({
          allowed: flow.release.gate.allowed,
          recheck: flow.release.git?.delivery?.recheck,
          putLive: putLiveRuns.get(groupId),
        }),
        // What a release would put in front of people: the count the
        // chips' menus say waits for production.
        releaseContents: flow.release.contents,
        releaseSummary: flow.release.summary,
        releaseUntold: flow.release.untold,
        mateTier: flow.mateTier,
        outside: flow.outside,
        // Until HQ answers the releases, production's chip says only what the platform says.
        releasesKnown: flow.releasesKnown,
        // The release that did not go through, which turns the chip amber.
        releaseFailure: releaseFailureOf({
          releases: flow.releases,
          environmentInputs: flow.environmentInputs,
          stalled: flow.release.stalled,
        }),
        // HQ's roll backs: production's chip says one on its way by what it goes back to.
        releaseRollbacks: rollbacksOf(flow.releases),
        // What the project menu's *Add stage* and *Put it live* are offered from.
        recipeRead: flow.recipeRead,
        recipeTiers: flow.recipeTiers,
        // The version a release would tag.
        releaseTag: flow.release.suggestion,
        // The release on its way, which production's chip and menu say.
        releaseInFlight: flow.release.inFlight,
      };
    },
    [putLiveRuns, zeropsProjectFlows],
  );
  const router = useRouter();
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  /** A stop's page, in place of the thread — the sidebar stays where it is. */
  const openStop = useCallback(
    (groupId: string, row: CanonicalEnvironmentRow) => {
      void router.navigate({
        to: "/group/$groupId/$projectId",
        params: { groupId, projectId: row.id },
      });
    },
    [router],
  );
  const openGroup = useCallback(
    (groupId: string) => {
      void router.navigate({ to: "/group/$groupId/flow", params: { groupId } });
    },
    [router],
  );
  /** A change's own page: what it carries, and the verb that moves it. */
  const openChange = useCallback(
    (groupId: string, pull: { readonly repository: string; readonly number: number }) => {
      void router.navigate({
        to: "/change/$groupId/$repository/$number",
        params: {
          groupId,
          repository: pull.repository,
          number: String(pull.number),
        },
      });
    },
    [router],
  );
  const zeropsSidebarFlowWithPages = useCallback(
    (groupId: string): SidebarProjectFlow | undefined => {
      const base = zeropsSidebarFlow(groupId);
      return base === undefined
        ? undefined
        : {
            ...base,
            onOpenStop: (row) => {
              openStop(groupId, row);
            },
            onOpenChange: (pull) => {
              openChange(groupId, pull);
            },
          };
    },
    [zeropsSidebarFlow, openStop, openChange],
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const confirmThreadArchive = useClientSettings((s) => s.confirmThreadArchive);
  const sidebarProjectSortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  // HQ away: the menu draws the structure it last read and, past HQ's budget, says since when
  // (SPEC §6.2.3); the Mates' conversations go on without HQ.
  const zeropsHqOutage = useHqOutage(useAtomValue(shownHqListNavigationAtom), timestampFormat);
  const zeropsRetry = useAccountDataOptional()?.retry;
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const { archiveThread } = useThreadActions();
  const updateThreadMetadata = useMateCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: "branch name",
    onCopy: ({ branch }) => {
      toastManager.add({
        type: "success",
        title: "Branch copied",
        description: branch,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy branch",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
    onCopy: ({ threadId }) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: threadId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy thread ID",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const [projectScopeMenuOpen, setProjectScopeMenuOpen] = useState(false);
  const newThreadContext = useHandleNewThread();
  const openAddProjectSourcePicker = useCallback(
    (environmentId: EnvironmentId) => {
      setProjectScopeMenuOpen(false);
      openAddProjectFromSidebar({
        isMobile,
        closeMobile: () => setOpenMobile(false),
        openPalette: () => openCommandPalette({ open: "add-project", environmentId }),
      });
    },
    [isMobile, setOpenMobile],
  );
  const { environments } = useEnvironments();
  // A Mate's roster row stands for all its chats: it opens the main one, and
  // the conversation strip the others. So a Zerops environment's project,
  // threads and drafts are folded into its row rather than listed a second
  // time below in T3's tree; an environment that is not Zerops (a local
  // server) keeps the tree. An environment counts as Zerops when it is a
  // roster candidate now or came in through the Zerops door — a container
  // deleted on the platform is still registered here, and its leftovers must
  // not resurface as a tree.
  const zeropsEnvironmentIds = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  // The threads T3's tree lists: none of a Zerops environment's. The same array while those stay
  // the same objects, so a streaming Mate's chat — a Zerops one — never re-buckets or re-sorts
  // the tree.
  const [keepLegacyThreads] = useState(createElementsKeeper<EnvironmentThreadShell>);
  const legacyThreads = useMemo(
    () =>
      keepLegacyThreads(
        threads.filter((thread) => !zeropsEnvironmentIds.has(thread.environmentId)),
      ),
    [keepLegacyThreads, threads, zeropsEnvironmentIds],
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const markThreadUnread = useUiStateStore((s) => s.markThreadUnread);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeThreadRef = useMemo(
    () => resolveActiveThreadRouteRef(routeTarget, routeDraftThread),
    [routeDraftThread, routeTarget],
  );
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const routeTargetRef = useRef(routeTarget);
  routeTargetRef.current = routeTarget;

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
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
        projects: (sidebarProjectSortOrder === "manual" ? orderedProjects : projects).filter(
          (project) => !zeropsEnvironmentIds.has(project.environmentId),
        ),
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      }),
    [
      environmentLabelById,
      orderedProjects,
      primaryEnvironmentId,
      projectGroupingSettings,
      projects,
      sidebarProjectSortOrder,
      zeropsEnvironmentIds,
    ],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(unsortedProjectGroups, legacyThreads, sidebarProjectSortOrder),
    [legacyThreads, sidebarProjectSortOrder, unsortedProjectGroups],
  );
  // Nothing but the roster: a Zerops account whose every environment is a
  // roster row, with no local project alongside.
  const rosterOnly = zeropsSignedIn && projectGroups.length === 0;
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  // Threads on non-primary environments resolve their
  // provider entry from their own environment's config: default instance ids
  // are driver slugs, so a flat map would collide across environments.
  const providerEntriesByEnvironment = useMemo(
    () =>
      deriveProviderEntriesByEnvironment(
        [...serverConfigs].map(
          ([environmentId, config]) => [environmentId, config.providers] as const,
        ),
      ),
    [serverConfigs],
  );
  const projectCwdByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          `${project.environmentId}:${project.id}`,
          project.workspaceRoot,
        ]),
      ),
    [projects],
  );
  const projectFaviconPathByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [`${project.environmentId}:${project.id}`, project.faviconPath]),
      ),
    [projects],
  );
  const projectDisplayNameByKey = useMemo(
    () =>
      new Map(
        projectGroups.flatMap((group) =>
          group.memberProjects.map(
            (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
          ),
        ),
      ),
    [projectGroups],
  );

  const changeRequestSnapshotByKey = useAtomValue(threadChangeRequestSnapshotsAtom);

  // Project scope: one menu above the list. Scoping filters the list without
  // making the header width depend on the number or length of project names.
  // The selection lives in the persisted UI store next to the other sidebar
  // project preferences, so routes that unmount the sidebar (Settings) and
  // app restarts keep it.
  const projectScopeKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const setProjectScopeKey = useUiStateStore((store) => store.setSidebarProjectScopeKey);
  const [collapsedProjectKeys, setCollapsedProjectKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapsedProjectMemberKeys, setCollapsedProjectMemberKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleProjectBranch = useCallback((projectKey: string) => {
    setCollapsedProjectKeys((current) => {
      const next = new Set(current);
      if (next.has(projectKey)) next.delete(projectKey);
      else next.add(projectKey);
      return next;
    });
  }, []);
  const toggleProjectMemberBranch = useCallback((memberKey: string) => {
    setCollapsedProjectMemberKeys((current) => {
      const next = new Set(current);
      if (next.has(memberKey)) next.delete(memberKey);
      else next.add(memberKey);
      return next;
    });
  }, []);
  const scopedProjectGroup = useMemo(
    () =>
      projectScopeKey === null
        ? null
        : (projectGroups.find((project) => project.projectKey === projectScopeKey) ?? null),
    [projectGroups, projectScopeKey],
  );
  const scopedProjectKeys = useMemo(
    () =>
      scopedProjectGroup === null
        ? null
        : new Set(
            scopedProjectGroup.memberProjectRefs.map(
              (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
            ),
          ),
    [scopedProjectGroup],
  );
  // A persisted scope whose project is gone falls back to all projects, but
  // only after every catalog environment has a live project snapshot. Cached
  // or disconnected environments cannot establish that the project is gone.
  const allProjectSnapshotsReady = useAllEnvironmentProjectSnapshotsReady();
  useEffect(() => {
    if (projectScopeKey !== null && allProjectSnapshotsReady && scopedProjectGroup === null) {
      setProjectScopeKey(null);
    }
  }, [allProjectSnapshotsReady, projectScopeKey, scopedProjectGroup, setProjectScopeKey]);
  // Count-only subscription: the parent needs "are there draft rows" for the
  // empty state, while SidebarDraftBlock owns the per-keystroke content
  // subscription. Selecting a number keeps typing in a draft composer from
  // re-rendering the whole sidebar. Approximates the block's row filter
  // (every non-promoted session with content); it can overcount by one for
  // an open never-left draft, which only softens the empty state.
  const routeDraftIdForRows = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const visibleDraftSessionCount = useComposerDraftStore((store) => {
    let count = 0;
    for (const [draftKey, session] of Object.entries(store.draftThreadsByThreadKey)) {
      if (session.promotedTo != null) {
        continue;
      }
      if (zeropsEnvironmentIds.has(session.environmentId)) {
        continue;
      }
      if (!composerDraftHasUserContent(store.draftsByThreadKey[draftKey])) {
        continue;
      }
      if (
        scopedProjectKeys !== null &&
        !scopedProjectKeys.has(`${session.environmentId}:${session.projectId}`)
      ) {
        continue;
      }
      count += 1;
    }
    return count;
  });
  // Scope flips drop the selection: rows selected under the old scope may be
  // hidden now, and bulk actions must never count or touch invisible rows.
  useEffect(() => {
    clearSelection();
  }, [clearSelection, projectScopeKey]);

  const handleProjectSettings = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, projectGroup: SidebarProjectSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      setProjectScopeMenuOpen(false);
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/projects/$projectKey",
        params: { projectKey: projectGroup.projectKey },
      });
    },
    [isMobile, router, setOpenMobile],
  );

  // Every *New project* in the menu — its header's button, its pinned row, its empty state — asks
  // for the New project dialog over whatever is on screen (`ZeropsNewProjectHost`).
  const askNewProject = useAskNewProject();
  // What the viewer's role makes here (`roleOffers`): a role that may not create projects is
  // offered neither New project nor a Chief, which would be a project of their own.
  const roleOffered = useRoleOffers();
  const openNewZeropsProject = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    askNewProject();
  }, [askNewProject, isMobile, setOpenMobile]);

  // The left menu's add button asks for a Mate on a named project: the New Mate
  // dialog opens over whatever is on screen (`ZeropsNewMateHost`).
  const addMate = useAddMate();
  // "Add stage": the projects page's own form, opened there; "Put it live": its sheet, here.
  const askSetUp = useSetUpEnvironment((state) => state.ask);
  const openPutLive = useOpenPutLive();
  // A Mate still coming up opens its own view, where it comes up — a New
  // project's first Mate, before the platform has made its project, by the
  // creation's own id.
  const openComingMate = useCallback(
    (projectId: string) => {
      if (isMobile) setOpenMobile(false);
      const made = zeropsMade.find((creation) => creation.birthId === projectId);
      if (
        (made !== undefined && made.projectId === null) ||
        sharedBirths.some((birth) => birth.id === projectId && birth.projectId === null)
      ) {
        void router.navigate(newProjectView(projectId));
        return;
      }
      void router.navigate(newMateView(projectId));
    },
    [isMobile, router, setOpenMobile, sharedBirths, zeropsMade],
  );

  const navigateToZeropsProjects = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void router.navigate({ to: "/zerops" });
  }, [isMobile, router, setOpenMobile]);
  useOverviewKey(zeropsSignedIn ? navigateToZeropsProjects : undefined);
  // A project's ··· brings people into it: the invitation, the project picked.
  const teamOffered = useTeamOffers();
  const inviteToProject = useCallback(
    (groupId: string) => {
      if (isMobile) setOpenMobile(false);
      void router.navigate({ to: "/settings/team/invite", search: { project: groupId } });
    },
    [isMobile, router, setOpenMobile],
  );

  // The + asks for a Mate in one of the organization's projects, over whatever is on screen: only
  // those HQ offers a new Mate in, as the menu's own rows do.
  const zeropsMenuProjects = useMenuProjects();
  const addMateOffer = useAddMateOffer();
  const zeropsMateProjects = useMemo(
    () => zeropsMenuProjects.filter((project) => addMateOffer(project.id).kind === "allowed"),
    [addMateOffer, zeropsMenuProjects],
  );
  // No project takes a Mate from this person, who works with one: the + says whom to ask.
  const addMateDoor = useAddMateDoor();
  const zeropsAddMateWhy = zeropsMenuProjects
    .map((project) => addMateDoor(project.id))
    .find((door) => door.kind === "off")?.why;
  const onZeropsNewMate = useCallback(
    (groupId: string) => {
      if (isMobile) setOpenMobile(false);
      addMate(groupId);
    },
    [addMate, isMobile, setOpenMobile],
  );
  const addAutomatedMates = useAddAutomatedMates();
  const onZeropsNewAutomatedMates = useCallback(
    (groupId: string) => {
      if (isMobile) setOpenMobile(false);
      addAutomatedMates(groupId);
    },
    [addAutomatedMates, isMobile, setOpenMobile],
  );
  // The Overview row: lit while the overview is open, its line the organization in one sentence.
  const zeropsOverviewOpen = useLocation({ select: (location) => location.pathname === "/zerops" });
  // While the menu is still reading, the line says nothing rather than "No projects yet".
  const zeropsHeadline = useMemo(
    () =>
      zeropsMenuComplete
        ? overviewHeadline(
            overviewProjectsOf({
              projects: zeropsMenuProjects,
              flows: zeropsProjectFlows,
              candidates: zeropsCandidates,
            }),
          )
        : "",
    [zeropsCandidates, zeropsMenuComplete, zeropsMenuProjects, zeropsProjectFlows],
  );
  // What each Mate is doing, off its attention — the one derivation the
  // projects screen reads too (`mateActivity.ts`), so a Mate says the same
  // thing in both places.
  const zeropsAgentActivity = useMatesActivity(true);
  // Each Mate's own menu: the projects screen's verbs, and this viewer's own.
  const zeropsMateMenus = useSidebarMateMenus({ threads });
  // What a Mate's row says (`useMateRowActivity`): its attention, at rest
  // while that word is not of now.
  const zeropsRowActivity = useMateRowActivity(zeropsAgentActivity);
  // Whether a Mate's conversations are read: one with none says nothing was asked yet.
  const zeropsConversationsRead = useMateConversationsRead();
  // Whether a Mate is still in its first minutes, as the projects page says it.
  const zeropsComing = useMateComingOf(zeropsCandidates);
  // "Ask <your Mate> to fix it" from the production chip's menu (S6).
  const askMateToFix = useAskMateToFix();
  // A Mate still coming up is open in its own view (`/mate/$projectId`) — a New
  // project's first Mate, before its project exists, by the creation's id.
  const comingMateRoute = useMatch({ from: "/_chat/mate/$projectId", shouldThrow: false });
  const newProjectRoute = useMatch({ from: "/_chat/mate/new/$birthId", shouldThrow: false });
  // The person's Chief, kept out of the listing for a top of its own.
  const zeropsChief = useAtomValue(ownChiefCandidateAtom);
  // The row for the environment whose conversation is open. A fresh draft
  // has no thread yet, but it knows its environment — and that is the one
  // the user is about to talk to.
  const activeZeropsProject = useMemo(
    () =>
      openMenuMate({
        comingProjectId: comingMateRoute?.params.projectId,
        birthId: newProjectRoute?.params.birthId,
        environmentId: routeThreadRef?.environmentId ?? routeDraftThread?.environmentId,
        chief: zeropsChief,
        lookup: (environmentId) =>
          findCandidate(zeropsListing, (candidate) => candidate.environmentId === environmentId),
      }),
    [
      comingMateRoute,
      newProjectRoute,
      routeDraftThread?.environmentId,
      routeThreadRef?.environmentId,
      zeropsChief,
      zeropsListing,
    ],
  );
  const activeZeropsProjectId = activeZeropsProject.id;
  const activeZeropsProjectResolving = activeZeropsProject.resolving;
  // The open conversation as the route names it, found or not: what the menu's reveal keys on.
  const activeZeropsConversation =
    comingMateRoute?.params.projectId ??
    newProjectRoute?.params.birthId ??
    routeThreadRef?.environmentId ??
    routeDraftThread?.environmentId ??
    null;
  // The Mate a press in the menu opens, lit from the press while its route is on its way
  // (`menuLitMate`): the band slides at the click, not once the conversation has loaded.
  const [zeropsPress, setZeropsPress] = useState<MenuPress | null>(null);
  const zeropsPressHeld =
    zeropsPress !== null &&
    menuPressHeld(zeropsPress, { active: activeZeropsProjectId, overviewOpen: zeropsOverviewOpen });
  useEffect(() => {
    if (zeropsPress === null) return;
    if (!zeropsPressHeld) {
      setZeropsPress(null);
      return;
    }
    // A press whose route never comes — the Mate gone meanwhile — stops standing for it.
    const timer = window.setTimeout(() => {
      setZeropsPress(null);
    }, MENU_PRESS_BOUND_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [zeropsPress, zeropsPressHeld]);
  const litZeropsProjectId =
    zeropsPressHeld && zeropsPress !== null ? zeropsPress.projectId : activeZeropsProjectId;
  const litZeropsConversation =
    zeropsPressHeld && zeropsPress?.conversation !== undefined
      ? zeropsPress.conversation
      : activeZeropsConversation;
  // Whose Mates the menu lists (the account menu's Mine / Everyone): the
  // tree and the waiting faces read the same answer.
  const [zeropsMateScope, setZeropsMateScope] = useMateScope();
  const showEveryoneMates = useCallback(() => setZeropsMateScope("everyone"), [setZeropsMateScope]);
  const zeropsPersonFacts = useAtomValue(shownHqPersonFactsAtom);
  // A project only Platform holds is never one of the Mates: the tree draws it as a plain row to
  // its page there, only once the person asked for them from the line under the list.
  const [zeropsPlatformProjects, setZeropsPlatformProjects] = usePlatformProjects();
  const showZeropsPlatformProjects = useCallback(
    (shown: boolean) => setZeropsPlatformProjects(shown ? "shown" : "hidden"),
    [setZeropsPlatformProjects],
  );
  const zeropsPlacementKnown = useAtomValue(hqPlacementKnownAtom);
  const zeropsPlatformProject = useCallback(
    (candidate: (typeof zeropsCandidates)[number]) =>
      isPlatformProject(candidate.project, {
        placementKnown: zeropsPlacementKnown,
        active: candidate.project.id === litZeropsProjectId,
      }),
    [litZeropsProjectId, zeropsPlacementKnown],
  );
  const zeropsShown = useCallback(
    (candidate: (typeof zeropsCandidates)[number]) =>
      !zeropsPlatformProject(candidate) &&
      shownInScope(
        zeropsMateScope,
        zeropsPersonFacts[candidate.project.id]?.mine,
        candidate.project.id === litZeropsProjectId,
      ),
    [litZeropsProjectId, zeropsPersonFacts, zeropsMateScope, zeropsPlatformProject],
  );
  // The tree's verbs, the same functions from render to render: the tree and its rows are
  // memoised, and a streaming Mate re-renders this whole menu on every shell event.
  const onZeropsNoticeAct = useCallback(
    (...[affordance]: TreeVerbArgs<"onNoticeAct">) => {
      if (affordance.kind === "go-to-projects") navigateToZeropsProjects();
      else refreshZeropsCandidates();
    },
    [navigateToZeropsProjects, refreshZeropsCandidates],
  );
  const onZeropsSetUp = useCallback(
    (...[groupId, tier]: TreeVerbArgs<"onSetUp">) => {
      if (isMobile) setOpenMobile(false);
      // Production is put live over what is on screen; a stage is the projects page's form.
      if (tier === "production") {
        openPutLive(groupId);
        return;
      }
      askSetUp(groupId, tier);
      navigateToZeropsProjects();
    },
    [askSetUp, isMobile, navigateToZeropsProjects, openPutLive, setOpenMobile],
  );
  const onZeropsAskToFix = useCallback(
    (...[mateProjectId, problem]: TreeVerbArgs<"onAskToFix">) => {
      if (isMobile) setOpenMobile(false);
      askMateToFix(mateProjectId, problem);
    },
    [askMateToFix, isMobile, setOpenMobile],
  );
  // The menu's top row is the person's Chief: its conversation once it is listed, else the Chief
  // page, where it is set up.
  const mateDirectory = useAtomValue(shownHqMateDirectoryAtom);
  const zeropsChiefPageOpen = useLocation({ select: (location) => location.pathname === "/chief" });
  const openChiefPage = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    void router.navigate({ to: "/chief" });
  }, [isMobile, router, setOpenMobile]);
  const zeropsListed = zeropsCandidates;
  // Who is coming, and each row's menu, as the list is handed them: the same getters while they
  // answer the same for every Mate listed. Both are built off shared state — every Mate's link,
  // every write under way — and were rebuilt, and the whole list drawn again, three times as one
  // conversation opened.
  const zeropsListedComing = useStandingGetter(
    zeropsComing,
    zeropsListed,
    listedMateKey,
    sameAsRead,
  );
  const getZeropsMateActions = zeropsMateMenus.getMateActions;
  const zeropsActionsOf = useCallback(
    (candidate: (typeof zeropsCandidates)[number]) =>
      getZeropsMateActions(candidate, zeropsRowActivity(candidate)),
    [getZeropsMateActions, zeropsRowActivity],
  );
  const zeropsListedActions = useStandingGetter(zeropsActionsOf, zeropsListed, listedMateKey);
  const chiefSetupLine = useChiefSetupLine();
  // What the top row paints before HQ says: the Chief the last visit had (it grants nothing).
  const paintedChief = usePaintedOwnChief();
  const [chiefStoodAtFirst] = useState(() => typeof paintedChief === "string");
  const onZeropsSelect = useCallback(
    (candidate: (typeof zeropsCandidates)[number]) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      // Drawn in the press's own frame: the two rows whose state changes, with the band's slide.
      // The route's change, a frame later, then finds the menu as it already stands and draws
      // none of it again.
      setZeropsPress({
        projectId: candidate.project.id,
        conversation: candidate.environmentId ?? undefined,
        from: activeZeropsProjectId,
        fromOverview: zeropsOverviewOpen,
      });
      // The route changes once the band's slide — set by the press itself (`slideSelectedBandTo`)
      // — has painted: the change redraws every page reading the route at once, 40–80 ms in which
      // no frame paints.
      afterNextPaint(() => {
        openMate(candidate);
      });
    },
    [activeZeropsProjectId, isMobile, openMate, setOpenMobile, zeropsOverviewOpen],
  );
  const onZeropsOpenCrew = useCallback(
    (candidate: (typeof zeropsCandidates)[number], setUp: boolean) => {
      if (isMobile) setOpenMobile(false);
      openMate(candidate, (conversation) => {
        openCrewTab(conversation, { setUp });
      });
    },
    [isMobile, openMate, setOpenMobile],
  );
  // What every row of the list is handed to call: the same functions for the menu's life, so
  // opening another Mate redraws the two rows whose state changed, not each row for a new handler.
  const zeropsRowVerbs = useStableHandlers({
    select: onZeropsSelect,
    openCrew: onZeropsOpenCrew,
    askToFix: onZeropsAskToFix,
  });
  // What waits on the viewer (`useViewerWaits`), the overview's tab and cards read the same: the
  // Waiting on you row, the header's count and the rail; ⌥↓ goes to the next.
  const zeropsWaiting = useViewerWaits();
  useWaitingNext({
    mates: zeropsWaiting.mates,
    activeProjectId: activeZeropsProjectId,
    beforeReveal: isMobile
      ? () => {
          setOpenMobile(true);
        }
      : undefined,
    enabled: zeropsSignedIn,
  });
  const zeropsListLoading = menuDrawsLoadingRows({
    candidates: zeropsCandidates,
    births: zeropsPlacedBirths,
    complete: zeropsMenuComplete,
    reading: zeropsSession.organizationStatus === "selected" && !zeropsMenuComplete,
    notice: zeropsNotice,
  });
  const zeropsListHeld = useZeropsListHeld({ zeropsSignedIn, zeropsListLoading });
  // What the Waiting on you list asks of the menu: a Mate's conversation, and its fix request.
  const zeropsWaitingVerbs = useMemo(
    () => ({
      onOpenMate: (projectId: string) => {
        const candidate = zeropsCandidates.find((item) => item.project.id === projectId);
        if (candidate !== undefined) onZeropsSelect(candidate);
      },
      onAskToFix: onZeropsAskToFix,
    }),
    [onZeropsAskToFix, onZeropsSelect, zeropsCandidates],
  );
  // Closed on a desktop, the menu is a rail of tiles: the same projects, in the menu's order.
  const zeropsProjectName = useCallback(
    (groupId: string) => zeropsMenuProjects.find((project) => project.id === groupId)?.name,
    [zeropsMenuProjects],
  );
  const zeropsRailTiles = useRailTiles({
    candidates: zeropsListed,
    activityOf: zeropsRowActivity,
    shown: zeropsShown,
    ownerOf: zeropsMateOwner,
    projectName: zeropsProjectName,
    waiting: zeropsWaiting.items,
    activeProjectId: zeropsOverviewOpen ? null : litZeropsProjectId,
  });

  // Archived threads stay hidden here: archive keeps its "remove from sidebar" meaning.
  const activeThreads = useMemo(
    () =>
      sortThreadsForSidebar(
        // A crewmate's thread is the crew's, never an ordinary row.
        legacyThreads.filter(
          (thread) =>
            thread.archivedAt === null &&
            isListedMateEnvironment(mateDirectory, thread.environmentId) &&
            thread.crew === undefined &&
            (scopedProjectKeys === null ||
              scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`)),
        ),
      ),
    [scopedProjectKeys, legacyThreads, mateDirectory],
  );

  const threadSearchInputRef = useRef<HTMLInputElement>(null);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [activeSearchResultIndex, setActiveSearchResultIndex] = useState(0);
  const isSearchingThreads = threadSearchQuery.trim().length > 0;
  const searchableThreads = useMemo(() => activeThreads, [activeThreads]);
  const searchEnvironmentIds = useMemo(
    () =>
      environments
        .map((environment) => environment.environmentId)
        .filter((id) => isListedMateEnvironment(mateDirectory, id)),
    [environments, mateDirectory],
  );
  // useThreadSearch owns the debounce, the two-character floor and asking only
  // connected environments.
  const threadSearch = useThreadSearch(searchEnvironmentIds, threadSearchQuery);
  const threadSearchMatchByKey = useMemo(
    () =>
      new Map(threadSearch.matches.map((match) => [threadSearchMatchKey(match), match] as const)),
    [threadSearch.matches],
  );
  const threadSearchResults = useMemo(
    () =>
      searchSidebarThreads(
        searchableThreads,
        threadSearchQuery,
        new Set(threadSearchMatchByKey.keys()),
      ),
    [searchableThreads, threadSearchQuery, threadSearchMatchByKey],
  );
  const threadSearchResultOrderKey = threadSearchResults
    .map((thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))
    .join("\0");

  useEffect(() => {
    setActiveSearchResultIndex(0);
  }, [threadSearchResultOrderKey]);

  useEffect(() => {
    if (!isSearchingThreads) return;
    document
      .getElementById(`sidebar-thread-search-result-${activeSearchResultIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeSearchResultIndex, isSearchingThreads, threadSearchResultOrderKey]);

  const orderedThreads = useMemo(() => activeThreads, [activeThreads]);
  const orderedThreadKeys = useMemo(
    () =>
      orderedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    [orderedThreads],
  );
  // Rows call back into the click handler without carrying the ordered list as
  // a prop — a fresh array identity per shell update would defeat every row's
  // memoization. The ref keeps shift-range-select working against the list as
  // rendered at click time.
  const orderedThreadKeysRef = useRef(orderedThreadKeys);
  orderedThreadKeysRef.current = orderedThreadKeys;
  const threadByKey = useMemo(
    () =>
      new Map(
        orderedThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [orderedThreads],
  );
  // Handlers read these through refs: depending on per-update Map/Set
  // identities would give every row a fresh callback prop on each shell
  // event and defeat row memoization during streaming.
  const threadByKeyRef = useRef(threadByKey);
  threadByKeyRef.current = threadByKey;
  // handleNewThread is inherently unstable (depends on the projects list).
  const handleNewThreadRef = useRef(newThreadContext.handleNewThread);
  handleNewThreadRef.current = newThreadContext.handleNewThread;
  const jumpLabelByKey = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const [index, threadKey] of orderedThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(index);
      if (!jumpCommand) break;
      const label = shortcutLabelForCommand(keybindings, jumpCommand);
      if (label) mapping.set(threadKey, label);
    }
    return mapping;
  }, [keybindings, orderedThreadKeys]);
  const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility();

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, isMobile, router, setOpenMobile, setSelectionAnchor],
  );

  const navigateToDraft = useCallback(
    (draftId: DraftId) => {
      // Unconditional: also drops a stale selection anchor left by
      // plain-click navigation, so a later shift-click starts fresh
      // instead of ranging from a row that is no longer the context.
      // (clearSelection no-ops when there is nothing to clear.)
      clearSelection();
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({ to: "/draft/$draftId", params: { draftId } });
    },
    [clearSelection, isMobile, router, setOpenMobile],
  );

  const clearThreadSearch = useCallback(() => {
    setThreadSearchQuery("");
    setActiveSearchResultIndex(0);
  }, []);
  const selectThreadSearchResult = useCallback(
    (thread: EnvironmentThreadShell) => {
      clearThreadSearch();
      navigateToThread(scopeThreadRef(thread.environmentId, thread.id));
    },
    [clearThreadSearch, navigateToThread],
  );
  const handleThreadSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      // IME composition (Japanese/Chinese input) uses the same keys; committing
      // a candidate must not move the highlight or navigate away mid-compose.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && isSearchingThreads) {
        event.preventDefault();
        event.stopPropagation();
        clearThreadSearch();
        return;
      }
      if (threadSearchResults.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSearchResultIndex((index) => (index + 1) % threadSearchResults.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSearchResultIndex(
          (index) => (index - 1 + threadSearchResults.length) % threadSearchResults.length,
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const result = threadSearchResults[activeSearchResultIndex];
        if (result) selectThreadSearchResult(result);
      }
    },
    [
      activeSearchResultIndex,
      clearThreadSearch,
      isSearchingThreads,
      selectThreadSearchResult,
      threadSearchResults,
    ],
  );

  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const startThreadRename = useCallback((threadRef: ScopedThreadRef, title: string) => {
    setRenamingThreadKey(scopedThreadKey(threadRef));
    setRenamingTitle(title);
  }, []);
  const cancelThreadRename = useCallback(() => setRenamingThreadKey(null), []);
  const commitThreadRename = useCallback(
    (threadRef: ScopedThreadRef, title: string, originalTitle: string) => {
      void (async () => {
        const trimmed = title.trim();
        setRenamingThreadKey(null);
        if (trimmed.length === 0) {
          toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
          return;
        }
        if (trimmed === originalTitle) return;
        const result = await updateThreadMetadata({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, title: trimmed },
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to rename thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [updateThreadMetadata],
  );

  const handleThreadClick = useCallback(
    (event: ReactMouseEvent, threadRef: ScopedThreadRef) => {
      if (isSidebarNestedLinkClick(event.target)) return;
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const threadKey = scopedThreadKey(threadRef);
      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedThreadKeysRef.current);
        return;
      }
      if (isTrailingDoubleClick(event.detail)) {
        return;
      }
      navigateToThread(threadRef);
    },
    [navigateToThread, rangeSelectTo, toggleThreadSelection],
  );

  const projectHierarchyGroups = useMemo(
    () => (scopedProjectGroup ? [scopedProjectGroup] : projectGroups),
    [projectGroups, scopedProjectGroup],
  );
  const projectHierarchyThreads = useMemo(
    () =>
      activeThreads.map((thread) => ({
        thread,
        environmentId: thread.environmentId,
        projectId: thread.projectId,
        sidebarSection: "active" as const,
      })),
    [activeThreads],
  );
  const projectThreadBranches = useMemo(
    () =>
      buildSidebarProjectThreadBranches({
        projectGroups: projectHierarchyGroups,
        threads: projectHierarchyThreads,
      }),
    [projectHierarchyGroups, projectHierarchyThreads],
  );
  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      // One exact actionable set: keys whose rows are actually rendered
      // right now. Selections can outlive their rows (settled-tail paging,
      // thread deletion elsewhere) and the menu labels must count only what
      // the actions will touch.
      const selectedThreadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      const threadKeys = selectedThreadKeys.filter((threadKey) =>
        threadByKeyRef.current.has(threadKey),
      );
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      const selectedThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      const titleRegenerationThreads = selectedThreads.filter(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadTitleRegeneration === true,
      );
      const regeneratableTitleThreads = titleRegenerationThreads.filter(
        (thread) => thread.titleRegeneration == null,
      );
      const titleRegenerationMenuItem = buildBulkTitleRegenerationContextMenuItem({
        supportedCount: titleRegenerationThreads.length,
        actionableCount: regeneratableTitleThreads.length,
      });
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [
            ...(titleRegenerationMenuItem ? [titleRegenerationMenuItem] : []),
            { id: "mark-unread", label: `Mark unread (${count})` },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure") return;
      if (clicked.value === "regenerate-title") {
        for (const thread of regeneratableTitleThreads) {
          const result = await updateThreadMetadata({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, regenerateTitle: true },
          });
          if (result._tag === "Success") continue;
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to regenerate thread titles",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
        clearSelection();
        return;
      }
      if (clicked.value === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          markThreadUnread(threadKey, thread?.latestTurn?.completedAt);
        }
        clearSelection();
        return;
      }
    },
    [clearSelection, markThreadUnread, serverConfigs, updateThreadMetadata],
  );

  const handleThreadContextMenu = useCallback(
    (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const threadKey = scopedThreadKey(threadRef);
        const selectionState = useThreadSelectionStore.getState();
        if (selectionState.hasSelection() && selectionState.selectedThreadKeys.has(threadKey)) {
          await handleMultiSelectContextMenu(position);
          return;
        }
        const thread = threadByKeyRef.current.get(threadKey);
        if (!thread) return;
        const threadWorkspacePath =
          thread.worktreePath ??
          projectCwdByKey.get(`${thread.environmentId}:${thread.projectId}`) ??
          null;
        const supportsTitleRegeneration =
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadTitleRegeneration === true;
        const isRegeneratingTitle = thread.titleRegeneration != null;
        const threadProjectGroup =
          projectGroups.find((project) =>
            project.memberProjectRefs.some(
              (projectRef) =>
                projectRef.environmentId === thread.environmentId &&
                projectRef.projectId === thread.projectId,
            ),
          ) ?? null;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            buildThreadActionMenuItems({
              branch: thread.branch ?? null,
              projectFilter: threadProjectGroup
                ? {
                    label: threadProjectGroup.displayName,
                    isActive: projectScopeKey === threadProjectGroup.projectKey,
                  }
                : null,
              isRegeneratingTitle,
              isRunning:
                thread.session?.status === "running" && thread.session.activeTurnId != null,
              supports: { titleRegeneration: supportsTitleRegeneration },
            }),
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        switch (clicked.value) {
          case "filter-by-project":
            // This item is the only scope control here, so picking the
            // already-scoped project again is the way back to all projects.
            if (threadProjectGroup) {
              setProjectScopeKey(
                projectScopeKey === threadProjectGroup.projectKey
                  ? null
                  : threadProjectGroup.projectKey,
              );
            }
            return;
          case "new-thread-on-branch": {
            // Explicit branch carry-over: reuse the thread's worktree when it
            // has one, otherwise its branch on the local checkout.
            const result = await settlePromise(() =>
              handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId), {
                branch: thread.branch,
                worktreePath: thread.worktreePath,
                envMode: thread.worktreePath ? "worktree" : "local",
                startFromOrigin: false,
              }),
            );
            if (result._tag === "Failure") {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not create thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "rename":
            startThreadRename(threadRef, thread.title);
            return;
          case "regenerate-title": {
            if (isRegeneratingTitle) return;
            const result = await updateThreadMetadata({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, regenerateTitle: true },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to regenerate thread title",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "mark-unread":
            markThreadUnread(threadKey, thread.latestTurn?.completedAt);
            return;
          case "copy-path":
            if (!threadWorkspacePath) {
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Path unavailable",
                  description: "This thread does not have a workspace path to copy.",
                }),
              );
              return;
            }
            copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
            return;
          case "copy-branch":
            if (thread.branch) {
              copyBranchToClipboard(thread.branch, { branch: thread.branch });
            }
            return;
          case "copy-thread-id":
            copyThreadIdToClipboard(thread.id, { threadId: thread.id });
            return;
          case "archive": {
            if (confirmThreadArchive) {
              const confirmed = await settlePromise(() =>
                api.dialogs.confirm(`Archive thread "${thread.title}"?`),
              );
              if (confirmed._tag === "Failure" || !confirmed.value) return;
            }
            let didArchive = false;
            const result = await archiveThread(threadRef, {
              onArchived: () => {
                didArchive = true;
              },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: didArchive
                    ? "Thread archived, but navigation failed"
                    : "Failed to archive thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
              return;
            }
            return;
          }
          default:
            return;
        }
      })();
    },
    [
      archiveThread,
      confirmThreadArchive,
      copyBranchToClipboard,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      handleMultiSelectContextMenu,
      markThreadUnread,
      projectCwdByKey,
      projectGroups,
      projectScopeKey,
      serverConfigs,
      setProjectScopeKey,
      startThreadRename,
      updateThreadMetadata,
    ],
  );

  // Thread jump (cmd+1..9) and prev/next traversal reuse the same commands as
  // v1 — the keybinding layer is shared, only the ordered list differs.
  const routeTerminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen() || isModelPickerOpen()) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeTerminalOpen,
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      const navigateToThreadKey = (targetThreadKey: string | null) => {
        if (!targetThreadKey) return false;
        const targetThread = threadByKey.get(targetThreadKey);
        if (!targetThread) return false;
        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return true;
      };
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            currentThreadId: routeThreadKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    keybindings,
    navigateToThread,
    orderedThreadKeys,
    routeTerminalOpen,
    routeThreadKey,
    threadByKey,
  ]);

  // Same predicate as v1: hints show only while the held modifiers exactly
  // match a thread-jump binding. Adding Shift (screenshots) or Alt no
  // longer matches ⌘1..9, so the overlay hides for chords like ⌘⇧4.
  const shortcutModifiers = useShortcutModifierState();
  const terminalFocused = useTerminalFocus();
  const shouldShowJumpHintsNow = shouldShowThreadJumpHintsForModifiers(
    shortcutModifiers,
    keybindings,
    {
      platform: navigator.platform,
      context: {
        terminalFocus: terminalFocused,
        terminalOpen: routeTerminalOpen,
        modelPickerOpen: isModelPickerOpen(),
      },
    },
  );
  useEffect(() => {
    updateThreadJumpHintsVisibility(shouldShowJumpHintsNow);
  }, [shouldShowJumpHintsNow, updateThreadJumpHintsVisibility]);

  // New thread defaults to the project you're in (active thread's project,
  // falling back to the top project) — same resolution the command palette
  // uses. The command palette already offers a "New thread in..." submenu
  // for multi-project setups.
  const handleNewThreadClick = useCallback(
    (event?: ReactMouseEvent) => {
      // One project: nothing to pick, create immediately. Shift+click creates
      // directly in the current project even with several projects, skipping
      // the palette picker.
      if (shouldCreateNewThreadInCurrentProject(event?.shiftKey ?? false, projectGroups.length)) {
        if (isMobile) setOpenMobile(false);
        void startNewThreadFromContext({
          activeDraftThread: newThreadContext.activeDraftThread,
          activeThread: newThreadContext.activeThread ?? undefined,
          defaultProjectRef: newThreadContext.defaultProjectRef,
          handleNewThread: newThreadContext.handleNewThread,
        });
        return;
      }
      if (isMobile) setOpenMobile(false);
      openCommandPalette({ open: "new-thread-in" });
    },
    [isMobile, newThreadContext, projectGroups.length, setOpenMobile],
  );

  // The button mirrors chat.new: in multi-project setups both route through
  // the command palette's "New thread in..." picker, and in single-project
  // setups both create immediately. In multi-project setups the label is only
  // the picker's shortcut: falling back to chat.newLocal would advertise the
  // same shortcut for both the picker and direct create. In single-project
  // setups both commands create directly, so chat.newLocal is a valid
  // fallback. The second tooltip line (multi-project only) advertises
  // shift+click and its keyboard twin chat.newLocal for direct create.
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.new") ??
    (projectGroups.length <= 1 ? shortcutLabelForCommand(keybindings, "chat.newLocal") : undefined);
  const newThreadInProjectShortcutLabel = shortcutLabelForCommand(keybindings, "chat.newLocal");
  // The menu's top: the person's Chief, as the open menu's row or the rail's tile — once it exists
  // or is being set up. Before that the account menu offers it (`useChiefSetupEntry`), and its place
  // holds the mark, with what waits on the person beside it (`SidebarChiefPlace`).
  const zeropsChiefShown =
    zeropsSignedIn &&
    chiefTopShown({
      // With no Chief remembered (a first visit) its row comes with the menu's fill, not alone
      // in the moment HQ's directory names it.
      own:
        zeropsListHeld && !chiefStoodAtFirst
          ? undefined
          : zeropsChief === undefined
            ? paintedChief
            : zeropsChief.project.id,
      setup: chiefSetupLine,
    });
  const zeropsChiefTop = (tile: boolean) =>
    zeropsChiefShown ? (
      <SidebarChiefTop
        chief={zeropsChief}
        coming={zeropsChief === undefined ? undefined : zeropsComing(zeropsChief)}
        conversationsRead={
          zeropsChief !== undefined && zeropsConversationsRead(zeropsChief) === true
        }
        currentMate={zeropsChief !== undefined && litZeropsProjectId === zeropsChief.project.id}
        currentPage={zeropsChiefPageOpen}
        onOpenMate={onZeropsSelect}
        onOpenPage={openChiefPage}
        setup={chiefSetupLine}
        tile={tile}
        timestampFormat={timestampFormat}
        waiting={
          zeropsListHeld ? undefined : { items: zeropsWaiting.items, verbs: zeropsWaitingVerbs }
        }
      />
    ) : undefined;
  // Search and the +, on the open menu's top row and under the rail's Chief.
  const zeropsJump = (
    <SidebarJumpButton
      onJump={() => {
        // A phone's menu steps aside for the box, and comes back
        // to show what is found in it (`SidebarRevealBridge`).
        if (isMobile) setOpenMobile(false);
        openCommandPalette();
      }}
      shortcut={shortcutLabelForCommand(keybindings, "commandPalette.toggle") ?? undefined}
    />
  );
  const zeropsCreate = zeropsSignedIn ? (
    <SidebarCreateButton
      onNewMate={onZeropsNewMate}
      onNewAutomatedMates={onZeropsNewAutomatedMates}
      onNewProject={roleOffered.newProject ? openNewZeropsProject : undefined}
      projects={zeropsMateProjects}
      why={zeropsAddMateWhy}
    />
  ) : null;
  // The closed menu on a desktop; the open one stays drawn under it (`SidebarStage`).
  const zeropsRail = isMobile ? null : (
    <SidebarRail
      account={
        <SidebarZeropsAccountRow
          chiefIcon={<Building2Icon />}
          collapsed
          destinationIcon={sidebarAccountDestinationIcon}
        />
      }
      actions={
        rosterOnly ? (
          <>
            {zeropsJump}
            {zeropsCreate}
          </>
        ) : undefined
      }
      activeProjectId={zeropsOverviewOpen ? null : litZeropsProjectId}
      chief={zeropsChiefTop(true)}
      headline={zeropsHeadline}
      onFold={zeropsRailTiles.fold}
      onOpenMenu={() => {
        setOpen(true);
      }}
      onOverview={navigateToZeropsProjects}
      onSelect={zeropsWaitingVerbs.onOpenMate}
      openShortcut={shortcutLabelForCommand(keybindings, "sidebar.toggle") ?? undefined}
      overviewCurrent={zeropsOverviewOpen}
      showMark={!(isElectron && isMacPlatform(navigator.platform))}
      tiles={zeropsRailTiles.tiles}
      verbs={zeropsWaitingVerbs}
      waiting={zeropsWaiting.items}
    />
  );
  return (
    <SidebarStage rail={zeropsRail} railHolds={zeropsRailTiles.tiles.length}>
      <SidebarChromeHeader
        brand={
          zeropsChiefTop(false) ??
          (zeropsSignedIn ? (
            // The Chief's place while there is none: the mark, and what waits on the person.
            <SidebarChiefPlace
              waiting={
                zeropsListHeld
                  ? undefined
                  : { items: zeropsWaiting.items, verbs: zeropsWaitingVerbs }
              }
            />
          ) : undefined)
        }
        isElectron={isElectron}
        status={
          zeropsHqOutage === null ? undefined : (
            <SidebarHqStatus
              compact={zeropsSignedIn}
              kind={zeropsHqOutage.kind}
              line={zeropsHqOutage.line}
              onAgain={zeropsHqOutage.again ? zeropsRetry : undefined}
            />
          )
        }
        actions={
          // Every environment is in the roster: there is no thread list to
          // search, and the jump box finds anything the menu holds. A new Mate
          // or project is the +'s.
          rosterOnly ? (
            <>
              <SidebarScopeButton onScope={setZeropsMateScope} scope={zeropsMateScope} />
              {zeropsJump}
              {zeropsCreate}
            </>
          ) : undefined
        }
      />
      <SidebarContent
        fixedHeader={
          rosterOnly ? undefined : (
            // Lifted above the stage backdrop, whose fade bleeds below the
            // header and would otherwise paint across the search row's outline.
            <SidebarGroup className="z-[1] gap-1">
              <div className="flex items-center gap-1">
                <SidebarThreadSearchField
                  threadSearchInputRef={threadSearchInputRef}
                  threadSearchQuery={threadSearchQuery}
                  setThreadSearchQuery={setThreadSearchQuery}
                  setActiveSearchResultIndex={setActiveSearchResultIndex}
                  handleThreadSearchKeyDown={handleThreadSearchKeyDown}
                  isSearchingThreads={isSearchingThreads}
                  threadSearchResults={threadSearchResults}
                  activeSearchResultIndex={activeSearchResultIndex}
                  threadSearch={threadSearch}
                  clearThreadSearch={clearThreadSearch}
                />
                <SidebarNewThreadButton
                  handleNewThreadClick={handleNewThreadClick}
                  projects={projects}
                  projectGroups={projectGroups}
                  newThreadShortcutLabel={newThreadShortcutLabel}
                  newThreadInProjectShortcutLabel={newThreadInProjectShortcutLabel}
                />
              </div>
              {projectGroups.length > 0 ? (
                <SidebarProjectScopeRow
                  projectGroups={projectGroups}
                  projectScopeMenuOpen={projectScopeMenuOpen}
                  setProjectScopeMenuOpen={setProjectScopeMenuOpen}
                  scopedProjectGroup={scopedProjectGroup}
                  projectScopeKey={projectScopeKey}
                  setProjectScopeKey={setProjectScopeKey}
                  openAddProjectSourcePicker={openAddProjectSourcePicker}
                  handleProjectSettings={handleProjectSettings}
                  roleOffered={roleOffered}
                  openNewZeropsProject={openNewZeropsProject}
                />
              ) : null}
            </SidebarGroup>
          )
        }
      >
        <SidebarGroup className="ps-[calc(var(--sidebar-content-inset)+1px)] pe-[var(--sidebar-content-inset)] pb-1 pt-0">
          {zeropsSignedIn && !isSearchingThreads ? (
            <SidebarZeropsTree
              hold={zeropsListHeld}
              onShowEveryone={zeropsMateScope === "mine" ? showEveryoneMates : undefined}
              activeProjectId={litZeropsProjectId}
              activeProjectResolving={activeZeropsProjectResolving && !zeropsPressHeld}
              activeConversation={litZeropsConversation}
              births={zeropsPlacedBirths}
              candidates={zeropsListed}
              complete={zeropsMenuComplete}
              notice={zeropsNotice}
              reading={zeropsSession.organizationStatus === "selected" && !zeropsMenuComplete}
              onNoticeAct={onZeropsNoticeAct}
              onAddMate={addMate}
              onAddAutomatedMates={onZeropsNewAutomatedMates}
              onInvite={teamOffered.invite ? inviteToProject : undefined}
              onSetUp={onZeropsSetUp}
              getComing={zeropsListedComing}
              onOpenComing={openComingMate}
              onBrowseProjects={navigateToZeropsProjects}
              onAskToFix={zeropsRowVerbs.askToFix}
              getFlow={zeropsSidebarFlowWithPages}
              getOwner={zeropsMateOwner}
              getMateActions={zeropsListedActions}
              getBirth={zeropsMateMenus.getBirth}
              shown={zeropsShown}
              platformProject={zeropsPlatformProject}
              showPlatformProjects={zeropsPlatformProjects === "shown"}
              onShowPlatformProjects={showZeropsPlatformProjects}
              timestampFormat={timestampFormat}
              onOpenGroup={openGroup}
              getActivity={zeropsRowActivity}
              keyedReadings
              getConversationsRead={zeropsConversationsRead}
              onSelect={zeropsRowVerbs.select}
              onOpenCrew={zeropsRowVerbs.openCrew}
            />
          ) : null}
          {/* The dialogs a Mate's own menu opens: rename, hand over, move. */}
          {zeropsSignedIn ? zeropsMateMenus.dialogs : null}
          {isSearchingThreads ? (
            threadSearchResults.length > 0 ? (
              <TooltipProvider
                key="sidebar-thread-search-tooltips-150"
                delay={150}
                closeDelay={0}
                timeout={400}
              >
                <SidebarProjectTree
                  branches={[]}
                  searchResults={threadSearchResults}
                  activeThreadKey={routeThreadKey}
                  collapsedProjectKeys={collapsedProjectKeys}
                  collapsedMemberKeys={collapsedProjectMemberKeys}
                  getThreadKey={(thread) =>
                    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
                  }
                  onToggleProject={toggleProjectBranch}
                  onToggleMember={toggleProjectMemberBranch}
                  renderThread={() => null}
                  renderSearchResult={(thread, index) => {
                    const threadKey = scopedThreadKey(
                      scopeThreadRef(thread.environmentId, thread.id),
                    );
                    return (
                      <SidebarSearchResultRow
                        key={threadKey}
                        thread={thread}
                        projectCwd={
                          projectCwdByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                        }
                        projectFaviconPath={
                          projectFaviconPathByKey.get(
                            `${thread.environmentId}:${thread.projectId}`,
                          ) ?? null
                        }
                        projectTitle={
                          projectDisplayNameByKey.get(
                            `${thread.environmentId}:${thread.projectId}`,
                          ) ?? null
                        }
                        environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                        providerEntryByInstanceId={
                          providerEntriesByEnvironment.get(thread.environmentId) ??
                          EMPTY_PROVIDER_ENTRIES
                        }
                        isHighlighted={activeSearchResultIndex === index}
                        isRouteActive={routeThreadKey === threadKey}
                        resultId={`sidebar-thread-search-result-${index}`}
                        searchMatch={
                          threadSearchMatchByKey.get(
                            threadSearchMatchKey({
                              environmentId: thread.environmentId,
                              threadId: thread.id,
                            }),
                          ) ?? null
                        }
                        searchQuery={threadSearchQuery}
                        onHighlight={() => setActiveSearchResultIndex(index)}
                        onSelect={() => selectThreadSearchResult(thread)}
                      />
                    );
                  }}
                />
              </TooltipProvider>
            ) : (
              <SidebarThreadSearchEmpty threadSearch={threadSearch} />
            )
          ) : null}
          {!isSearchingThreads ? (
            <TooltipProvider
              key="sidebar-thread-tooltips-150"
              delay={150}
              closeDelay={0}
              timeout={400}
            >
              <ul role="list" className="flex flex-col gap-px">
                {(() => {
                  const renderThreadRow = (thread: EnvironmentThreadShell, section: "active") => {
                    const threadKey = scopedThreadKey(
                      scopeThreadRef(thread.environmentId, thread.id),
                    );
                    return (
                      <SidebarThreadRow
                        key={threadKey}
                        thread={thread}
                        isActive={routeThreadKey === threadKey}
                        jumpLabel={
                          showThreadJumpHints ? (jumpLabelByKey.get(threadKey) ?? null) : null
                        }
                        currentEnvironmentId={primaryEnvironmentId}
                        environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                        projectCwd={
                          projectCwdByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                        }
                        projectFaviconPath={
                          projectFaviconPathByKey.get(
                            `${thread.environmentId}:${thread.projectId}`,
                          ) ?? null
                        }
                        projectTitle={
                          projectDisplayNameByKey.get(
                            `${thread.environmentId}:${thread.projectId}`,
                          ) ?? null
                        }
                        showProjectIdentity={shouldShowProjectIdentityInSidebarSection(section)}
                        providerEntryByInstanceId={
                          providerEntriesByEnvironment.get(thread.environmentId) ??
                          EMPTY_PROVIDER_ENTRIES
                        }
                        timestampFormat={timestampFormat}
                        onThreadClick={handleThreadClick}
                        onThreadActivate={navigateToThread}
                        onStartRename={startThreadRename}
                        onRenameTitleChange={setRenamingTitle}
                        onCommitRename={commitThreadRename}
                        onCancelRename={cancelThreadRename}
                        isRenaming={renamingThreadKey === threadKey}
                        renamingTitle={renamingThreadKey === threadKey ? renamingTitle : ""}
                        onContextMenu={handleThreadContextMenu}
                        changeRequestSnapshot={changeRequestSnapshotByKey.get(threadKey) ?? null}
                        onChangeRequestSnapshot={setThreadChangeRequestSnapshot}
                      />
                    );
                  };
                  // Drafts remain global. Live work is grouped by the hierarchy
                  // the shell can prove: logical project, then its physical
                  // environment/workspace member, then that member's threads.
                  const items: ReactNode[] = [
                    <SidebarDraftBlock
                      key="draft-sessions"
                      projectDisplayNameByKey={projectDisplayNameByKey}
                      scopedProjectKeys={scopedProjectKeys}
                      hiddenEnvironmentIds={zeropsEnvironmentIds}
                      routeDraftId={routeDraftIdForRows}
                      onNavigateToDraft={navigateToDraft}
                    />,
                    <SidebarProjectTree
                      key="project-thread-tree"
                      branches={projectThreadBranches}
                      searchResults={null}
                      activeThreadKey={routeThreadKey}
                      collapsedProjectKeys={collapsedProjectKeys}
                      collapsedMemberKeys={collapsedProjectMemberKeys}
                      getThreadKey={({ thread }) =>
                        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
                      }
                      onToggleProject={toggleProjectBranch}
                      onToggleMember={toggleProjectMemberBranch}
                      getCompactThreadShortcut={(threads) =>
                        threads.find(({ thread }) => {
                          const threadKey = scopedThreadKey(
                            scopeThreadRef(thread.environmentId, thread.id),
                          );
                          return (
                            isUntouchedSidebarThread(thread) && renamingThreadKey !== threadKey
                          );
                        }) ?? null
                      }
                      renderWorkspaceThreadAction={({ member, workspaceName }) => {
                        const action = resolveWorkspaceNewThreadAction(
                          member.threads,
                          ({ thread }) => isUntouchedSidebarThread(thread),
                        );
                        if (action.kind === "create") {
                          const label = `New thread in ${workspaceName}`;
                          return (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={label}
                                    className="mr-1 shrink-0 text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
                                    onClick={() => {
                                      if (isMobile) setOpenMobile(false);
                                      void newThreadContext.handleNewThread(
                                        scopeProjectRef(member.environmentId, member.projectId),
                                      );
                                    }}
                                  />
                                }
                              >
                                <SquarePenIcon aria-hidden />
                              </TooltipTrigger>
                              <TooltipPopup side="right">{label}</TooltipPopup>
                            </Tooltip>
                          );
                        }

                        const { thread } = action.thread;
                        const threadRef = scopeThreadRef(thread.environmentId, thread.id);
                        const threadKey = scopedThreadKey(threadRef);
                        const label = `New thread in ${workspaceName}`;
                        const renderShortcut = () => (
                          <Tooltip key={`compact-thread:${threadKey}`}>
                            <TooltipTrigger
                              render={
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={label}
                                  aria-current={routeThreadKey === threadKey ? "page" : undefined}
                                  className={cn(
                                    "mr-1 shrink-0 text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground",
                                    routeThreadKey === threadKey &&
                                      "bg-sidebar-row-active text-sidebar-foreground",
                                  )}
                                  onClick={(event) => handleThreadClick(event, threadRef)}
                                  onDoubleClick={(event) => {
                                    if (
                                      event.metaKey ||
                                      event.ctrlKey ||
                                      event.shiftKey ||
                                      event.altKey
                                    ) {
                                      return;
                                    }
                                    event.preventDefault();
                                    event.stopPropagation();
                                    startThreadRename(threadRef, thread.title);
                                  }}
                                  onContextMenu={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleThreadContextMenu(threadRef, {
                                      x: event.clientX,
                                      y: event.clientY,
                                    });
                                  }}
                                />
                              }
                            >
                              <SquarePenIcon aria-hidden />
                            </TooltipTrigger>
                            <TooltipPopup side="right">{label}</TooltipPopup>
                          </Tooltip>
                        );

                        return renderShortcut();
                      }}
                      renderThread={({ thread, sidebarSection }) => {
                        return renderThreadRow(thread, sidebarSection);
                      }}
                    />,
                  ];
                  return items;
                })()}
              </ul>
            </TooltipProvider>
          ) : null}
          {!isSearchingThreads &&
          // A Zerops account whose every environment is in the roster has no
          // tree to be empty; the roster carries its own empty states.
          (!zeropsSignedIn || projectGroups.length > 0) &&
          visibleDraftSessionCount === 0 &&
          activeThreads.length === 0 ? (
            <SidebarThreadListEmpty
              projectGroups={projectGroups}
              roleOffered={roleOffered}
              openNewZeropsProject={openNewZeropsProject}
              scopedProjectGroup={scopedProjectGroup}
            />
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      {/* Account notices sit above the pinned footer controls; without one,
          only the normal list-to-footer gutter remains. */}
      {zeropsSignedIn ? <AccountVoiceLine /> : null}
      <SidebarChromeFooter />
    </SidebarStage>
  );
}

import { ownChiefCandidateAtom } from "~/zerops/useZeropsCandidates";
import {
  shownHqMateDirectoryAtom,
  isListedMateEnvironment,
  shownCanonicalHqListNavigationAtom,
} from "@t3tools/client-runtime/data";
import { autoAnimate } from "@formkit/auto-animate";
import { useAtomValue } from "@effect/atom-react";
import { shownHqPersonFactsAtom, mateLimitAtom } from "@t3tools/client-runtime/data";
import {
  threadSearchMatchKey,
  type EnvironmentThreadSearchMatch,
} from "@t3tools/client-runtime/state/thread-search";
import { arrayElementsEqual } from "@t3tools/client-runtime/state/entities";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { hasUnseenCompletion, resolveThreadStatus } from "@t3tools/shared/threadStatus";
import {
  Building2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import {
  memo,
  startTransition,
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
import { subscribeSecond } from "../lib/secondTicker";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isMacPlatform } from "~/lib/utils";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { releaseComposerDraftUploads } from "../lib/composerDraftUploads";
import { stripInlinePicturePlaceholders } from "../lib/composerPictures";
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
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import {
  useAllEnvironmentProjectSnapshotsReady,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { environmentServerConfigsAtom, primaryServerKeybindingsAtom } from "../state/server";
import { hqDownSinceAtom } from "../state/zerops";
import { vcsEnvironment } from "../state/vcs";
import { threadEnvironment } from "../state/threads";
import { useEnvironmentQuery } from "../state/query";
import { useThreadSearch } from "../state/queries";
import { useMateCommand } from "../zerops/accountEnvironments";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { SidebarThreadSummary } from "../types";
import { cn } from "~/lib/utils";
import { buildThreadActionMenuItems } from "./threadActionMenu.logic";
import {
  buildBulkTitleRegenerationContextMenuItem,
  formatWorkingDurationLabel,
  isSidebarNestedLinkClick,
  isUntouchedSidebarThread,
  isTrailingDoubleClick,
  orderItemsByPreferredIds,
  openAddProjectFromSidebar,
  openMenuMate,
  resolveAdjacentThreadId,
  resolveThreadRowLayoutPresentation,
  resolveThreadProviderIconClassName,
  resolveWorkspaceNewThreadAction,
  searchSidebarThreads,
  shouldCreateNewThreadInCurrentProject,
  resolveWorkingStartedAt,
  sortLogicalProjectsForSidebar,
  sortThreadsForSidebar,
  shouldShowProjectIdentityInSidebarSection,
  threadStatusRowPresentation,
  useThreadJumpHintVisibility,
  compactSidebarTimeLabel,
} from "./Sidebar.logic";
import { resolveLocalCheckoutBranchMismatch } from "./BranchToolbar.logic";
import {
  LinkedPullRequestLink,
  ThreadWorktreeIndicator,
  linkedPullRequestIndicator,
  nextThreadChangeRequestSnapshot,
  prStatusIndicator,
  resolveDisplayedThreadPr,
  resolveDisplayedThreadPrProvider,
  setThreadChangeRequestSnapshot,
  synchronizeTerminalPulse,
  terminalStatusFromRunningIds,
  threadChangeRequestSnapshotsAtom,
  type ThreadChangeRequestSnapshot,
  type TerminalStatusIndicator,
} from "./ThreadStatusIndicators";
import { ProjectFavicon } from "./ProjectFavicon";
import { ThreadSearchMatchExcerpt } from "./ThreadSearchMatch";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "./chat/providerIconUtils";
import {
  deriveProviderEntriesByEnvironment,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { useThreadRunningTerminalIds } from "../state/terminalSessions";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import {
  SidebarContent,
  SidebarGroup,
  SidebarInput,
  SidebarMenuButton,
  useSidebar,
} from "./ui/sidebar";
import {
  SidebarChromeFooter,
  SidebarChromeHeader,
  SidebarCreateButton,
  sidebarAccountDestinationIcon,
} from "./sidebar/SidebarChrome";
import { newMateView, useAddAutomatedMates, useAddMate } from "../zerops/newMate";
import { useAutomatedKey } from "../zerops/useAutomationSettings";
import { useAddMateOffer } from "../zerops/useHqOffers";
import { useOpenPutLive, usePutLive } from "../zerops/putLive";
import { putLiveHoldsRelease } from "../zerops/putLive.logic";
import { useSetUpEnvironment } from "../zerops/setUpEnvironment";
import { useAskNewProject } from "../zerops/newProjectAsk";
import { useRoleOffers, useTeamOffers } from "../zerops/usePlatformCapabilities";
import { useCreations } from "../zerops/creations";
import { newProjectView, placedNewProjects } from "../zerops/newProjectBirth";
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
import { hqOutage, useHqServiceUrl } from "../zerops/hqNavigation";
import { useAccountDataOptional } from "../zerops/ZeropsAccountData";
import { useNowMs } from "../zerops/useNowMs";
import { SidebarProjectTree } from "./sidebar/SidebarProjectTree";
import {
  SidebarHqStatus,
  SidebarZeropsTree,
  type SidebarProjectFlow,
  type SidebarZeropsTreeProps,
} from "./zerops/SidebarZeropsTree";
import { releaseFailureOf, rollbacksOf } from "./zerops/SidebarProductionChip.logic";
import { useMatesActivity } from "../zerops/useZeropsAgentActivity";
import { useSidebarMateMenus } from "../zerops/useSidebarMateMenus";
import { useHqMatesRead } from "../zerops/useHqMatesRead";
import { menuPressHeld, type MenuPress } from "./zerops/menuPress.logic";
import { menuDrawsLoadingRows } from "./zerops/SidebarProjects.logic";
import { useSidebarWaiting } from "../zerops/useSidebarWaiting";
import { shownInScope, useMateScope } from "../zerops/mateScope";
import { SidebarScopeButton } from "./zerops/SidebarScopeButton";
import { SidebarJumpButton } from "./zerops/SidebarJumpButton";
import { openCrewTab } from "../zerops/crew/crewTab";
import { useOpenMate } from "../zerops/useOpenMate";
import { overviewProjectsOf, useMenuProjects, useOverviewKey } from "./zerops/SidebarOverview";
import { overviewHeadline } from "./zerops/SidebarOverview.logic";
import { useChiefSetupLine } from "~/zerops/chiefSetup";
import { useOwnChief } from "~/zerops/ownChief";
import { chiefTopShown } from "./zerops/chief/chiefTop.logic";
import { useAccountHq } from "~/zerops/accountHq";
import { SidebarChiefPlace } from "./zerops/chief/SidebarChiefRow";
import { SidebarChiefTop } from "./zerops/chief/SidebarChiefTop";
import { SidebarRail, useRailTiles } from "./zerops/SidebarRail";
import { SidebarStage } from "./zerops/SidebarStage";
import { SidebarZeropsAccountRow } from "./zerops/SidebarZeropsAccount";

import { useProjectFlows } from "../zerops/projectFlows";
import { placedPressesIn, useForgetConnectedPresses, useMatePresses } from "../zerops/matePress";
import type { CanonicalEnvironmentRow } from "@t3tools/client-runtime/zerops";
import {
  candidatesNotice,
  findCandidate,
  heldCandidates,
} from "@t3tools/client-runtime/zerops/projections";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { MiddleTruncate } from "./ui/middle-truncate";
import {
  composerDraftHasUserContent,
  DraftId,
  useComposerDraftStore,
  type ComposerThreadDraftState,
  type DraftSessionState,
} from "../composerDraftStore";
import { Kbd } from "./ui/kbd";

function threadTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = thread.latestUserMessageAt ?? thread.updatedAt;
  return compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

// Floats at the row's right edge, vertically centered, while the jump
// modifier is held. An overlay pill instead of an inline slot: the hint
// must neither displace the status/time label (holding ⌘ used to blank
// out "Working") nor shift the layout when it appears.
export function JumpHintBadge(props: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1.5 top-1/2 z-10 -translate-y-1/2"
    >
      <Kbd>{props.label}</Kbd>
    </span>
  );
}

// Self-ticking so only this span re-renders each second, not the whole row — on the one second
// clock (`subscribeSecond`), with every other counting duration.
function WorkingDuration(props: { startedAt: string | null }) {
  const startedMs = props.startedAt !== null ? Date.parse(props.startedAt) : Number.NaN;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (Number.isNaN(startedMs)) return;
    return subscribeSecond(() => setTick((tick) => tick + 1));
  }, [startedMs]);
  if (Number.isNaN(startedMs)) return null;
  return <span className="tabular-nums">{formatWorkingDurationLabel(Date.now() - startedMs)}</span>;
}

const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, ProviderInstanceEntry> = new Map();

function terminalProcessLabel(count: number): string {
  return `${count} terminal ${count === 1 ? "process" : "processes"} running`;
}

function SidebarThreadTooltip({
  thread,
  projectTitle,
  projectCwd,
  projectFaviconPath,
  environmentLabel,
  providerEntry,
  showInstanceBadge,
  modelInstanceId,
  modelLabel,
  branchMismatch,
  terminalStatus,
  terminalProcessCount,
}: {
  thread: SidebarThreadSummary;
  projectTitle: string | null;
  projectCwd: string | null;
  projectFaviconPath: string | null;
  environmentLabel: string | null;
  providerEntry: ProviderInstanceEntry | null;
  showInstanceBadge: boolean;
  modelInstanceId: string;
  modelLabel: string;
  branchMismatch: {
    threadBranch: string;
    currentBranch: string;
  } | null;
  terminalStatus: TerminalStatusIndicator | null;
  terminalProcessCount: number;
}) {
  const driverKind = providerEntry?.driverKind ?? null;
  return (
    <TooltipPopup side="right" align="start" sideOffset={4} variant="glass">
      {/* The viewport's own inset (py-1 px-2) plus this one make the floating inset. */}
      <div className="flex min-w-0 max-w-80 flex-col gap-2 px-1 py-2">
        <div className="min-w-0 truncate text-xs leading-tight font-medium text-foreground">
          {thread.title}
        </div>
        <div className="grid gap-1.5 pl-0.5 text-xs text-muted-foreground">
          {projectTitle ? (
            <div className="flex min-w-0 items-center gap-2">
              <ProjectFavicon
                environmentId={thread.environmentId}
                cwd={projectCwd ?? ""}
                faviconPath={projectFaviconPath}
                className="size-3 shrink-0 stroke-muted-foreground"
              />
              <div className="min-w-0 truncate text-foreground/75">{projectTitle}</div>
            </div>
          ) : null}
          {environmentLabel ? (
            <div className="flex min-w-0 items-center gap-2">
              <ServerIcon className="size-3 shrink-0 stroke-muted-foreground" />
              <div className="min-w-0 truncate text-foreground/75">{environmentLabel}</div>
            </div>
          ) : null}
          {thread.branch ? (
            <div className="flex min-w-0 items-center gap-2 text-foreground/75">
              <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
              <MiddleTruncate value={thread.branch} className="flex" />
            </div>
          ) : null}
          {branchMismatch ? (
            <div className="flex min-w-0 items-start gap-2 text-warning">
              <CircleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
              <div className="min-w-0 flex-1 wrap-break-word leading-5">
                You're currently checked out on another branch.
              </div>
            </div>
          ) : null}
          {driverKind ? (
            <div className="flex min-w-0 items-center gap-2">
              <ProviderInstanceIcon
                driverKind={driverKind}
                displayName={
                  providerEntry?.displayName ?? thread.session?.providerName ?? modelInstanceId
                }
                accentColor={providerEntry?.accentColor}
                // Initials would swallow a size-3 glyph: accent dot, name in label.
                showBadge={showInstanceBadge && providerEntry?.accentColor !== undefined}
                badgeContent="none"
                badgeClassName="h-2 min-w-2 px-0"
                iconClassName="size-3 shrink-0 grayscale opacity-60"
              />
              <div className="min-w-0 truncate text-foreground/75">
                {showInstanceBadge && providerEntry
                  ? `${modelLabel} · ${providerEntry.displayName}`
                  : modelLabel}
              </div>
            </div>
          ) : null}
          {terminalStatus ? (
            <div className="flex min-w-0 items-center gap-2">
              <TerminalIcon
                aria-hidden
                className={cn("size-3 shrink-0", terminalStatus.colorClass)}
              />
              <div className="min-w-0 truncate text-foreground/75">
                {terminalProcessLabel(terminalProcessCount)}
              </div>
            </div>
          ) : null}
          {thread.session?.lastError ? (
            <div className="flex min-w-0 items-center gap-2 text-destructive-foreground">
              <CircleAlertIcon className="size-3 shrink-0 stroke-current" />
              <div className="min-w-0 truncate">Error occurred</div>
            </div>
          ) : null}
        </div>
      </div>
    </TooltipPopup>
  );
}

// One unsent draft session the user has invested content in. Two lines,
// nothing else: project name, then the typed prompt. All the draft's
// settings (model, env mode, branch, worktree) still travel with it —
// clicking is a plain navigation to /draft/$draftId, which touches nothing.
// While the draft is open the row renders a frozen snapshot (see
// SidebarDraftBlock); memoized so per-keystroke block re-renders skip it
// entirely.
export const SidebarDraftRow = memo(function SidebarDraftRow(props: {
  draftId: DraftId;
  composer: ComposerThreadDraftState;
  projectTitle: string | null;
  isActive: boolean;
  onNavigate: (draftId: DraftId) => void;
  onDiscard: (draftId: DraftId) => void;
}) {
  const { composer, draftId, onDiscard, onNavigate } = props;
  const promptPreview =
    stripInlinePicturePlaceholders(composer.prompt).trim().split("\n", 1)[0] ?? "";
  // images mirrors persistedAttachments once rehydration finishes; before
  // that only the persisted list is populated, hence max not sum.
  const attachmentCount =
    Math.max(composer.images.length, composer.persistedAttachments.length) +
    composer.terminalContexts.length +
    composer.reviewComments.length;
  const preview =
    promptPreview.length > 0
      ? promptPreview
      : `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`;
  const handleActivate = useCallback(() => onNavigate(draftId), [draftId, onNavigate]);
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      // Keys targeting the nested discard button belong to the button:
      // preventDefault here would swallow Space's synthesized click and
      // navigate instead of discarding.
      if ((event.target as HTMLElement).closest("button")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onNavigate(draftId);
      }
    },
    [draftId, onNavigate],
  );
  const handleDiscard = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onDiscard(draftId);
    },
    [draftId, onDiscard],
  );
  return (
    <li className="list-none">
      <div
        role="button"
        tabIndex={0}
        data-testid="sidebar-draft-row"
        className={cn(
          "group/sidebar-row menu-draft relative w-full cursor-pointer text-left text-sidebar-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          props.isActive ? "bg-sidebar-row-active" : "hover:bg-sidebar-row-hover",
        )}
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
      >
        <span className="flex justify-center">
          <SquarePenIcon aria-hidden className="size-4 text-muted-foreground" />
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">Draft</span>
            <span className="text-muted-foreground">
              {` · ${props.projectTitle ? `${props.projectTitle} · ${preview}` : preview}`}
            </span>
          </span>
          <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-end">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Discard draft"
                    onClick={handleDiscard}
                    className="pointer-events-none inline-flex cursor-pointer items-center rounded-md bg-transparent px-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100"
                  >
                    <XIcon className="size-3" />
                  </button>
                }
              />
              <TooltipPopup side="top">Discard draft</TooltipPopup>
            </Tooltip>
          </span>
        </div>
      </div>
    </li>
  );
});

interface SidebarDraftRowData {
  draftId: DraftId;
  session: DraftSessionState;
  composer: ComposerThreadDraftState;
}

// Draft sessions with user content, surfaced above the pinned block so an
// interrupted "new thread" stays one click away. Self-contained (own store
// subscription) so per-keystroke composer updates
// re-render only this block, never the whole sidebar. Vanishes at count 0.
const SidebarDraftBlock = memo(function SidebarDraftBlock(props: {
  projectDisplayNameByKey: ReadonlyMap<string, string>;
  scopedProjectKeys: ReadonlySet<string> | null;
  /** Environments whose drafts are their roster row, not a row of their own. */
  hiddenEnvironmentIds: ReadonlySet<EnvironmentId>;
  routeDraftId: string | null;
  onNavigateToDraft: (draftId: DraftId) => void;
}) {
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftsByThreadKey = useComposerDraftStore((store) => store.draftsByThreadKey);
  const clearDraftThread = useComposerDraftStore((store) => store.clearDraftThread);
  // The open draft's row is FROZEN at the moment the draft became the route:
  // it stays visible (like a thread row) but never repaints while the user
  // types. A draft that was never navigated away from has no snapshot to
  // freeze, so a fresh typing session shows no row at all. Captured
  // synchronously on route change (setState-during-render derived state) so
  // the row never flickers out for a frame between route change and capture.
  const [frozenActive, setFrozenActive] = useState<{
    routeDraftId: string | null;
    row: SidebarDraftRowData | null;
  }>({ routeDraftId: null, row: null });
  if (frozenActive.routeDraftId !== props.routeDraftId) {
    let row: SidebarDraftRowData | null = null;
    if (props.routeDraftId !== null) {
      const draftId = DraftId.make(props.routeDraftId);
      const store = useComposerDraftStore.getState();
      const session = store.getDraftSession(draftId);
      const composer = store.getComposerDraft(draftId);
      row =
        session && session.promotedTo == null && composer && composerDraftHasUserContent(composer)
          ? { draftId, session, composer }
          : null;
    }
    setFrozenActive({ routeDraftId: props.routeDraftId, row });
  }
  const drafts = useMemo(() => {
    const rows: SidebarDraftRowData[] = [];
    // Every non-promoted session with content gets a row, mapped or not:
    // new-thread surfaces mint fresh drafts and leave invested ones behind
    // unmapped, so the mapping only knows about the latest per project.
    for (const [draftKey, session] of Object.entries(draftThreadsByThreadKey)) {
      if (session.promotedTo != null) {
        continue;
      }
      if (props.hiddenEnvironmentIds.has(session.environmentId)) {
        continue;
      }
      if (
        props.scopedProjectKeys !== null &&
        !props.scopedProjectKeys.has(`${session.environmentId}:${session.projectId}`)
      ) {
        continue;
      }
      if (draftKey === props.routeDraftId) {
        // Open draft: render the frozen entry snapshot, or nothing for a
        // draft that has never been left. Gated on the LIVE session above so
        // send/discard still removes the row immediately.
        if (frozenActive.routeDraftId === draftKey && frozenActive.row !== null) {
          rows.push(frozenActive.row);
        }
        continue;
      }
      const composer = draftsByThreadKey[draftKey];
      if (!composer || !composerDraftHasUserContent(composer)) {
        continue;
      }
      rows.push({ draftId: DraftId.make(draftKey), session, composer });
    }
    rows.sort((left, right) => right.session.createdAt.localeCompare(left.session.createdAt));
    return rows;
  }, [
    draftThreadsByThreadKey,
    draftsByThreadKey,
    frozenActive,
    props.hiddenEnvironmentIds,
    props.routeDraftId,
    props.scopedProjectKeys,
  ]);
  const handleDiscard = useCallback(
    (draftId: DraftId) => {
      // The /draft/$draftId route redirects home on its own when the draft
      // it renders disappears, so discarding the open draft needs no
      // special-casing here.
      releaseComposerDraftUploads(draftId);
      clearDraftThread(draftId);
    },
    [clearDraftThread],
  );
  if (drafts.length === 0) {
    return null;
  }
  return (
    <>
      {drafts.map(({ composer, draftId, session }) => {
        const projectKey = `${session.environmentId}:${session.projectId}`;
        return (
          <SidebarDraftRow
            key={draftId}
            draftId={draftId}
            composer={composer}
            projectTitle={props.projectDisplayNameByKey.get(projectKey) ?? null}
            isActive={draftId === props.routeDraftId}
            onNavigate={props.onNavigateToDraft}
            onDiscard={handleDiscard}
          />
        );
      })}
    </>
  );
});

const SidebarThreadRow = memo(function SidebarThreadRow(props: {
  thread: SidebarThreadSummary;
  isActive: boolean;
  jumpLabel: string | null;
  currentEnvironmentId: string | null;
  environmentLabel: string | null;
  projectCwd: string | null;
  projectFaviconPath: string | null;
  projectTitle: string | null;
  showProjectIdentity: boolean;
  providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>;
  timestampFormat: TimestampFormat;
  onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  onThreadActivate: (threadRef: ScopedThreadRef) => void;
  onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string, originalTitle: string) => void;
  onCancelRename: () => void;
  isRenaming: boolean;
  renamingTitle: string;
  onContextMenu: (threadRef: ScopedThreadRef, position: { x: number; y: number }) => void;
  changeRequestSnapshot: ThreadChangeRequestSnapshot | null;
  onChangeRequestSnapshot: (
    threadKey: string,
    snapshot: ThreadChangeRequestSnapshot | null,
  ) => void;
}) {
  const {
    isRenaming,
    changeRequestSnapshot,
    onChangeRequestSnapshot,
    onCancelRename,
    onCommitRename,
    onContextMenu,
    onRenameTitleChange,
    onStartRename,
    onThreadActivate,
    onThreadClick,
    renamingTitle,
    thread,
  } = props;
  const threadRef = useMemo(
    () => scopeThreadRef(thread.environmentId, thread.id),
    [thread.environmentId, thread.id],
  );
  const threadKey = scopedThreadKey(threadRef);
  const isRegeneratingTitle = thread.titleRegeneration != null;
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const openPrLink = useOpenPrLink();
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  const terminalProcessCount = runningTerminalIds.length;

  const gitCwd = thread.worktreePath ?? props.projectCwd;
  const linkedPullRequest =
    thread.linkedPullRequest == null ? null : linkedPullRequestIndicator(thread.linkedPullRequest);
  const gitStatus = useEnvironmentQuery(
    thread.linkedPullRequest == null &&
      (thread.branch != null || thread.worktreePath !== null) &&
      gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const retainTerminalOnBranchMismatch = thread.worktreePath === null;
  const pr = resolveDisplayedThreadPr({
    threadBranch: thread.branch,
    gitStatus: gitStatus.data,
    snapshot: changeRequestSnapshot,
    retainTerminalOnBranchMismatch,
    linkedPullRequest: thread.linkedPullRequest,
  });

  // Never-visited counts as read so threads that predate unread tracking do not
  // light up as unread.
  const clientVisit = lastVisitedAt === undefined ? {} : { lastVisitedAt };
  const isUnread = hasUnseenCompletion({ latestTurn: thread.latestTurn, ...clientVisit });
  const limit = useAtomValue(
    mateLimitAtom(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
  );
  const resolvedStatus = resolveThreadStatus({ ...thread, ...clientVisit }, limit.kind);
  const status = resolvedStatus.kind;
  const isWoke = status === "woke";
  // Background work always recedes when it is not selected: an unread parent
  // completion must not pull a still-working thread back into the foreground.
  // Ready and approval rows keep their unread and wake prominence; a thread
  // waiting on the user's input never recedes.
  const isBackgroundWork =
    status === "connecting" || status === "working" || status === "monitoring";
  const awaitsHuman = status === "idle" || status === "approval";
  const shouldRecede =
    !props.isActive &&
    !isSelected &&
    status !== "input" &&
    (isBackgroundWork || (awaitsHuman && !isUnread && !isWoke));
  const topStatus = threadStatusRowPresentation(resolvedStatus, props.isActive);

  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: gitStatus.data?.refName ?? null,
  });
  const prProvider = resolveDisplayedThreadPrProvider({
    threadBranch: thread.branch,
    gitStatus: gitStatus.data,
    snapshot: changeRequestSnapshot,
    retainTerminalOnBranchMismatch,
    linkedPullRequest: thread.linkedPullRequest,
  });
  const prStatus = prStatusIndicator(pr, prProvider);
  useEffect(() => {
    const nextSnapshot = nextThreadChangeRequestSnapshot({
      threadBranch: thread.branch,
      gitStatus: gitStatus.data,
      snapshot: changeRequestSnapshot,
      retainTerminalOnBranchMismatch,
      linkedPullRequest: thread.linkedPullRequest,
    });
    if (nextSnapshot === undefined) return;
    onChangeRequestSnapshot(threadKey, nextSnapshot);
  }, [
    changeRequestSnapshot,
    gitStatus.data,
    onChangeRequestSnapshot,
    retainTerminalOnBranchMismatch,
    thread.branch,
    thread.linkedPullRequest,
    threadKey,
  ]);

  const modelInstanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const driverKind = providerEntry?.driverKind ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : thread.modelSelection.model;

  const isRemote =
    props.currentEnvironmentId !== null && thread.environmentId !== props.currentEnvironmentId;

  const detailsTooltip = (
    <SidebarThreadTooltip
      thread={thread}
      projectTitle={props.projectTitle}
      projectCwd={props.projectCwd}
      projectFaviconPath={props.projectFaviconPath}
      environmentLabel={props.environmentLabel}
      providerEntry={providerEntry}
      showInstanceBadge={showInstanceBadge}
      modelInstanceId={modelInstanceId}
      modelLabel={modelLabel}
      branchMismatch={branchMismatch}
      terminalStatus={terminalStatus}
      terminalProcessCount={terminalProcessCount}
    />
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent) => {
      onThreadClick(event, threadRef);
    },
    [onThreadClick, threadRef],
  );
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      onContextMenu(threadRef, { x: event.clientX, y: event.clientY });
    },
    [onContextMenu, threadRef],
  );
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onThreadActivate(threadRef);
    },
    [onThreadActivate, threadRef],
  );
  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (isRenaming || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if ((event.target as HTMLElement).closest("button, a, input")) return;
      event.preventDefault();
      onStartRename(threadRef, thread.title);
    },
    [isRenaming, onStartRename, thread.title, threadRef],
  );
  const renameCommittedRef = useRef(false);
  useEffect(() => {
    if (isRenaming) renameCommittedRef.current = false;
  }, [isRenaming]);
  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        event.preventDefault();
        renameCommittedRef.current = true;
        onCommitRename(threadRef, renamingTitle, thread.title);
      } else if (event.key === "Escape") {
        event.preventDefault();
        renameCommittedRef.current = true;
        onCancelRename();
      }
    },
    [onCancelRename, onCommitRename, renamingTitle, thread.title, threadRef],
  );
  const handleRenameBlur = useCallback(() => {
    if (!renameCommittedRef.current) {
      onCommitRename(threadRef, renamingTitle, thread.title);
    }
  }, [onCommitRename, renamingTitle, thread.title, threadRef]);
  const handlePrClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      const url = linkedPullRequest?.url ?? pr?.url;
      if (!url) return;
      openPrLink(event, url);
    },
    [linkedPullRequest, openPrLink, pr],
  );

  // All sidebar rows share one surface model. Live threads used to look
  // like elevated cards while settled threads were plain rows, leaving neither
  // a useful hierarchy nor a reliable hover cue. Status now lives in the row
  // content; surface is reserved for interaction (hover, multi-select, route).
  const rowSurfaceClassName = cn(
    "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    props.isActive
      ? "bg-sidebar-row-active text-sidebar-foreground"
      : isSelected
        ? "bg-sidebar-row-selected text-sidebar-foreground"
        : shouldRecede
          ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
  );
  const rowLayout = resolveThreadRowLayoutPresentation("card");

  const title = isRenaming ? (
    <input
      autoFocus
      value={renamingTitle}
      aria-label="Thread title"
      onChange={(event) => onRenameTitleChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleRenameKeyDown}
      onBlur={handleRenameBlur}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
    />
  ) : (
    <span
      className={cn(
        "min-w-0 flex-1 text-sm transition-opacity motion-reduce:transition-none",
        shouldRecede ? "font-normal" : "font-medium",
        cn(
          rowLayout.titleClassName,
          shouldRecede
            ? "text-secondary-label"
            : isUnread || isWoke || status === "input"
              ? "text-foreground"
              : status === "failed"
                ? "text-foreground/95"
                : "text-foreground/90",
        ),
        isRegeneratingTitle && "opacity-55",
      )}
    >
      {thread.title}
    </span>
  );

  // A real link keeps every activation mode on the source-control host.
  const prBadge = linkedPullRequest ? (
    <LinkedPullRequestLink indicator={linkedPullRequest} onClick={handlePrClick} />
  ) : prStatus && pr ? (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={handlePrClick}
      className={cn(
        // Sidebar chrome follows the interface font; tabular digits keep the
        // number from reflowing as PR states stream in.
        "shrink-0 text-xs tabular-nums hover:underline",
        prStatus.colorClass,
      )}
      aria-label={prStatus.tooltip}
    >
      #{pr.number}
    </a>
  ) : null;
  const terminalStatusIcon = terminalStatus ? (
    <span
      role="img"
      aria-label={terminalProcessLabel(terminalProcessCount)}
      data-testid={`sidebar-terminal-status-${thread.id}`}
      className={cn("inline-flex shrink-0 items-center justify-center", terminalStatus.colorClass)}
    >
      <TerminalIcon
        className={cn("size-3.5", terminalStatus.pulse && "motion-safe:animate-status-pulse")}
        onAnimationStart={synchronizeTerminalPulse}
      />
    </span>
  ) : null;
  const diff = latestTurnDiff(thread);

  return (
    <li
      data-thread-item
      className="list-none py-0.5 [content-visibility:auto] [contain-intrinsic-size:auto_96px]"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              role="button"
              tabIndex={0}
              data-testid="sidebar-row-card"
              aria-busy={isRegeneratingTitle || undefined}
              className={rowSurfaceClassName}
              onClick={handleClick}
              onDoubleClick={handleDoubleClick}
              onKeyDown={handleKeyDown}
              onContextMenu={handleContextMenu}
            />
          }
        >
          <div className={rowLayout.contentClassName}>
            <div className="flex h-5 min-w-0 items-center gap-1.5">
              {props.showProjectIdentity ? (
                <>
                  <ProjectFavicon
                    environmentId={thread.environmentId}
                    cwd={props.projectCwd ?? ""}
                    faviconPath={props.projectFaviconPath}
                    className="size-4 shrink-0"
                  />
                  {props.projectTitle ? (
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-secondary-label text-xs",
                        shouldRecede ? "font-normal" : "font-medium",
                      )}
                    >
                      {props.projectTitle}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                </>
              ) : (
                <span className="flex-1" />
              )}
              {/* The visible state owns this slot's width: status at rest,
                  actions on hover/keyboard focus or while the popover is open. Keeping
                  the hidden state out of flow lets the project label reclaim
                  space without either state overlapping it. */}
              <span className="group/sidebar-status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-stretch justify-end text-xs">
                <span
                  className={cn(
                    "pointer-events-none group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0 group-any-hover/sidebar-row:absolute group-any-hover/sidebar-row:right-0 group-any-hover/sidebar-row:opacity-0",
                    "flex items-center self-center justify-self-end tabular-nums text-secondary-label transition-opacity",
                  )}
                >
                  {topStatus ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-medium",
                        topStatus.className,
                      )}
                    >
                      {topStatus.icon === "working" ? (
                        <CircleDashedIcon aria-hidden className="size-4 shrink-0" />
                      ) : topStatus.icon === "done" ? (
                        <CircleCheckIcon aria-hidden className="size-4 shrink-0" />
                      ) : null}
                      {/* The label alone is the live region: a role="status"
                            wrapper around the ticking duration would make
                            screen readers announce every second. */}
                      <span role="status">{topStatus.label}</span>
                      {status === "working" ? (
                        <span aria-hidden>
                          <WorkingDuration startedAt={resolveWorkingStartedAt(thread)} />
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    threadTimeLabel(thread)
                  )}
                </span>
              </span>
            </div>
            <div className="mt-1 flex min-w-0">
              {title}
              {isRegeneratingTitle ? (
                <span role="status" className="sr-only">
                  Regenerating title
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-secondary-label text-xs">
              {/* Always the branch. The plan step used to take this slot while
                  working, but it truncated to a half-sentence and dropped the
                  branch, so the row lost its most stable identifier. */}
              {thread.branch ? (
                <>
                  <ThreadWorktreeIndicator thread={thread} />
                  <MiddleTruncate value={thread.branch} showTitle={false} className="flex-1" />
                </>
              ) : (
                <span className="flex-1" />
              )}
              {terminalStatusIcon}
              {prBadge}
              {diff ? (
                <span className="shrink-0 font-mono">
                  <span className="text-diff-addition-foreground">+{diff.insertions}</span>{" "}
                  <span className="text-diff-deletion-foreground">−{diff.deletions}</span>
                </span>
              ) : null}
              <span
                aria-hidden
                className="pointer-events-none ml-auto inline-flex shrink-0 items-center gap-1"
              >
                {isRemote ? (
                  <span className="inline-flex shrink-0 items-center text-sidebar-muted-foreground/70">
                    <ServerIcon aria-hidden className="size-3.5" />
                  </span>
                ) : null}
                {driverKind ? (
                  <span className="inline-flex shrink-0 items-center">
                    <ProviderInstanceIcon
                      driverKind={driverKind}
                      displayName={
                        providerEntry?.displayName ??
                        thread.session?.providerName ??
                        modelInstanceId
                      }
                      accentColor={providerEntry?.accentColor}
                      showBadge={showInstanceBadge}
                      // Glyph dims, badge stays saturated; offset matches the composer trigger.
                      iconClassName={resolveThreadProviderIconClassName()}
                      badgeClassName="right-[-0.1875rem] bottom-[-0.1875rem] h-3 min-w-3 px-0.5 text-5xs"
                    />
                  </span>
                ) : null}
              </span>
            </div>
          </div>
          {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
        </TooltipTrigger>
        {detailsTooltip}
      </Tooltip>
    </li>
  );
});

function latestTurnDiff(
  thread: SidebarThreadSummary,
): { insertions: number; deletions: number } | null {
  // Shells don't carry checkpoint summaries; diff stats render only when the
  // shell projection grows them. Kept as a seam so the row layout is ready.
  void thread;
  return null;
}

const SidebarSearchResultRow = memo(function SidebarSearchResultRow(props: {
  thread: SidebarThreadSummary;
  projectCwd: string | null;
  projectFaviconPath: string | null;
  projectTitle: string | null;
  environmentLabel: string | null;
  providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>;
  isHighlighted: boolean;
  isRouteActive: boolean;
  resultId: string;
  searchMatch: EnvironmentThreadSearchMatch | null;
  searchQuery: string;
  onHighlight: () => void;
  onSelect: () => void;
}) {
  const { thread } = props;
  // Same details tooltip as the regular rows: a search hit is still a thread,
  // and the hover card is how you disambiguate identically-titled results.
  const gitCwd = thread.worktreePath ?? props.projectCwd;
  const gitStatus = useEnvironmentQuery(
    (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: gitStatus.data?.refName ?? null,
  });
  const modelInstanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : thread.modelSelection.model;
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  return (
    <li role="presentation" className="list-none">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              id={props.resultId}
              type="button"
              role="option"
              // aria-activedescendant options: focus stays on the search input,
              // which owns all keyboard interaction for the listbox.
              tabIndex={-1}
              aria-selected={props.isHighlighted}
              aria-current={props.isRouteActive ? "page" : undefined}
              aria-label={
                props.projectTitle ? `${thread.title}, ${props.projectTitle}` : thread.title
              }
              onMouseMove={props.onHighlight}
              onClick={props.onSelect}
              className={cn(
                "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-sm outline-none",
                props.isHighlighted || props.isRouteActive
                  ? "bg-sidebar-row-active text-sidebar-foreground"
                  : "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              )}
            />
          }
        >
          <ProjectFavicon
            environmentId={thread.environmentId}
            cwd={props.projectCwd ?? ""}
            faviconPath={props.projectFaviconPath}
            className="size-4 shrink-0"
            fallbackIcon={MessageSquareIcon}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground/55 tabular-nums">
                {threadTimeLabel(thread)}
              </span>
            </span>
            {props.searchMatch ? (
              <ThreadSearchMatchExcerpt
                match={{
                  source: props.searchMatch.source,
                  snippet: props.searchMatch.snippet,
                  query: props.searchQuery,
                }}
              />
            ) : null}
          </span>
        </TooltipTrigger>
        <SidebarThreadTooltip
          thread={thread}
          projectTitle={props.projectTitle}
          projectCwd={props.projectCwd}
          projectFaviconPath={props.projectFaviconPath}
          environmentLabel={props.environmentLabel}
          providerEntry={providerEntry}
          showInstanceBadge={showInstanceBadge}
          modelInstanceId={modelInstanceId}
          modelLabel={modelLabel}
          branchMismatch={branchMismatch}
          terminalStatus={terminalStatus}
          terminalProcessCount={runningTerminalIds.length}
        />
      </Tooltip>
    </li>
  );
});

/** How long the menu's rows wait for HQ to say what waits on the viewer before they stand without it. */
const MENU_WAITS_PATIENCE_MS = 800;

/** How long a press stands for the Mate it opens before its route must have arrived. */
const MENU_PRESS_BOUND_MS = 6_000;

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
  const zeropsPlacedBirths = useMemo(
    () =>
      placedPressesIn(
        zeropsPresses,
        zeropsSession.activeOrganization?.id,
        placedNewProjects(zeropsMade, zeropsSession.activeOrganization?.id),
      ),
    [zeropsPresses, zeropsMade, zeropsSession.activeOrganization?.id],
  );
  // Whose each Mate is, for the badge on the corner of its face.
  const zeropsMateOwner = useZeropsMateOwners();
  // Each container's health, as the container store holds it — the tree's
  // "some Mate in the group is up" part of *Put it live*'s gate.
  // Until the listing may say "none", the tree says what it can instead. An
  // account still to choose its organization is asked on the projects screen,
  // and no listing is on its way to be waited on here.
  const zeropsNowMs = useNowMs();
  const zeropsPatient = useListingPatience(zeropsListing);
  const zeropsNotice = useMemo(
    () =>
      zeropsSession.organizationStatus === "needs-selection"
        ? null
        : candidatesNotice(zeropsListing, ZEROPS_SIDEBAR_SURFACE, zeropsNowMs, {
            patient: zeropsPatient,
            // The page says the projects are read, once; the menu holds its rows' room quietly.
            readingSilent: true,
          }),
    [zeropsListing, zeropsNowMs, zeropsPatient, zeropsSession.organizationStatus],
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
  const releaseOfferedIn = useCallback(
    (groupId: string, allowed: boolean) =>
      allowed && !putLiveHoldsRelease(putLiveRuns.get(groupId)),
    [putLiveRuns],
  );
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
        releaseOffered: releaseOfferedIn(groupId, flow.release.gate.allowed),
        // What a release would put in front of people: the count the
        // chips' menus say waits for production.
        releaseContents: flow.release.contents,
        releaseSummary: flow.release.summary,
        releaseUntold: flow.release.untold,
        mateTier: flow.mateTier,
        // Until HQ answers the releases, production's chip says only what the platform says.
        releasesKnown: flow.releasesKnown,
        // The release that did not go through, which turns the chip amber.
        releaseFailure: releaseFailureOf({
          releases: flow.releases,
          environmentInputs: flow.environmentInputs,
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
    [releaseOfferedIn, zeropsProjectFlows],
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
  // HQ not answering: the menu draws the structure it last read, says since when and how old that
  // is (SPEC §6.2.3); the Mates' conversations go on without HQ.
  const zeropsHqOutage = hqOutage(
    useAtomValue(shownCanonicalHqListNavigationAtom),
    useAtomValue(hqDownSinceAtom),
    timestampFormat,
    zeropsNowMs,
  );
  const hqServiceUrl = useHqServiceUrl();
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
      if (made !== undefined && made.projectId === null) {
        void router.navigate(newProjectView(projectId));
        return;
      }
      void router.navigate(newMateView(projectId));
    },
    [isMobile, router, setOpenMobile, zeropsMade],
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
  const onZeropsNewMate = useCallback(
    (groupId: string) => {
      if (isMobile) setOpenMobile(false);
      addMate(groupId);
    },
    [addMate, isMobile, setOpenMobile],
  );
  const addAutomatedMates = useAddAutomatedMates();
  // An HQ older than automated Mates makes none: Add offers none there.
  const automatedOffered = useAutomatedKey() !== "unsupported";
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
  // Every project whose next release is offered waits on the viewer too.
  const zeropsWaitingReleases = useMemo(
    () =>
      zeropsMenuProjects.flatMap((project) => {
        const release = zeropsProjectFlows.get(project.id)?.release;
        return release !== undefined && releaseOfferedIn(project.id, release.gate.allowed)
          ? [
              {
                groupId: project.id,
                name: project.name,
                ahead: release.summary?.total,
                changeCount: release.summary?.changeCount,
              },
            ]
          : [];
      }),
    [releaseOfferedIn, zeropsMenuProjects, zeropsProjectFlows],
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
  // Whose Mates the menu lists (the account menu's Mine / Everyone): the
  // tree and the waiting faces read the same answer.
  const [zeropsMateScope, setZeropsMateScope] = useMateScope();
  const showEveryoneMates = useCallback(() => setZeropsMateScope("everyone"), [setZeropsMateScope]);
  const zeropsPersonFacts = useAtomValue(shownHqPersonFactsAtom);
  const zeropsShown = useCallback(
    (candidate: (typeof zeropsCandidates)[number]) =>
      shownInScope(
        zeropsMateScope,
        zeropsPersonFacts[candidate.project.id]?.mine,
        candidate.project.id === activeZeropsProjectId,
      ),
    [activeZeropsProjectId, zeropsPersonFacts, zeropsMateScope],
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
  // page, where it is set up. An organization without an HQ holds no Chief: its top is the mark.
  const mateDirectory = useAtomValue(shownHqMateDirectoryAtom);
  const zeropsChiefPageOpen = useLocation({ select: (location) => location.pathname === "/chief" });
  const zeropsAccountHq = useAccountHq(zeropsSession.activeOrganization?.id ?? undefined);
  const zeropsHoldsChief = !(
    zeropsAccountHq.status === "ready" && zeropsAccountHq.hq.kind === "none"
  );
  const openChiefPage = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    void router.navigate({ to: "/chief" });
  }, [isMobile, router, setOpenMobile]);
  const zeropsListed = zeropsCandidates;
  const chiefSetupLine = useChiefSetupLine();
  const ownChief = useOwnChief();
  const onZeropsSelect = useCallback(
    (candidate: (typeof zeropsCandidates)[number]) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      startTransition(() => {
        setZeropsPress({
          projectId: candidate.project.id,
          from: activeZeropsProjectId,
          fromOverview: zeropsOverviewOpen,
        });
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
  // What waits on the viewer, for the Waiting on you row and ⌥↓: each Mate read as its row reads it.
  const zeropsWaiting = useSidebarWaiting({
    candidates: zeropsCandidates,
    activityOf: zeropsRowActivity,
    shown: zeropsShown,
    activeProjectId: activeZeropsProjectId,
    beforeReveal: isMobile
      ? () => {
          setOpenMobile(true);
        }
      : undefined,
    enabled: zeropsSignedIn,
    releases: zeropsWaitingReleases,
  });
  // The menu's list and what waits on the viewer come in one frame as the menu first paints: the
  // list holds its loading rows until rows of its own are there and HQ's navigation, which says
  // what waits, has settled (HQ down, or no HQ, settles it too). A list painted first was pushed
  // down 74 px when the Waiting on you row came, half a second in. Where HQ is slower than the
  // list, the list stands after `MENU_WAITS_PATIENCE_MS` without it; once it stands, it never
  // waits again.
  const zeropsHq = useHqMatesRead();
  const zeropsHqReading = zeropsSignedIn && zeropsHq.organizationId !== null && !zeropsHq.settled;
  const zeropsListLoading = menuDrawsLoadingRows({
    candidates: zeropsCandidates,
    births: zeropsPlacedBirths,
    complete: zeropsMenuComplete,
    reading: zeropsSession.organizationStatus === "selected" && !zeropsMenuComplete,
    notice: zeropsNotice,
  });
  const zeropsListReady = !zeropsHqReading && !zeropsListLoading;
  const [zeropsListStood, setZeropsListStood] = useState(zeropsListReady);
  useEffect(() => {
    if (zeropsListReady) setZeropsListStood(true);
  }, [zeropsListReady]);
  useEffect(() => {
    if (zeropsListStood || zeropsListLoading || !zeropsHqReading) return;
    const timer = window.setTimeout(() => {
      setZeropsListStood(true);
    }, MENU_WAITS_PATIENCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [zeropsHqReading, zeropsListLoading, zeropsListStood]);
  const zeropsListHeld = !zeropsListStood && !zeropsListReady;
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

  const attachListAutoAnimateRef = useCallback((node: HTMLUListElement | null) => {
    if (!node) return;
    autoAnimate(node, { duration: 150, easing: "ease-out" });
  }, []);

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
  // or is being set up. Before that the account menu offers it (`chiefOffered`), and its place
  // holds the mark, with what waits on the person beside it (`SidebarChiefPlace`).
  const zeropsChiefShown =
    zeropsSignedIn &&
    zeropsHoldsChief &&
    chiefTopShown({
      own: zeropsChief === undefined ? ownChief : zeropsChief.project.id,
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
  const zeropsCreate =
    zeropsSignedIn && zeropsSession.organizationStatus !== "needs-selection" ? (
      <SidebarCreateButton
        onNewMate={onZeropsNewMate}
        onNewAutomatedMates={automatedOffered ? onZeropsNewAutomatedMates : undefined}
        onNewProject={roleOffered.newProject ? openNewZeropsProject : undefined}
        projects={zeropsMateProjects}
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
    <SidebarStage rail={zeropsRail}>
      <SidebarChromeHeader
        brand={
          zeropsChiefTop(false) ??
          (zeropsSignedIn && zeropsHoldsChief ? (
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
              compact={zeropsSignedIn && zeropsHoldsChief}
              serviceUrl={hqServiceUrl}
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
                            {newThreadShortcutLabel
                              ? `New thread (${newThreadShortcutLabel})`
                              : "New thread"}
                          </span>
                          <span className="text-muted-foreground">
                            New thread in current project: Shift+click
                            {newThreadInProjectShortcutLabel
                              ? ` (${newThreadInProjectShortcutLabel})`
                              : ""}
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
              </div>
              {projectGroups.length > 0 ? (
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
                              <span className="min-w-0 truncate text-sm">
                                {project.displayName}
                              </span>
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
              activeConversation={activeZeropsConversation}
              births={zeropsPlacedBirths}
              candidates={zeropsListed}
              complete={zeropsMenuComplete}
              notice={zeropsNotice}
              reading={zeropsSession.organizationStatus === "selected" && !zeropsMenuComplete}
              onNoticeAct={onZeropsNoticeAct}
              onAddMate={addMate}
              onAddAutomatedMates={automatedOffered ? onZeropsNewAutomatedMates : undefined}
              onInvite={teamOffered.invite ? inviteToProject : undefined}
              onSetUp={onZeropsSetUp}
              getComing={zeropsComing}
              onOpenComing={openComingMate}
              onBrowseProjects={navigateToZeropsProjects}
              onAskToFix={onZeropsAskToFix}
              getFlow={zeropsSidebarFlowWithPages}
              getOwner={zeropsMateOwner}
              getMateActions={zeropsMateMenus.getMateActions}
              shown={zeropsShown}
              timestampFormat={timestampFormat}
              onOpenGroup={openGroup}
              getActivity={zeropsRowActivity}
              keyedReadings
              getConversationsRead={zeropsConversationsRead}
              onSelect={onZeropsSelect}
              onOpenCrew={onZeropsOpenCrew}
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
              <p
                role="status"
                className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
              >
                {threadSearch.isPending
                  ? "Searching thread messages…"
                  : threadSearch.incomplete
                    ? "Some conversations could not be searched."
                    : "No threads found"}
              </p>
            )
          ) : null}
          {!isSearchingThreads ? (
            <TooltipProvider
              key="sidebar-thread-tooltips-150"
              delay={150}
              closeDelay={0}
              timeout={400}
            >
              <ul ref={attachListAutoAnimateRef} role="list" className="flex flex-col gap-px">
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
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              {projectGroups.length === 0 ? (
                <>
                  <span>No projects yet</span>
                  {roleOffered.newProject ? (
                    <button
                      type="button"
                      onClick={openNewZeropsProject}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                    >
                      <PlusIcon className="-mx-0.5 size-3" />
                      New project
                    </button>
                  ) : null}
                </>
              ) : scopedProjectGroup ? (
                `No threads in ${scopedProjectGroup.displayName} yet`
              ) : (
                "No threads yet"
              )}
            </div>
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

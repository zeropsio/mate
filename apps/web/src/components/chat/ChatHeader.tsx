import { useMateVoice } from "../../zerops/mateVoiceContext";
import { mateStatus } from "../../zerops/mateStatus.logic";
import { taskTitle, type ConversationTask } from "../../zerops/automatedMate.logic";
import { MateTaskStatus } from "../zerops/MateTaskCard";
import { MateStatusMarker } from "../zerops/MateStatusMarker";
import { ZeropsWorkspaceChip } from "../zerops/ZeropsWorkspaceChip";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ArchiveIcon, ChevronDownIcon, EllipsisIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import GitActionsControl from "../GitActionsControl";
import { isTrailingDoubleClick } from "../Sidebar.logic";
import { type DraftId } from "~/composerDraftStore";
import { Button } from "../ui/button";
import { ChiefOverviewButton } from "../zerops/chief/ChiefOverviewButton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "./OpenInPicker";
import { useRemoteOpenState, type RemoteOpenMode } from "../../remoteOpen";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { useT3ProjectFileScripts } from "~/hooks/useT3ProjectFileScripts";
import { useThreadActionMenu } from "~/hooks/useThreadActionMenu";
import { readLocalApi } from "~/localApi";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectFavicon } from "../ProjectFavicon";
import { useThreadShell } from "../../state/entities";
import { useZeropsThreadActivity } from "~/zerops/useZeropsAgentActivity";
import type { ZeropsMateAt } from "~/zerops/mateIdentities";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { ZeropsProjectLink } from "../zerops/ZeropsProjectLink";
import { useProjectReviewOf, useProjectSitesOf } from "~/zerops/projectPartsShown";
import { HeaderReviewDoor } from "../zerops/SidebarProjectReview";
import { headerReviewItems } from "../zerops/SidebarProjectReview.logic";
import { useHeldBehindReview } from "~/zerops/heldBehindReview";
import { useRightPanelStore } from "~/rightPanelStore";
import { MateFaceAsMark } from "../zerops/primitives";
import { ChatHeaderLinks } from "./ChatHeaderLinks";
import { ConversationStrip, useMateWorks } from "./ConversationStrip";
import { registerThreadSyncSlot } from "./threadSyncSlot";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { cn } from "~/lib/utils";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  /**
   * The task this conversation works now, on an automated Mate (`conversationTask`): the
   * conversation is named by it ("#12 Fix the checkout total"), and its status and Stop are its;
   * absent for any other.
   */
  activeThreadTask?: ConversationTask | undefined;
  /**
   * The conversation is still being read: the way out to Zerops waits for it, its place held (the
   * owner, 2026-10-12: "the 'open in zerops' doesn't need to be visible while loading").
   */
  conversationLoading?: boolean;
  /** Drafts have no server thread yet, so the title carries no action menu. */
  isServerThread: boolean;
  activeProjectName: string | undefined;
  activeProjectCwd: string | null;
  activeProjectFaviconPath: string | null;
  openInCwd: string | null;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  rightPanelOpen: boolean;
  gitCwd: string | null;
  onNewThreadInProject: () => void;
  /** Archives the Mate's conversation and opens a fresh one in its place. */
  onStartFresh: () => void;
  /** A crewmate's *Change its job*: the crew's Crewmate editor on that crewmate. */
  onEditCrewmateJob: (handle: string) => void;
  /** The lead's *Change the brief*: the crew's Brief editor. */
  onEditBrief: () => void;
  onOpenProjectSettings?: (() => void) | undefined;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

/**
 * Rename commit rule shared with the sidebar's inline rename: trim, reject
 * empty (the caller toasts), and skip the mutation when nothing changed.
 */
export function resolveRenameCommit(input: {
  readonly title: string;
  readonly originalTitle: string;
}): { action: "commit"; title: string } | { action: "reject-empty" } | { action: "noop" } {
  const trimmed = input.title.trim();
  if (trimmed.length === 0) return { action: "reject-empty" };
  if (trimmed === input.originalTitle) return { action: "noop" };
  return { action: "commit", title: trimmed };
}

// How long a click on the thread title waits before opening the action menu,
// so a double-click-to-rename can cancel it first. Only the native desktop
// menu needs this: it swallows input while open, so the wait must cover the
// OS double-click interval. The browser fallback menu keeps seeing DOM
// events (the second click dismisses it and dblclick still fires), so it
// opens immediately.
const TITLE_MENU_OPEN_DELAY_MS = 500;

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly remoteOpenMode: RemoteOpenMode;
  /** Where a Mate lives, the way in is Zerops — see `ZeropsProjectLink`. */
  readonly whoLivesHere: ZeropsMateAt["kind"];
}): boolean {
  if (!input.activeProjectName) return false;
  // A Zerops container is nobody's SSH host: the editor picker would hand the
  // OS a deep link to a machine the person cannot reach. Its place in the
  // header goes to the project on the dashboard. While who lives here is not
  // known, neither is shown.
  if (input.whoLivesHere !== "nobody") return false;
  if (
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  ) {
    return true;
  }
  // Remote environments get the picker in deep-link mode (or its explicit
  // "no SSH route" state). Non-primary local backends (e.g. WSL) keep it
  // hidden, matching pre-remote behavior.
  return input.remoteOpenMode !== "local-exec";
}

/**
 * Starting over in a Mate's chat, spelled out in the header's menu: the chat
 * on screen is archived and a fresh, empty one takes its place — the one
 * action in the header a second click does not undo, so it is never a bare
 * glyph.
 */
function StartFreshMenuItem({ onStartFresh }: { readonly onStartFresh: () => void }) {
  return (
    <MenuItem data-zerops-start-fresh onClick={onStartFresh}>
      <ArchiveIcon />
      Archive and start fresh
    </MenuItem>
  );
}

/**
 * Who heads a conversation's header: a Mate's line of conversations once the directory names the
 * Mate; upstream's breadcrumb where nobody lives; until the directory says, the strip's place held
 * empty — never the breadcrumb, to flip from. A Chief's is its conversation's title alone, and
 * nothing before it says anything: the menu's top row, lit while it is open, names the Chief.
 */
export function headerLead(
  whoLivesHere: ZeropsMateAt["kind"],
  mate: { readonly chief?: boolean | undefined } = {},
): "strip" | "reserved" | "breadcrumb" | "title" {
  switch (whoLivesHere) {
    case "mate":
      return mate.chief === true ? "title" : "strip";
    case "unknown":
      return "reserved";
    case "nobody":
      return "breadcrumb";
  }
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeThreadTask,
  conversationLoading = false,
  isServerThread,
  activeProjectName,
  activeProjectCwd,
  activeProjectFaviconPath,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  rightPanelOpen,
  gitCwd,
  onNewThreadInProject,
  onStartFresh,
  onEditCrewmateJob,
  onEditBrief,
  onOpenProjectSettings,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
}: ChatHeaderProps) {
  const headerActionsRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useIsMobile();
  // Side panels can leave a desktop header narrower than a phone. Measured
  // before paint, so a narrow header never draws its inline actions first.
  const [isNarrowHeader, setIsNarrowHeader] = useState(false);
  useLayoutEffect(() => {
    const container = headerActionsRef.current?.parentElement;
    if (!container) return;
    const update = () => setIsNarrowHeader(container.clientWidth < 512);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const actionsCollapsed = isMobile || isNarrowHeader;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsContainer] = useState(() => {
    const container = document.createElement("div");
    container.className = "contents";
    return container;
  });
  // Reparent the DOM host, not the React controls: rotating a phone or resizing
  // a window must not discard an unsaved script or Git dialog.
  const mountInlineActions = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && !actionsCollapsed) node.appendChild(actionsContainer);
    },
    [actionsContainer, actionsCollapsed],
  );
  const mountMenuActions = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && actionsCollapsed) node.appendChild(actionsContainer);
    },
    [actionsContainer, actionsCollapsed],
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const fileScripts = useT3ProjectFileScripts(
    activeThreadEnvironmentId,
    activeProjectScripts ? activeProjectCwd : null,
  );
  const remoteOpenState = useRemoteOpenState(activeThreadEnvironmentId);
  // A server that owns no commit pipeline says so; only an explicit false
  // hides the control, so every server from before the capability keeps it.
  const stackedActionsSupported =
    useEnvironment(activeThreadEnvironmentId)?.serverConfig?.environment.capabilities
      .vcsStackedActions !== false;
  // A Mate's conversation is headed by the Mate — the line of its
  // conversations (`ConversationStrip`), its face wearing the chat's state,
  // its name — not by the folder it runs in, and what the chat is about
  // stands only once somebody has spoken into it. Elsewhere the header is
  // upstream's: the project, then the thread.
  // While who lives here is not known, the header shows what both looks
  // share and leaves out what only one of them has.
  const whoLivesHere = useZeropsMate(activeThreadEnvironmentId);
  const mate = whoLivesHere.kind === "mate" ? whoLivesHere.mate : undefined;
  // Sites opens the menu's panel for this Mate's project, with its ways to Zerops in it.
  const headerSites = useProjectSitesOf(mate?.chief === true ? undefined : mate?.projectId);
  // What waits on a review in its project, the same Review its row's tag opened (the owner,
  // 2026-10-12: "add it somewhere to the app bar in detail which would trigger the same pop").
  const headerReview = useProjectReviewOf(mate?.chief === true ? undefined : mate?.projectId);
  // Held while a review stands open: a merge pressed there never slides the goal under the sheet.
  // The conversation's own word that its Mate works, which holds the composer's strip too.
  const conversation = { mateWorks: useMateWorks(activeThreadEnvironmentId) };
  const reviewTags = useHeldBehindReview(
    headerReview === undefined ||
      (headerReviewItems(headerReview.items, mate?.projectId, conversation).length === 0 &&
        headerReview.release === undefined)
      ? null
      : headerReview,
  );
  const headerChanges = reviewTags.held
    ? headerReviewItems(reviewTags.value?.items ?? [], mate?.projectId)
    : headerReviewItems(reviewTags.value?.items ?? [], mate?.projectId, conversation);
  const lead = headerLead(whoLivesHere.kind, { chief: mate?.chief });
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
    remoteOpenMode: remoteOpenState.mode,
    whoLivesHere: whoLivesHere.kind,
  });
  const activeThreadRef = useMemo(
    () => scopeThreadRef(activeThreadEnvironmentId, activeThreadId),
    [activeThreadEnvironmentId, activeThreadId],
  );
  const mateActivity = useZeropsThreadActivity(activeThreadRef);
  // A Chief's conversation opens beside its organization's overview, until the person closes it.
  const chiefHere = mate?.chief === true && isServerThread;
  useEffect(() => {
    if (!chiefHere) return;
    const panels = useRightPanelStore.getState();
    const key = scopedThreadKey(activeThreadRef);
    if (key in panels.byThreadKey) return;
    panels.open(activeThreadRef, "overview");
  }, [chiefHere, activeThreadRef]);
  const linkVoice = useMateVoice();
  const status = linkVoice.surface === "none" ? mateStatus(mateActivity, null) : null;
  const settings = useEnvironmentSettings(activeThreadEnvironmentId);
  const activeThreadShell = useThreadShell(activeThreadRef);
  const spoken = activeThreadShell?.latestUserMessageAt != null;
  // A crewmate's chat is headed by the crewmate, and it is the crew engine's:
  // no rename, no archive, no new session, no commit from here.
  const crewOrigin = activeThreadShell?.crew ?? null;
  // A Mate's chat is headed by what the Mate is on in it — the subject its
  // row shows for the main chat (`agentActivity.ts`): the last task as the
  // person put it, not the chat's title, which names its first task forever.
  // The title stays the rename target.
  // A task's conversation is named by its task, never by the brief its first message carried.
  const headline =
    activeThreadTask !== undefined
      ? taskTitle(activeThreadTask.source)
      : mate === undefined
        ? activeThreadTitle
        : (mateActivity?.subject ?? activeThreadTitle);
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  // Inline rename, keyed by thread: navigating away drops an in-progress
  // rename instead of committing stale text. Cleared on thread change (not
  // just hidden) so returning to the thread doesn't revive the old draft.
  const [renaming, setRenaming] = useState<{ threadId: ThreadId; title: string } | null>(null);
  if (renaming !== null && renaming.threadId !== activeThreadId) {
    setRenaming(null);
  }
  const renamingTitle = renaming?.threadId === activeThreadId ? renaming.title : null;
  const renameCommittedRef = useRef(false);
  const startRename = useCallback(() => {
    renameCommittedRef.current = false;
    setRenaming({ threadId: activeThreadId, title: activeThreadTitle });
  }, [activeThreadId, activeThreadTitle]);
  const commitRename = useCallback(
    (title: string) => {
      setRenaming(null);
      const resolution = resolveRenameCommit({ title, originalTitle: activeThreadTitle });
      if (resolution.action === "reject-empty") {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        return;
      }
      if (resolution.action === "noop") return;
      void updateThreadMetadata({
        environmentId: activeThreadEnvironmentId,
        input: { threadId: activeThreadId, title: resolution.title },
      }).then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
      });
    },
    [activeThreadEnvironmentId, activeThreadId, activeThreadTitle, updateThreadMetadata],
  );
  const { openMenu, closeMenu } = useThreadActionMenu({
    threadRef: isServerThread && crewOrigin === null ? activeThreadRef : null,
    projectCwd: activeProjectCwd,
    onStartRename: startRename,
    automatedMate: mate?.automated === true,
  });
  const titleButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleMenuTimerRef = useRef<number | null>(null);
  const cancelPendingTitleMenu = useCallback(() => {
    if (titleMenuTimerRef.current === null) return;
    clearTimeout(titleMenuTimerRef.current);
    titleMenuTimerRef.current = null;
  }, []);
  // Drop a pending menu-open when the thread changes or the header unmounts,
  // so it can never fire for a thread the user already left.
  useEffect(
    () => () => {
      cancelPendingTitleMenu();
    },
    [activeThreadId, cancelPendingTitleMenu],
  );
  const openTitleMenuNow = useCallback(() => {
    cancelPendingTitleMenu();
    const rect = titleButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    openMenu({ x: rect.left, y: rect.bottom + 4 });
  }, [cancelPendingTitleMenu, openMenu]);
  const openMenuFromTitle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      // The trailing click of a double-click belongs to rename, not the menu.
      if (isTrailingDoubleClick(event.detail)) return;
      // Keyboard activation and the explicit chevron affordance can never be
      // the first half of a double-click, so they open without waiting.
      const clickedChevron =
        (event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null;
      if (event.detail === 0 || clickedChevron || window.desktopBridge === undefined) {
        openTitleMenuNow();
        return;
      }
      // Stay pending long enough for dblclick to cancel the open before the
      // native menu appears and swallows the second click.
      cancelPendingTitleMenu();
      titleMenuTimerRef.current = window.setTimeout(() => {
        titleMenuTimerRef.current = null;
        openTitleMenuNow();
      }, TITLE_MENU_OPEN_DELAY_MS);
    },
    [cancelPendingTitleMenu, openTitleMenuNow],
  );
  const handleTitleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // The chevron is the explicit menu affordance; only the title text renames.
      if ((event.target as HTMLElement).closest("[data-thread-title-chevron]") !== null) return;
      cancelPendingTitleMenu();
      closeMenu();
      startRename();
    },
    [cancelPendingTitleMenu, closeMenu, startRename],
  );
  const handleHeaderContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (renamingTitle !== null || crewOrigin !== null) return;
      // The right-side controls (git, scripts, open-in) keep their own
      // behavior, and the crew's faces are other conversations; the Mate, the
      // task after it and the line's empty stretch open the thread menu.
      if ((event.target as HTMLElement).closest("[data-chat-header-actions]")) return;
      if ((event.target as HTMLElement).closest("[data-conversation-crew]")) return;
      if (!isServerThread && onOpenProjectSettings === undefined) return;
      cancelPendingTitleMenu();
      event.preventDefault();
      if (!isServerThread) {
        const api = readLocalApi();
        if (!api) return;
        void api.contextMenu
          .show([{ id: "project-settings", label: "Project settings", icon: "settings" }], {
            x: event.clientX,
            y: event.clientY,
          })
          .then((action) => {
            if (action === "project-settings") onOpenProjectSettings?.();
          });
        return;
      }
      openMenu({ x: event.clientX, y: event.clientY });
    },
    [
      cancelPendingTitleMenu,
      crewOrigin,
      isServerThread,
      onOpenProjectSettings,
      openMenu,
      renamingTitle,
    ],
  );
  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        renameCommittedRef.current = true;
        commitRename(event.currentTarget.value);
      } else if (event.key === "Escape") {
        renameCommittedRef.current = true;
        setRenaming(null);
      }
    },
    [commitRename],
  );
  // A Mate's conversation offers no project actions: the Mate runs what the
  // project needs.
  const showProjectScripts = whoLivesHere.kind === "nobody" && activeProjectScripts !== undefined;
  const showGitActions =
    Boolean(activeProjectName) && stackedActionsSupported && crewOrigin === null;
  // The header's one menu: upstream's project actions on a narrow header,
  // and a Mate's own start-over wherever the Mate lives.
  const startsFresh = mate !== undefined && crewOrigin === null;
  const projectActionsInMenu =
    actionsCollapsed && (showProjectScripts || showOpenInPicker || showGitActions);
  const menuShown = startsFresh || projectActionsInMenu;
  if (!menuShown && actionsOpen) setActionsOpen(false);
  // The chat's title as it is renamed: under a Mate — whose line says what the
  // chat is about only on hover — over the line from the Mate's name, on the
  // header's ground, so nothing on the line moves while it is edited; in
  // upstream's header, in place of the title.
  const renameInput = (over: boolean) =>
    renamingTitle === null ? null : (
      <input
        autoFocus
        aria-label="Thread title"
        className={cn(
          "min-w-0 flex-1 text-sm font-medium text-foreground outline-none ring-1 ring-ring/50 focus:ring-ring",
          over ? "h-8 rounded-lg bg-background px-2" : "rounded-sm bg-transparent",
        )}
        defaultValue={renamingTitle}
        onBlur={(event) => {
          if (renameCommittedRef.current) return;
          commitRename(event.currentTarget.value);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={handleRenameKeyDown}
      />
    );
  // What the chat is on: renamed in place, and the thread's menu on a click.
  const titleContent =
    renamingTitle !== null ? (
      renameInput(false)
    ) : isServerThread ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              ref={titleButtonRef}
              type="button"
              aria-label={`Thread actions for ${headline}`}
              aria-haspopup="menu"
              onClick={openMenuFromTitle}
              onDoubleClick={handleTitleDoubleClick}
              onBlur={cancelPendingTitleMenu}
              className="group/thread-title inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <h2 className="min-w-0 truncate">{headline}</h2>
          <ChevronDownIcon
            aria-hidden
            data-thread-title-chevron
            className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/thread-title:opacity-100 group-focus-visible/thread-title:opacity-100"
          />
        </TooltipTrigger>
        <TooltipPopup side="top">{headline}</TooltipPopup>
      </Tooltip>
    ) : (
      <Tooltip>
        <TooltipTrigger
          render={
            <h2 aria-label={headline} className="min-w-0 flex-1 truncate">
              {headline}
            </h2>
          }
        />
        <TooltipPopup side="top">{headline}</TooltipPopup>
      </Tooltip>
    );
  // Upstream's project actions fold into one menu on a narrow header; the
  // Mate's own controls stay where they are.
  const headerActions = (
    <>
      {showProjectScripts && activeProjectScripts && (
        <ProjectScriptsControl
          onRequestMenuClose={() => setActionsOpen(false)}
          presentation={actionsCollapsed ? "menu" : "toolbar"}
          scripts={activeProjectScripts}
          fileScripts={fileScripts}
          keybindings={keybindings}
          preferredScriptId={preferredScriptId}
          onRunScript={onRunProjectScript}
          onAddScript={onAddProjectScript}
          onUpdateScript={onUpdateProjectScript}
          onDeleteScript={onDeleteProjectScript}
        />
      )}
      {showOpenInPicker && (
        <>
          {actionsCollapsed && showProjectScripts && <MenuSeparator />}
          <OpenInPicker
            presentation={actionsCollapsed ? "menu" : "toolbar"}
            environmentId={activeThreadEnvironmentId}
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        </>
      )}
      {showGitActions && (
        <>
          {actionsCollapsed && (showProjectScripts || showOpenInPicker) && <MenuSeparator />}
          <GitActionsControl
            presentation={actionsCollapsed ? "menu" : "toolbar"}
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            {...(draftId ? { draftId } : {})}
          />
        </>
      )}
    </>
  );
  return (
    // A Chief's face is the product's own mark here as in its conversation.
    <MateFaceAsMark.Provider value={mate?.chief === true}>
      <div
        className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3"
        onContextMenu={handleHeaderContextMenu}
      >
        {lead === "reserved" ? (
          <div aria-hidden="true" className="min-w-0 flex-1" data-header-lead-reserved />
        ) : lead === "title" ? (
          // A Chief's conversation: only the controls at the header's end; its last question is
          // the conversation itself.
          <div aria-hidden="true" className="min-w-0 flex-1" />
        ) : lead === "strip" ? (
          // The line of the Mate's conversations: the Mate, then its crew. What
          // the chat is about is the Mate's hover, never words on the line.
          <>
            <ConversationStrip
              crewChat={
                crewOrigin === null
                  ? null
                  : { handle: crewOrigin.crewmate, title: activeThreadTitle }
              }
              currentThreadId={isServerThread ? activeThreadId : null}
              environmentId={activeThreadEnvironmentId}
              onEditBrief={onEditBrief}
              onEditJob={onEditCrewmateJob}
              onRename={isServerThread && crewOrigin === null ? startRename : null}
              renameField={
                renamingTitle === null ? null : (
                  <div className="absolute inset-y-0 start-8.5 end-0 flex max-w-96 items-center">
                    {renameInput(true)}
                  </div>
                )
              }
              subject={crewOrigin === null && spoken ? headline : null}
              trailing={
                // What waits on the person, right after the Mate: its Review, the same door for
                // an automated Mate's task conversation, where the task's state and its Stop
                // follow it (the owner, 2026-10-19: "why is this different from the normal mate?").
                activeThreadTask !== undefined && isServerThread ? (
                  <MateTaskStatus
                    conversationId={activeThreadId}
                    environmentId={activeThreadEnvironmentId}
                    review={
                      reviewTags.value === null
                        ? null
                        : {
                            review: { ...reviewTags.value, items: headerChanges },
                            held: reviewTags.held,
                          }
                    }
                    task={activeThreadTask.source}
                    taskId={activeThreadTask.taskId}
                  />
                ) : reviewTags.value === null ? null : (
                  <HeaderReviewDoor
                    held={reviewTags.held}
                    review={{ ...reviewTags.value, items: headerChanges }}
                  />
                )
              }
            />
            {status === null ? null : (
              <MateStatusMarker
                mateName={mate?.name}
                status={status}
                timestampFormat={settings.timestampFormat}
              />
            )}
            {/* A conversation bound to a lease: when its workspace was last active, what a
              release would lose there, and whether it is idle — where the header has room. */}
            {activeThreadShell?.lease == null ? null : (
              <span className="hidden shrink-0 @3xl/header-actions:block">
                <ZeropsWorkspaceChip
                  environmentId={activeThreadEnvironmentId}
                  latestTurn={activeThreadShell.latestTurn}
                  lease={activeThreadShell.lease}
                  threadId={activeThreadId}
                />
              </span>
            )}
          </>
        ) : (
          <WorkspaceBreadcrumb ariaLabel="Thread breadcrumb" className="flex-1">
            {/* The project always leads the header: knowing which project a
            thread lives in is priority zero, and the thread title alone
            doesn't answer it. */}
            {whoLivesHere.kind === "nobody" && activeProjectName ? (
              <>
                <WorkspaceBreadcrumbItem>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`New thread in ${activeProjectName}`}
                          onClick={onNewThreadInProject}
                          className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      }
                    >
                      <ProjectFavicon
                        environmentId={activeThreadEnvironmentId}
                        cwd={activeProjectCwd ?? ""}
                        faviconPath={activeProjectFaviconPath}
                        className="size-3.5"
                      />
                      <span className="max-w-40 truncate">{activeProjectName}</span>
                    </TooltipTrigger>
                    <TooltipPopup side="top">New thread in {activeProjectName}</TooltipPopup>
                  </Tooltip>
                </WorkspaceBreadcrumbItem>
                <WorkspaceBreadcrumbSeparator />
              </>
            ) : null}
            {crewOrigin !== null || (whoLivesHere.kind !== "nobody" && !spoken) ? null : (
              <WorkspaceBreadcrumbItem current className="flex-1">
                {titleContent}
              </WorkspaceBreadcrumbItem>
            )}
          </WorkspaceBreadcrumb>
        )}
        {/* The sync indicator's seat: always this size, so a thread catching up
          with its server spins here and moves nothing (`threadSyncSlot.ts`). */}
        <span
          className="flex size-4 shrink-0 items-center justify-center"
          data-thread-sync-slot="true"
          ref={registerThreadSyncSlot}
        />
        <div
          ref={headerActionsRef}
          data-chat-header-actions
          className={cn(
            "flex shrink-0 items-center justify-end",
            // A Mate's header is a row of borderless buttons, 4 px apart like
            // the panel toggles beside it — held so while its Mate is not named yet.
            lead === "breadcrumb" ? "gap-2 @3xl/header-actions:gap-3" : "gap-1",
            // Reserve two panel toggles (32px, 28px at sm) with their 4px gap and
            // 1px edge inset, plus the gap the actions keep between themselves so
            // the terminal toggle does not sit against the last action. The page
            // header adds 8px more right padding at sm.
            rightPanelOpen
              ? "pr-0"
              : lead === "breadcrumb"
                ? "pr-19.25 sm:pr-15.25 @3xl/header-actions:pr-16.25"
                : "pr-18.25 sm:pr-14.25",
          )}
        >
          {/* The Mate's version and its update live with its body in the right
            panel's Zerops view, not over the conversation. */}
          <Menu open={menuShown && actionsOpen} onOpenChange={setActionsOpen}>
            <MenuTrigger
              className={menuShown ? undefined : "hidden"}
              render={
                <Button
                  aria-label="More header actions"
                  data-chat-header-ghost
                  size="icon-sm"
                  variant="ghost"
                />
              }
            >
              <EllipsisIcon className="size-4" />
            </MenuTrigger>
            <div ref={mountInlineActions} className="contents" />
            <MenuPopup
              data-chat-header-actions
              keepMounted
              aria-label="Header actions"
              align="end"
              finalFocus={menuShown ? undefined : false}
            >
              <div ref={mountMenuActions} className="contents" />
              {createPortal(headerActions, actionsContainer)}
              {startsFresh ? (
                <>
                  {projectActionsInMenu ? <MenuSeparator /> : null}
                  <StartFreshMenuItem onStartFresh={onStartFresh} />
                </>
              ) : null}
            </MenuPopup>
          </Menu>
          <ChatHeaderLinks
            environmentId={activeThreadEnvironmentId}
            mateProjectId={mate?.projectId}
            sites={headerSites}
            threadId={activeThreadId}
          />
          {mate === undefined ? null : (
            <span
              aria-hidden={conversationLoading ? true : undefined}
              className={conversationLoading ? "invisible contents" : "contents"}
              data-opening-waits=""
            >
              {mate.chief === true ? (
                // A Chief's way out is its organization: the overview's cards beside it.
                <ChiefOverviewButton threadRef={activeThreadRef} />
              ) : headerSites === undefined ? (
                <ZeropsProjectLink projectUrl={mate.projectUrl} />
              ) : null}
            </span>
          )}
        </div>
      </div>
    </MateFaceAsMark.Provider>
  );
});

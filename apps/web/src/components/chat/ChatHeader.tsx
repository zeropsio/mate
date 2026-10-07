import { mateStatus } from "../../zerops/mateStatus.logic";
import { MateStatusMarker } from "../zerops/MateStatusMarker";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ChangeRequestSettleSource } from "@t3tools/client-runtime/state/thread-settled";
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
import { ChatHeaderLinks } from "./ChatHeaderLinks";
import { ConversationStrip } from "./ConversationStrip";
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
  /** Drafts have no server thread yet, so the title carries no action menu. */
  isServerThread: boolean;
  /** PR feeding the settled classification, resolved by ChatView. */
  changeRequest: ChangeRequestSettleSource | null;
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
 * empty — never the breadcrumb, to flip from.
 */
export function headerLead(
  whoLivesHere: ZeropsMateAt["kind"],
): "strip" | "reserved" | "breadcrumb" {
  switch (whoLivesHere) {
    case "mate":
      return "strip";
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
  isServerThread,
  changeRequest,
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
  const lead = headerLead(whoLivesHere.kind);
  const mate = whoLivesHere.kind === "mate" ? whoLivesHere.mate : undefined;
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
  const status = mateStatus(mateActivity);
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
  const headline =
    mate === undefined ? activeThreadTitle : (mateActivity?.subject ?? activeThreadTitle);
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
    changeRequest,
    onStartRename: startRename,
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
    <div
      className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3"
      onContextMenu={handleHeaderContextMenu}
    >
      {lead === "reserved" ? (
        <div aria-hidden="true" className="min-w-0 flex-1" data-header-lead-reserved />
      ) : lead === "strip" ? (
        // The line of the Mate's conversations: the Mate, then its crew. What
        // the chat is about is the Mate's hover, never words on the line.
        <>
          <ConversationStrip
            crewChat={
              crewOrigin === null ? null : { handle: crewOrigin.crewmate, title: activeThreadTitle }
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
          />
          {status === null ? null : (
            <MateStatusMarker
              mateName={mate?.name}
              status={status}
              timestampFormat={settings.timestampFormat}
            />
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
          // Reserve two panel toggles plus their 4px gaps and 1px edge inset.
          // The page header adds 8px more right padding at sm.
          rightPanelOpen ? "pr-0" : "pr-18.25 sm:pr-14.25",
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
                variant="ghost-muted"
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
        <ChatHeaderLinks environmentId={activeThreadEnvironmentId} threadId={activeThreadId} />
        {mate === undefined ? null : <ZeropsProjectLink projectUrl={mate.projectUrl} />}
      </div>
    </div>
  );
});

import { useAtomValue } from "@effect/atom-react";
import { mateLimitAtom } from "@t3tools/client-runtime/data";
import { type EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { hasUnseenCompletion, resolveThreadStatus } from "@t3tools/shared/threadStatus";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  GitBranchIcon,
  MessageSquareIcon,
  ServerIcon,
  TerminalIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { subscribeSecond } from "../lib/secondTicker";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { useUiStateStore } from "../uiStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { vcsEnvironment } from "../state/vcs";
import { useEnvironmentQuery } from "../state/query";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { SidebarThreadSummary } from "../types";
import { cn } from "~/lib/utils";
import {
  formatWorkingDurationLabel,
  resolveThreadRowLayoutPresentation,
  resolveThreadProviderIconClassName,
  resolveWorkingStartedAt,
  threadStatusRowPresentation,
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
  synchronizeTerminalPulse,
  terminalStatusFromRunningIds,
  type ThreadChangeRequestSnapshot,
  type TerminalStatusIndicator,
} from "./ThreadStatusIndicators";
import { ProjectFavicon } from "./ProjectFavicon";
import { ThreadSearchMatchExcerpt } from "./ThreadSearchMatch";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "./chat/providerIconUtils";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../providerInstances";
import { useThreadRunningTerminalIds } from "../state/terminalSessions";

import { conversationCodeFolder } from "@t3tools/client-runtime/zerops";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { MiddleTruncate } from "./ui/middle-truncate";
import { Kbd } from "./ui/kbd";

function threadTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = thread.latestUserMessageAt ?? thread.updatedAt;
  return compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

// Floats at the row's right edge, vertically centered, while the jump
// modifier is held. An overlay pill instead of an inline slot: the hint
// must neither displace the status/time label (holding ⌘ used to blank
// out "Working") nor shift the layout when it appears.
function JumpHintBadge(props: { label: string }) {
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

export const SidebarThreadRow = memo(function SidebarThreadRow(props: {
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

  const gitCwd =
    props.projectCwd === null
      ? thread.worktreePath
      : conversationCodeFolder({
          workspaceRoot: props.projectCwd,
          lease: thread.lease?.alias ?? null,
          worktreePath: thread.worktreePath,
        });
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

export const SidebarSearchResultRow = memo(function SidebarSearchResultRow(props: {
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
  const gitCwd =
    props.projectCwd === null
      ? thread.worktreePath
      : conversationCodeFolder({
          workspaceRoot: props.projectCwd,
          lease: thread.lease?.alias ?? null,
          worktreePath: thread.worktreePath,
        });
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

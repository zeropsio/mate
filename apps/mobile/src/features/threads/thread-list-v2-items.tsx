import { RowPressable } from "../../components/RowPressable";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import type { MenuAction } from "@react-native-menu/menu";
import { resolveThreadStatus } from "@t3tools/shared/threadStatus";
import { memo, useCallback, useMemo, type ComponentProps } from "react";
import { Platform, Pressable, useWindowDimensions, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ControlPillMenu } from "../../components/ControlPill";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { ProviderInstanceIcon } from "../../components/ProviderIcon";
import type { ThreadRowProviderInstance } from "./thread-provider-instance";
import { cn } from "../../lib/cn";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { useThreadPr, type ThreadPrPresentation } from "../../state/use-thread-pr";
import { useSwipeRowDormant } from "../home/swipe-row-activation";
import { ThreadSwipeable } from "../home/thread-swipe-actions";
import { buildThreadTitleRegenerationMenuItems } from "./thread-title-regeneration-menu";
import { threadListV2FailureDetail, threadListV2StatusPresentation } from "./threadListV2";
import { QueuedMessageIcon } from "./queued-message-icon";
import { ThreadSearchMatchExcerpt } from "./thread-search-match";

/**
 * Thread List v2 renders one flat native list: rich edge-to-edge rows for
 * active work, all with native swipe and
 * long-press actions. State reads through colored status labels and text
 * hierarchy rather than card fills.
 */

const MONO_FONT = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

export function ThreadListV2PullRequestLink(props: {
  readonly pr: ThreadPrPresentation;
  readonly selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={props.pr.accessibilityLabel}
      accessibilityRole="link"
      hitSlop={8}
      onPress={(event) => {
        event.stopPropagation();
        void tryOpenExternalUrl(props.pr.url, "pull-request");
      }}
    >
      <Text
        className={cn(
          "text-xs",
          props.selected ? "text-user-bubble-foreground" : props.pr.textClassName,
        )}
        style={{ fontFamily: MONO_FONT }}
      >
        #{props.pr.label}
      </Text>
    </Pressable>
  );
}

// Menus keep lifecycle and title regeneration together. Archive keeps its
// own surface (thread screen / settings) rather than crowding v2 rows.
const ROW_MENU_ACTIONS: MenuAction[] = [{ id: "archive", title: "Archive", image: "archivebox" }];

/** Rounded-row radius shared with the v1 sidebar rows. */
const SIDEBAR_V2_ROW_RADIUS = 12;

/** Section label + rule: the only structure in an otherwise flat list. */
export const ThreadListV2SectionDivider = memo(function ThreadListV2SectionDivider(props: {
  readonly label: string;
  readonly pane?: "screen" | "sidebar";
}) {
  return (
    <View
      className={cn(
        "mb-1.5 mt-4 flex-row items-center gap-2.5",
        props.pane === "sidebar" ? "px-3" : "px-5",
      )}
    >
      <Text className="text-xs font-t3-medium text-foreground-tertiary">{props.label}</Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
});

const PENDING_TASK_MENU_ACTIONS: MenuAction[] = [
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const DRAFT_TASK_MENU_ACTIONS: MenuAction[] = [
  { id: "delete", title: "Discard", image: "trash", attributes: { destructive: true } },
];

/**
 * Unsent work, in the same idiom as an active v2 row: it is work the user
 * wrote, so it reads like the thread it will become. The status slot says
 * what happens next, not where the item sits: "Sends on reconnect" stays
 * uncolored because nothing is asked of the user; "Draft" takes the amber the
 * web sidebar uses for drafts, because this one waits on the user.
 */
export const ThreadListV2PendingRow = memo(function ThreadListV2PendingRow(props: {
  readonly pendingTask: PendingNewTask;
  readonly project: EnvironmentProject | null;
  readonly projectTitle?: string;
  readonly environmentLabel: string | null;
  readonly pane?: "screen" | "sidebar";
  /** Draws the "Unsent" divider above the first draft or queued row. */
  readonly showPendingDivider: boolean;
  /** Keeps row hairlines inside a section; section headers draw their own rule. */
  readonly showTrailingDivider?: boolean;
  readonly onSelectPendingTask: (pendingTask: PendingNewTask) => void;
  readonly onDeletePendingTask: (pendingTask: PendingNewTask) => void;
}) {
  const { pendingTask, onSelectPendingTask, onDeletePendingTask } = props;
  const sidebarPane = props.pane === "sidebar";
  const isDraft = pendingTask.kind === "draft";
  const projectTitle = props.projectTitle ?? props.project?.title ?? pendingTask.projectTitle ?? "";
  const branch = pendingTask.branch;

  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "delete") onDeletePendingTask(pendingTask);
    },
    [onDeletePendingTask, pendingTask],
  );

  const rowContent = (
    <>
      <View className="flex-row items-center gap-1.5">
        {props.project ? (
          <ProjectFavicon
            environmentId={pendingTask.environmentId}
            faviconPath={props.project.faviconPath}
            size={15}
            projectTitle={projectTitle}
            workspaceRoot={props.project.workspaceRoot}
          />
        ) : null}
        <Text className="flex-1 text-sm font-t3-medium text-foreground-muted" numberOfLines={1}>
          {projectTitle}
        </Text>
        {isDraft ? (
          <View className="flex-row items-center gap-1">
            <SymbolView
              name="square.and.pencil"
              size={10}
              tintColorClassName="accent-adaptive-amber-700-300"
              type="monochrome"
            />
            <Text className="text-xs text-adaptive-amber-700-300">Draft</Text>
          </View>
        ) : (
          <Text className="text-xs text-foreground-tertiary">Sends on reconnect</Text>
        )}
      </View>
      {/* One line, unlike the two an active row allows: a queued title is
          derived from the whole prompt rather than written as a title, so the
          second line is usually a stray word or emoji rather than meaning. */}
      <Text className="mt-1 text-base font-t3-medium text-foreground" numberOfLines={1}>
        {pendingTask.title}
      </Text>
      {branch || props.environmentLabel ? (
        <Text className="mt-1 text-xs text-foreground-muted" numberOfLines={1}>
          {branch ? (
            <Text className="text-xs text-foreground-muted" style={{ fontFamily: MONO_FONT }}>
              {branch}
            </Text>
          ) : null}
          {branch && props.environmentLabel ? "  ·  " : null}
          {props.environmentLabel ? (
            <Text className="text-xs text-foreground-tertiary">{props.environmentLabel}</Text>
          ) : null}
        </Text>
      ) : null}
    </>
  );

  return (
    <>
      {props.showPendingDivider ? (
        <ThreadListV2SectionDivider label="Unsent" pane={props.pane} />
      ) : null}
      <ControlPillMenu
        actions={isDraft ? DRAFT_TASK_MENU_ACTIONS : PENDING_TASK_MENU_ACTIONS}
        onPressAction={handleMenuAction}
        shouldOpenOnLongPress
      >
        <RowPressable
          accessibilityHint={
            isDraft
              ? "Opens the draft in the new task composer"
              : "Sends when the environment reconnects. Opens the task for editing"
          }
          accessibilityLabel={pendingTask.title}
          accessibilityRole="button"
          key={pendingTask.key}
          className={sidebarPane ? "bg-drawer" : "bg-screen"}
          onPress={() => onSelectPendingTask(pendingTask)}
          style={
            sidebarPane
              ? {
                  borderRadius: SIDEBAR_V2_ROW_RADIUS,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }
              : undefined
          }
        >
          {sidebarPane ? (
            rowContent
          ) : (
            <View>
              <View className="px-5 py-2.5">{rowContent}</View>
              {props.showTrailingDivider !== false ? (
                <View className="ml-5 h-px bg-border-subtle" />
              ) : null}
            </View>
          )}
        </RowPressable>
      </ControlPillMenu>
    </>
  );
});

export const ThreadListV2Row = memo(function ThreadListV2Row(props: {
  readonly thread: EnvironmentThreadShell;
  /** A message for this thread is waiting in the outbox. */
  readonly hasQueuedMessages?: boolean;
  /** Preformatted against the parent clock (latest activity). Blank while a
      status label owns that slot. Precomputed per row —
      not via the list's extraData — so the minute tick re-renders only rows
      whose displayed text moved. */
  readonly timeLabel: string;
  readonly project: EnvironmentProject | null;
  readonly projectTitle?: string;
  readonly providerInstance: ThreadRowProviderInstance | null;
  /** Which machine hosts the thread. Null when only one environment is
      connected — repeating the same label on every row is noise. Mirrors
      the web sidebar's remote-environment cloud icon, but as text since
      phones have no hover tooltips. */
  readonly environmentLabel: string | null;
  /** Hosting surface. "screen" (default) renders the compact Home idiom:
      flat edge-to-edge rows on the screen background with inset hairlines.
      "sidebar" renders the iPad split-view idiom: rounded rows blending
      into the drawer surface, selection filled with the accent color —
      matching the v1 sidebar rows. */
  readonly pane?: "screen" | "sidebar";
  /** Keeps row hairlines inside a section; section headers draw their own rule. */
  readonly showTrailingDivider?: boolean;
  /** Highlights the thread open in the detail pane (iPad split view). The
      compact Home list never sets it — phones navigate away on select. */
  readonly selected?: boolean;
  /** Override for narrow panes (iPad sidebar); defaults to window width. */
  readonly fullSwipeWidth?: number;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onNewThreadOnBranch: (thread: EnvironmentThreadShell) => void;
  readonly onRenameThread: (thread: EnvironmentThreadShell) => void;
  readonly onRegenerateThreadTitle: (thread: EnvironmentThreadShell) => void;
  readonly onArchiveThread: (thread: EnvironmentThreadShell) => void;
  /** False on servers that predate thread title regeneration. */
  readonly titleRegenerationSupported: boolean;
  readonly onSwipeableWillOpen: (methods: SwipeableMethods) => void;
  readonly onSwipeableClose: (methods: SwipeableMethods) => void;
  readonly projectCwd?: string | null;
  /** List key checked against the Home swipe row activation. */
  readonly activationKey?: string;
  readonly searchMatch?: EnvironmentThreadSearchMatch;
  readonly searchQuery?: string;
  readonly simultaneousSwipeGesture?: ComponentProps<
    typeof ThreadSwipeable
  >["simultaneousWithExternalGesture"];
}) {
  const { width: windowWidth } = useWindowDimensions();
  const {
    thread,
    onSelectThread,
    onRenameThread,
    onRegenerateThreadTitle,
    onNewThreadOnBranch,
    onArchiveThread,
  } = props;
  const dormant = useSwipeRowDormant(props.activationKey);

  const pr = useThreadPr(thread, props.projectCwd ?? props.project?.workspaceRoot ?? null);

  const { materialYouStyleLayoutActive } = useAppearancePreferences();
  const theme = useUniwindTheme();
  const screenColor = theme["--color-screen"];
  const drawerColor = theme["--color-drawer"];
  const selectedBackgroundColor =
    theme[materialYouStyleLayoutActive ? "--color-thread-selected" : "--color-user-bubble"];
  const sidebarPane = props.pane === "sidebar";
  const selected = props.selected === true;
  // The provider badge's border blends into the row's own surface, which
  // differs by pane and (for the sidebar pane) selection: the sidebar row
  // background becomes the selected fill or the drawer surface, while the
  // flat "screen" pane rows always sit on the screen background.
  const providerIconSurfaceColor = sidebarPane
    ? selected
      ? selectedBackgroundColor
      : drawerColor
    : screenColor;

  const resolvedStatus = resolveThreadStatus(thread);
  const statusPresentation = threadListV2StatusPresentation(resolvedStatus);
  const failureDetail = threadListV2FailureDetail(resolvedStatus, thread.session?.lastError);
  // The timestamp is precomputed on the list item so a minute tick only
  // re-renders rows that draw it.
  const timeLabel = props.timeLabel;

  const handleRename = useCallback(() => onRenameThread(thread), [onRenameThread, thread]);
  const handleRegenerateTitle = useCallback(
    () => onRegenerateThreadTitle(thread),
    [onRegenerateThreadTitle, thread],
  );
  const handleArchive = useCallback(() => onArchiveThread(thread), [onArchiveThread, thread]);

  const titleMenuItems = useMemo<MenuAction[]>(
    () => [
      { id: "rename", title: "Rename", image: "square.and.pencil" },
      ...buildThreadTitleRegenerationMenuItems({
        supported: props.titleRegenerationSupported,
        isRegenerating: thread.titleRegeneration != null,
      }),
    ],
    [props.titleRegenerationSupported, thread.titleRegeneration],
  );
  const menuActions = useMemo<MenuAction[]>(
    () => [ROW_MENU_ACTIONS[0]!, ...titleMenuItems],
    [titleMenuItems],
  );
  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "new-thread-on-branch") onNewThreadOnBranch(thread);
      if (nativeEvent.event === "archive") handleArchive();
      if (nativeEvent.event === "rename") handleRename();
      if (nativeEvent.event === "regenerate-title") handleRegenerateTitle();
      if (nativeEvent.event === "copy-thread-id") {
        copyTextWithHaptic(thread.id, { target: "thread-id" });
      }
    },
    [onNewThreadOnBranch, thread, handleArchive, handleRegenerateTitle, handleRename],
  );
  const primaryAction = useMemo(
    () => ({
      accessibilityLabel: `Archive ${thread.title}`,
      icon: "archivebox" as const,
      label: "Archive",
      onPress: handleArchive,
    }),
    [handleArchive, thread.title],
  );

  // The sidebar pane fills selected rows with the theme's message surface, so
  // every piece of row text must use that surface's paired foreground.
  const cardContent = (
    <>
      <View className="flex-row items-center gap-1.5">
        {props.project ? (
          <ProjectFavicon
            environmentId={thread.environmentId}
            faviconPath={props.project.faviconPath}
            size={15}
            projectTitle={props.projectTitle ?? props.project.title}
            workspaceRoot={props.project.workspaceRoot}
          />
        ) : null}
        <Text
          className={cn(
            "flex-1 text-sm font-t3-medium",
            selected
              ? materialYouStyleLayoutActive
                ? "text-thread-selected-foreground-muted"
                : "text-user-bubble-foreground-muted"
              : "text-foreground-muted",
          )}
          numberOfLines={1}
        >
          {props.projectTitle ?? props.project?.title ?? ""}
        </Text>
        {props.hasQueuedMessages ? <QueuedMessageIcon selected={selected} /> : null}
        <Text
          className={cn(
            "text-xs tabular-nums",
            selected
              ? materialYouStyleLayoutActive
                ? "text-thread-selected-foreground"
                : "text-user-bubble-foreground"
              : statusPresentation.className,
          )}
        >
          {statusPresentation.label ?? timeLabel}
        </Text>
      </View>
      <Text
        className={cn(
          "mt-1 text-base font-t3-medium",
          selected
            ? materialYouStyleLayoutActive
              ? "text-thread-selected-foreground"
              : "text-user-bubble-foreground"
            : "text-foreground",
        )}
        numberOfLines={2}
      >
        {thread.title}
      </Text>
      {props.searchMatch ? (
        <View className="mt-1">
          <ThreadSearchMatchExcerpt
            match={props.searchMatch}
            query={props.searchQuery ?? ""}
            selected={selected}
          />
        </View>
      ) : null}
      <View className="mt-1 flex-row items-center gap-2">
        {failureDetail !== null ? (
          <Text
            className={cn(
              "flex-1 text-xs",
              selected
                ? materialYouStyleLayoutActive
                  ? "text-thread-selected-foreground-muted"
                  : "text-user-bubble-foreground-muted"
                : "text-danger-foreground",
            )}
            numberOfLines={1}
          >
            {failureDetail}
          </Text>
        ) : thread.branch || props.environmentLabel ? (
          /* "branch · machine" share one truncating line. The machine sits
             last so a tight fit cuts the repetitive label, not the branch —
             and machine-only fills the row for non-git projects. */
          <Text
            className={cn(
              "flex-1 text-xs",
              selected
                ? materialYouStyleLayoutActive
                  ? "text-thread-selected-foreground-muted"
                  : "text-user-bubble-foreground-muted"
                : "text-foreground-muted",
            )}
            numberOfLines={1}
          >
            {thread.branch ? (
              <Text
                className={cn(
                  "text-xs",
                  selected
                    ? materialYouStyleLayoutActive
                      ? "text-thread-selected-foreground-muted"
                      : "text-user-bubble-foreground-muted"
                    : "text-foreground-muted",
                )}
                style={{ fontFamily: MONO_FONT }}
              >
                {thread.branch}
              </Text>
            ) : null}
            {thread.branch && props.environmentLabel ? "  ·  " : null}
            {props.environmentLabel ? (
              <Text
                className={cn(
                  "text-xs",
                  selected ? "text-user-bubble-foreground-muted" : "text-foreground-tertiary",
                )}
              >
                {props.environmentLabel}
              </Text>
            ) : null}
          </Text>
        ) : (
          <View className="flex-1" />
        )}
        {pr ? <ThreadListV2PullRequestLink pr={pr} selected={selected} /> : null}
        {props.providerInstance ? (
          <View className="opacity-60">
            <ProviderInstanceIcon
              provider={props.providerInstance.driverKind}
              size={14}
              displayName={props.providerInstance.displayName}
              accentColor={props.providerInstance.accentColor}
              showBadge={props.providerInstance.showBadge}
              surfaceColor={providerIconSurfaceColor}
            />
          </View>
        ) : null}
      </View>
    </>
  );

  const rowContent = (close: () => void) => (
    <RowPressable
      key={`${thread.environmentId}:${thread.id}`}
      interactionClassName={
        selected && (sidebarPane || materialYouStyleLayoutActive)
          ? materialYouStyleLayoutActive
            ? "bg-thread-selected-foreground"
            : "bg-user-bubble-foreground"
          : "bg-primary"
      }
      className={sidebarPane || materialYouStyleLayoutActive ? undefined : "bg-screen"}
      accessibilityHint="Opens the thread. Swipe left to archive."
      accessibilityLabel={
        props.hasQueuedMessages ? `${thread.title}, messages queued to send` : thread.title
      }
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        close();
        onSelectThread(thread);
      }}
      style={
        sidebarPane || materialYouStyleLayoutActive
          ? {
              backgroundColor: selected
                ? selectedBackgroundColor
                : sidebarPane
                  ? drawerColor
                  : screenColor,
              borderRadius: SIDEBAR_V2_ROW_RADIUS,
              ...(sidebarPane ? { paddingHorizontal: 12, paddingVertical: 10 } : null),
            }
          : undefined
      }
    >
      {sidebarPane ? (
        cardContent
      ) : (
        /* Flat native list rows: no tonal containers — colored status
             labels and text hierarchy carry state, an inset hairline
             separates rows. The opaque screen background stays so swipe
             actions reveal behind the row. */
        <View>
          <View className="px-5 py-2.5">{cardContent}</View>
          {props.showTrailingDivider !== false ? (
            <View className="ml-5 h-px bg-border-subtle" />
          ) : null}
        </View>
      )}
    </RowPressable>
  );

  return (
    <>
      <ThreadSwipeable
        dormant={dormant}
        threadKey={`${thread.environmentId}:${thread.id}`}
        backgroundColor={sidebarPane ? drawerColor : screenColor}
        containerStyle={
          sidebarPane ? { borderRadius: SIDEBAR_V2_ROW_RADIUS, overflow: "hidden" } : undefined
        }
        enableTrackpadSwipe
        fullSwipeWidth={props.fullSwipeWidth ?? windowWidth - 32}
        onSwipeableClose={props.onSwipeableClose}
        onSwipeableWillOpen={props.onSwipeableWillOpen}
        primaryAction={primaryAction}
        resetKey={`${thread.environmentId}:${thread.id}`}
        simultaneousWithExternalGesture={props.simultaneousSwipeGesture}
        threadTitle={thread.title}
      >
        {(close) => (
          <ControlPillMenu
            actions={[
              ...(thread.branch
                ? [
                    {
                      id: "new-thread-on-branch",
                      title:
                        Platform.OS === "ios"
                          ? "New thread on branch"
                          : `New thread on ${thread.branch}`,
                      image: "square.and.pencil",
                    },
                  ]
                : []),
              { id: "copy-thread-id", title: "Copy thread ID", image: "doc.on.doc" },
              ...menuActions,
            ]}
            onPressAction={handleMenuAction}
            shouldOpenOnLongPress
          >
            {rowContent(close)}
          </ControlPillMenu>
        )}
      </ThreadSwipeable>
    </>
  );
});

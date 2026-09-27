import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ChevronDownIcon, MessagesSquareIcon, PlusIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { ThreadArchiveBlockedError, useThreadActions } from "~/hooks/useThreadActions";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useEnvironment } from "~/state/environments";
import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useUiStateStore } from "~/uiStateStore";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Separator } from "../ui/separator";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MateFace, StatusDot } from "../zerops/primitives";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import {
  alsoWorkingLine,
  chatEntries,
  foldStrip,
  mateChats,
  stripShown,
  type ConversationStripEntry,
  type ConversationStripGroup,
} from "./ConversationStrip.logic";

/** An entry's widest chip and the gap after it: what one slot costs. */
const SLOT_PX = 148;
/** The New chat button at the end of the row. */
const NEW_CHAT_PX = 104;
/** Below this the status words fold into their dots, the word kept as the name. */
const NARROW_PX = 480;

const isArchiveBlocked = Schema.is(ThreadArchiveBlockedError);

const CLOSE_HELD: Record<"main" | "busy", string> = {
  main: "Close the other chats first",
  busy: "Stop the agent before closing this chat",
};

export interface ConversationStripViewProps {
  readonly groups: ReadonlyArray<ConversationStripGroup>;
  /** Measured row width; null before it is measured, when nothing folds. */
  readonly width: number | null;
  readonly canMakeMain: boolean;
  readonly onOpen: (threadId: ThreadId) => void;
  readonly onClose: (entry: ConversationStripEntry) => void;
  readonly onMakeMain: (entry: ConversationStripEntry) => void;
  readonly onNewChat: () => void;
}

function EntryStatus({
  entry,
  narrow,
}: {
  readonly entry: ConversationStripEntry;
  readonly narrow: boolean;
}) {
  if (entry.status === null) return null;
  return (
    <StatusDot
      className="shrink-0"
      dotOnly={narrow}
      label={entry.status.word}
      pulse={entry.status.pulse}
      tone={entry.status.tone}
    />
  );
}

function StripChip({
  entry,
  narrow,
  canMakeMain,
  onOpen,
  onClose,
  onMakeMain,
}: {
  readonly entry: ConversationStripEntry;
  readonly narrow: boolean;
  readonly canMakeMain: boolean;
  readonly onOpen: (threadId: ThreadId) => void;
  readonly onClose: (entry: ConversationStripEntry) => void;
  readonly onMakeMain: (entry: ConversationStripEntry) => void;
}) {
  const threadId = entry.threadId;
  const menu = entry.current && threadId !== null && entry.canMakeMain;
  return (
    <div
      className={cn(
        "flex h-6 max-w-36 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs",
        entry.current
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
      data-conversation-strip-entry={entry.key}
      data-current={entry.current ? "true" : undefined}
    >
      <button
        aria-current={entry.current ? "page" : undefined}
        className="flex min-w-0 cursor-pointer items-center gap-1.5"
        onClick={() => {
          if (threadId !== null && !entry.current) onOpen(threadId);
        }}
        type="button"
      >
        {entry.face === undefined ? null : (
          <MateFace size="dot" state={entry.face.state} tint={entry.face.tint} />
        )}
        <span className="truncate">{entry.label}</span>
      </button>
      <EntryStatus entry={entry} narrow={narrow} />
      {menu ? (
        <Menu>
          <MenuTrigger
            render={
              <Button
                aria-label={`More for ${entry.label}`}
                className="shrink-0"
                size="icon-xs"
                variant="ghost-muted"
              />
            }
          >
            <ChevronDownIcon aria-hidden="true" className="size-3" />
          </MenuTrigger>
          <MenuPopup align="start">
            {canMakeMain ? <MenuItem onClick={() => onMakeMain(entry)}>Make main</MenuItem> : null}
            <MenuItem disabled={entry.close !== "open"} onClick={() => onClose(entry)}>
              Close chat
            </MenuItem>
          </MenuPopup>
        </Menu>
      ) : null}
      {entry.close === "none" ? null : entry.close === "open" ? (
        <button
          aria-label={`Close ${entry.label}`}
          className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-muted"
          onClick={() => onClose(entry)}
          type="button"
        >
          <XIcon aria-hidden="true" className="size-3" />
        </button>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                aria-disabled="true"
                aria-label={`Close ${entry.label}`}
                className="flex size-4 shrink-0 cursor-not-allowed items-center justify-center rounded-sm opacity-40"
                type="button"
              />
            }
          >
            <XIcon aria-hidden="true" className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">{CLOSE_HELD[entry.close]}</TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * The row itself: the chats, then each further group behind a divider, the
 * tail folded into *More* when the row runs out, and *New chat* at its end.
 */
export function ConversationStripView({
  groups,
  width,
  canMakeMain,
  onOpen,
  onClose,
  onMakeMain,
  onNewChat,
}: ConversationStripViewProps) {
  const slots =
    width === null ? Number.POSITIVE_INFINITY : Math.floor((width - NEW_CHAT_PX) / SLOT_PX);
  const narrow = width !== null && width < NARROW_PX;
  const { visible, folded } = foldStrip(groups, slots);
  const drawn = visible.filter((group) => group.entries.length > 0);
  return (
    <div className="flex min-w-0 items-center gap-1" data-conversation-strip-row>
      {drawn.map((group, index) => (
        <div
          aria-label={group.label}
          className="flex min-w-0 items-center gap-1"
          key={group.id}
          role="group"
        >
          {index === 0 ? null : <Separator className="mx-1 h-4" orientation="vertical" />}
          {group.entries.map((entry) => (
            <StripChip
              canMakeMain={canMakeMain}
              entry={entry}
              key={entry.key}
              narrow={narrow}
              onClose={onClose}
              onMakeMain={onMakeMain}
              onOpen={onOpen}
            />
          ))}
        </div>
      ))}
      {folded.length === 0 ? null : (
        <Menu>
          <MenuTrigger render={<Button className="shrink-0" size="xs" variant="ghost-muted" />}>
            More
            <ChevronDownIcon aria-hidden="true" className="size-3" />
          </MenuTrigger>
          <MenuPopup align="start">
            {folded.map((entry) => (
              <MenuItem
                disabled={entry.threadId === null}
                key={entry.key}
                onClick={() => {
                  if (entry.threadId !== null) onOpen(entry.threadId);
                }}
              >
                {entry.face === undefined ? null : (
                  <MateFace size="dot" state={entry.face.state} tint={entry.face.tint} />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                <EntryStatus entry={entry} narrow={false} />
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      )}
      <Button className="shrink-0" onClick={onNewChat} size="xs" variant="ghost">
        <PlusIcon aria-hidden="true" className="size-3.5" />
        New chat
      </Button>
    </div>
  );
}

export interface ConversationStripProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** The chat on screen; null on a chat not sent yet. */
  readonly currentThreadId: ThreadId | null;
  /**
   * Groups drawn after the chats, each behind a divider — the crew's
   * crewmates. An empty group draws nothing.
   */
  readonly extraGroups?: ReadonlyArray<ConversationStripGroup>;
}

const NO_GROUPS: ReadonlyArray<ConversationStripGroup> = [];

/**
 * A Mate's chats over its conversation. Nothing where no Mate lives, and
 * nothing for a Mate with one chat: the row appears with a second one.
 */
export function ConversationStrip({
  environmentId,
  projectId,
  currentThreadId,
  extraGroups = NO_GROUPS,
}: ConversationStripProps) {
  const whoLivesHere = useZeropsMate(environmentId);
  const shells = useThreadShells();
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const pinningSupported =
    useEnvironment(environmentId)?.serverConfig?.environment.capabilities.threadPinning === true;
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const { archiveThread, pinThread, unpinThread } = useThreadActions();
  // Measured once the row exists — it comes and goes with the second chat.
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (row === null) return;
    const update = () => setWidth(row.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => observer.disconnect();
  }, [row]);

  const chats = useMemo(
    () => mateChats(shells.filter((thread) => thread.environmentId === environmentId)),
    [environmentId, shells],
  );
  if (whoLivesHere.kind !== "mate") return null;
  const mate = whoLivesHere.mate;
  const entries = chatEntries({
    chats,
    currentThreadId,
    startingChat: currentThreadId === null,
    mate: { name: mate.name, tint: mate.tint, connected: mate.connected },
    lastVisitedAtById,
  });
  if (!stripShown(entries, extraGroups)) return null;

  const open = (threadId: ThreadId) => {
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };

  // Closing the chat you are on lands on the main chat, never on a new one:
  // the move happens first, so archiving does not start a replacement.
  const close = async (entry: ConversationStripEntry) => {
    if (entry.threadId === null || entry.close !== "open") return;
    const main = chats[0];
    if (entry.current && main !== undefined) {
      await router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, main.id)),
        replace: true,
      });
    }
    const result = await archiveThread(scopeThreadRef(environmentId, entry.threadId), {
      toast: { title: "Chat closed", description: `‘${entry.label}’ is under Archived.` },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      const blocked = isArchiveBlocked(error);
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: blocked ? CLOSE_HELD.busy : "Couldn't close the chat",
          description: blocked ? undefined : String(error),
        }),
      );
    }
  };

  // The pin is what makes a chat main; the old pin goes as a step of the
  // move, not as something to undo on its own.
  const makeMain = async (entry: ConversationStripEntry) => {
    if (entry.threadId === null) return;
    const pinned = await pinThread(scopeThreadRef(environmentId, entry.threadId));
    if (pinned._tag !== "Success") {
      if (!isAtomCommandInterrupted(pinned)) {
        toastManager.add(
          stackedThreadToast({ type: "error", title: "Couldn't make this chat main" }),
        );
      }
      return;
    }
    for (const chat of chats) {
      if (chat.id === entry.threadId || chat.pinnedAt == null) continue;
      await unpinThread(scopeThreadRef(environmentId, chat.id), { undoToast: false });
    }
  };

  return (
    <div
      className="flex h-9 shrink-0 items-center ps-(--workspace-gutter-start) pe-(--workspace-gutter-end)"
      data-conversation-strip
      ref={setRow}
    >
      <ConversationStripView
        canMakeMain={pinningSupported}
        groups={[{ id: "chats", label: "Chats", entries }, ...extraGroups]}
        onClose={(entry) => void close(entry)}
        onMakeMain={(entry) => void makeMain(entry)}
        onNewChat={() =>
          void handleNewThread(scopeProjectRef(environmentId, projectId), { chat: true })
        }
        onOpen={open}
        width={width}
      />
    </div>
  );
}

/**
 * The quiet line over the composer while you type in one of a Mate's chats
 * and it works in another. Nothing is refused: it only says so.
 */
export function useAlsoWorkingBanner({
  environmentId,
  currentThreadId,
  typing,
}: {
  readonly environmentId: EnvironmentId;
  readonly currentThreadId: ThreadId | null;
  readonly typing: boolean;
}): ComposerBannerStackItem | null {
  const whoLivesHere = useZeropsMate(environmentId);
  const shells = useThreadShells();
  const mateName = whoLivesHere.kind === "mate" ? whoLivesHere.mate.name : null;
  return useMemo(() => {
    if (mateName === null) return null;
    const line = alsoWorkingLine({
      mateName,
      chats: mateChats(shells.filter((thread) => thread.environmentId === environmentId)),
      currentThreadId,
      typing,
    });
    if (line === null) return null;
    return {
      id: "mate-also-working",
      variant: "default",
      icon: <MessagesSquareIcon />,
      title: line,
    };
  }, [currentThreadId, environmentId, mateName, shells, typing]);
}

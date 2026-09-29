import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ChevronDownIcon, MessagesSquareIcon, PlusIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { ThreadArchiveBlockedError, useThreadActions } from "~/hooks/useThreadActions";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useEnvironment } from "~/state/environments";
import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useUiStateStore } from "~/uiStateStore";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MateFace } from "../zerops/primitives";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import {
  alsoWorkingLine,
  chatEntries,
  crewEntries,
  entryAccessibleName,
  entryInk,
  foldStrip,
  loneChatNewChatShown,
  mateChats,
  stripShown,
  type ConversationStripEntry,
  type ConversationStripGroup,
  type StripRoom,
} from "./ConversationStrip.logic";

/** Between two neighbours in the row (`gap-0.5`). */
const GAP_PX = 2;
/** Before the crew, on top of the gap (`ms-4`): spacing, not a rule, sets the groups apart. */
const GROUP_GAP_PX = 16;

const isArchiveBlocked = Schema.is(ThreadArchiveBlockedError);

/** Why a chat mid-turn keeps its close. */
const CLOSE_HELD = "Stop the agent before closing this chat";

/**
 * A glyph button in the row: the row's height, the band's corners and hover.
 * In the header it is one of the header's ghosts (`data-chat-header-ghost`):
 * the header's rule keeps its fill off and sets its ink.
 */
const GLYPH_BUTTON =
  "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-hover data-popup-open:text-foreground";

/** A control inside an entry, after its name: smaller, on the entry's own ground. */
const ENTRY_CONTROL =
  "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

export interface ConversationStripViewProps {
  readonly groups: ReadonlyArray<ConversationStripGroup>;
  readonly canMakeMain: boolean;
  readonly onOpen: (threadId: ThreadId) => void;
  readonly onClose: (entry: ConversationStripEntry) => void;
  readonly onMakeMain: (entry: ConversationStripEntry) => void;
  readonly onNewChat: () => void;
}

/** The lead's role on hover, where its name does not say it; everything else as it is. */
function WithRole({
  entry,
  children,
}: {
  readonly entry: ConversationStripEntry;
  readonly children: ReactElement;
}) {
  if (entry.role === undefined) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup side="bottom">{entry.role}</TooltipPopup>
    </Tooltip>
  );
}

function StripEntry({
  entry,
  folded,
  squeezed,
  canMakeMain,
  onOpen,
  onClose,
  onMakeMain,
}: {
  readonly entry: ConversationStripEntry;
  /** Folded into More: out of the row, kept only to be measured. */
  readonly folded: boolean;
  /**
   * The one entry left when even it and More do not fit: its name gives way.
   * Every other entry keeps its width, so what is measured is what it needs.
   */
  readonly squeezed: boolean;
  readonly canMakeMain: boolean;
  readonly onOpen: (threadId: ThreadId) => void;
  readonly onClose: (entry: ConversationStripEntry) => void;
  readonly onMakeMain: (entry: ConversationStripEntry) => void;
}) {
  const threadId = entry.threadId;
  const menu = entry.current && threadId !== null && entry.canMakeMain;
  const closable = entry.close === "open" || entry.close === "busy";
  return (
    <div
      className={cn(
        "group/entry flex h-7 max-w-60 items-center rounded-lg transition-colors",
        squeezed ? "min-w-0" : "shrink-0",
        entry.current ? "bg-sidebar-row-active" : "hover:bg-sidebar-row-hover",
        (menu || closable) && "pe-1",
        folded && "invisible absolute start-0 top-0",
      )}
      data-conversation-strip-entry={entry.key}
      data-current={entry.current ? "true" : undefined}
    >
      <WithRole entry={entry}>
        <button
          aria-current={entry.current ? "page" : undefined}
          aria-label={entryAccessibleName(entry)}
          className="flex h-7 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg ps-2 pe-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            if (threadId !== null && !entry.current) onOpen(threadId);
          }}
          type="button"
        >
          <MateFace greets size="sm" state={entry.face.state} tint={entry.face.tint} />
          <span
            className={cn(
              "truncate text-sm font-medium transition-colors",
              entryInk(entry) === "ink"
                ? "text-foreground"
                : "text-muted-foreground group-hover/entry:text-foreground",
            )}
          >
            {entry.label}
          </span>
        </button>
      </WithRole>
      {menu ? (
        <Menu>
          <MenuTrigger
            render={
              <button
                aria-label={`More for ${entry.label}`}
                className={ENTRY_CONTROL}
                data-chat-header-ghost
                type="button"
              />
            }
          >
            <ChevronDownIcon aria-hidden="true" className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="start">
            {canMakeMain ? <MenuItem onClick={() => onMakeMain(entry)}>Make main</MenuItem> : null}
            <MenuItem disabled={entry.close !== "open"} onClick={() => onClose(entry)}>
              Close chat
            </MenuItem>
          </MenuPopup>
        </Menu>
      ) : null}
      {entry.close === "open" ? (
        <button
          aria-label={`Close ${entry.label}`}
          className={ENTRY_CONTROL}
          onClick={() => onClose(entry)}
          type="button"
        >
          <XIcon aria-hidden="true" className="size-3.5" />
        </button>
      ) : entry.close === "busy" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                aria-disabled="true"
                aria-label={`Close ${entry.label}`}
                className={cn(
                  ENTRY_CONTROL,
                  "cursor-not-allowed opacity-40 hover:text-muted-foreground",
                )}
                type="button"
              />
            }
          >
            <XIcon aria-hidden="true" className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">{CLOSE_HELD}</TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}

/**
 * The row's room, measured before paint and again whenever the row or an
 * entry changes size — a panel opening, a chat renamed, a font settling. A
 * folded entry stays in the row, out of the flow and unseen, so its width is
 * always known.
 */
function useStripRoom(): {
  readonly ref: (row: HTMLElement | null) => void;
  readonly room: StripRoom | null;
} {
  const [row, setRow] = useState<HTMLElement | null>(null);
  const [room, setRoom] = useState<StripRoom | null>(null);
  useLayoutEffect(() => {
    if (row === null) return;
    const widthOf = (selector: string) =>
      row.querySelector(selector)?.getBoundingClientRect().width ?? 0;
    const measure = () => {
      const widths = new Map<string, number>();
      for (const entry of row.querySelectorAll<HTMLElement>("[data-conversation-strip-entry]")) {
        widths.set(entry.dataset.conversationStripEntry ?? "", entry.getBoundingClientRect().width);
      }
      const newChat = widthOf("[data-conversation-strip-new]");
      const next: StripRoom = {
        width: row.getBoundingClientRect().width,
        widths,
        gap: GAP_PX,
        groupGap: GROUP_GAP_PX,
        fixed: newChat === 0 ? 0 : newChat + GAP_PX,
        more: widthOf("[data-conversation-strip-more]") + GAP_PX,
      };
      setRoom((previous) => (sameRoom(previous, next) ? previous : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const child of row.querySelectorAll("[data-conversation-strip-entry]")) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  });
  return { ref: setRow, room };
}

function sameRoom(left: StripRoom | null, right: StripRoom): boolean {
  if (left === null || left.width !== right.width || left.fixed !== right.fixed) return false;
  if (left.more !== right.more || left.widths.size !== right.widths.size) return false;
  for (const [key, width] of right.widths) if (left.widths.get(key) !== width) return false;
  return true;
}

/**
 * The strip itself, as the header's line: each entry a face and a name, the
 * one on screen on the menu's selected band; the Mate's chats first with New
 * chat after them, then the crew a step apart; the tail folded into *N more*
 * when the line runs out.
 */
export function ConversationStripView({
  groups,
  canMakeMain,
  onOpen,
  onClose,
  onMakeMain,
  onNewChat,
}: ConversationStripViewProps) {
  const { ref, room } = useStripRoom();
  const { visible, folded } = foldStrip(groups, room);
  const shownKeys = new Set(visible.flatMap((group) => group.entries.map((entry) => entry.key)));
  const floor = folded.length > 0 && shownKeys.size === 1;
  const drawn = groups.filter((group) => group.entries.length > 0 || group.id === "chats");
  return (
    // The header's own line: its faces in the header's face column, the band
    // reaching into the gutter around the one on screen.
    <nav
      aria-label="Conversations"
      className="relative -ms-2 flex min-w-0 flex-1 items-center gap-0.5"
      data-conversation-strip
      ref={ref}
    >
      {drawn.map((group, index) => {
        const shownHere = group.entries.some((entry) => shownKeys.has(entry.key));
        return (
          <div
            aria-label={group.label}
            className={cn("flex min-w-0 items-center gap-0.5", index > 0 && shownHere && "ms-4")}
            key={group.id}
            role="group"
          >
            {group.entries.map((entry) => (
              <StripEntry
                canMakeMain={canMakeMain}
                entry={entry}
                folded={!shownKeys.has(entry.key)}
                key={entry.key}
                squeezed={floor && shownKeys.has(entry.key)}
                onClose={onClose}
                onMakeMain={onMakeMain}
                onOpen={onOpen}
              />
            ))}
            {index === 0 ? <NewChatButton onNewChat={onNewChat} /> : null}
          </div>
        );
      })}
      <MoreMenu folded={folded} onOpen={onOpen} />
    </nav>
  );
}

/** Another chat beside the Mate's: a glyph after its chats, its name on hover. */
function NewChatButton({ onNewChat }: { readonly onNewChat: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label="New chat"
            className={GLYPH_BUTTON}
            data-chat-header-ghost
            data-conversation-strip-new
            onClick={onNewChat}
            type="button"
          />
        }
      >
        <PlusIcon aria-hidden="true" className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">New chat</TooltipPopup>
    </Tooltip>
  );
}

/**
 * *N more* at the line's end, opening what folded: each with its face and
 * name. Drawn unseen while nothing folds, so its room is known before it is
 * needed.
 */
function MoreMenu({
  folded,
  onOpen,
}: {
  readonly folded: ReadonlyArray<ConversationStripEntry>;
  readonly onOpen: (threadId: ThreadId) => void;
}): ReactNode {
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            className={cn(
              GLYPH_BUTTON,
              "w-auto gap-1 px-2 text-line font-medium tabular-nums",
              folded.length === 0 && "invisible absolute start-0 top-0",
            )}
            data-chat-header-ghost
            data-conversation-strip-more
            tabIndex={folded.length === 0 ? -1 : undefined}
            type="button"
          />
        }
      >
        {/* Unseen while nothing folds, it holds a count's room. */}
        {folded.length === 0 ? 9 : folded.length} more
        <ChevronDownIcon aria-hidden="true" className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        {folded.map((entry) => (
          <MenuItem
            disabled={entry.threadId === null}
            key={entry.key}
            onClick={() => {
              if (entry.threadId !== null) onOpen(entry.threadId);
            }}
          >
            <MateFace size="sm" state={entry.face.state} tint={entry.face.tint} />
            <span className="min-w-0 flex-1 truncate">{entry.role ?? entry.label}</span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

export interface ConversationStripProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** The chat on screen; null on a chat not sent yet. */
  readonly currentThreadId: ThreadId | null;
  /**
   * Groups drawn after the chats, each a step apart — the crew's crewmates.
   * An empty group draws nothing.
   */
  readonly extraGroups?: ReadonlyArray<ConversationStripGroup>;
}

const NO_GROUPS: ReadonlyArray<ConversationStripGroup> = [];

/** The Mate's chats, main first, and their entries; null where no Mate lives. */
function useMateChatEntries(
  environmentId: EnvironmentId,
  currentThreadId: ThreadId | null,
): {
  readonly chats: ReadonlyArray<EnvironmentThreadShell>;
  readonly entries: ReadonlyArray<ConversationStripEntry>;
} | null {
  const whoLivesHere = useZeropsMate(environmentId);
  const shells = useThreadShells();
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const mate = whoLivesHere.kind === "mate" ? whoLivesHere.mate : null;
  return useMemo(() => {
    if (mate === null) return null;
    const chats = mateChats(shells.filter((thread) => thread.environmentId === environmentId));
    const entries = chatEntries({
      chats,
      currentThreadId,
      startingChat: currentThreadId === null,
      mate: { name: mate.name, tint: mate.tint, connected: mate.connected },
      lastVisitedAtById,
    });
    return { chats, entries };
  }, [currentThreadId, environmentId, lastVisitedAtById, mate, shells]);
}

/**
 * The strip's groups after the chats: the Mate's crew, read off its crew view
 * (`useCrew`); nothing where no crew is applied.
 */
export function useCrewStripGroups({
  environmentId,
  currentThreadId,
  view,
}: {
  readonly environmentId: EnvironmentId;
  readonly currentThreadId: ThreadId | null;
  readonly view: CrewView<EnvironmentThreadShell> | null;
}): ReadonlyArray<ConversationStripGroup> {
  const whoLivesHere = useZeropsMate(environmentId);
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const connected = whoLivesHere.kind === "mate" && whoLivesHere.mate.connected;
  return useMemo(
    () => [crewEntries({ view, currentThreadId, connected, lastVisitedAtById })],
    [connected, currentThreadId, lastVisitedAtById, view],
  );
}

/**
 * New chat for the header of a Mate with one chat, where no strip is drawn to
 * hold one; null wherever the strip has its own, or no Mate lives here.
 */
export function useLoneChatNewChat({
  environmentId,
  projectId,
  currentThreadId,
  extraGroups = NO_GROUPS,
}: Omit<ConversationStripProps, "projectId"> & {
  /** Null while the conversation's project is not known yet. */
  readonly projectId: ProjectId | null;
}): (() => void) | null {
  const mateChatEntries = useMateChatEntries(environmentId, currentThreadId);
  const handleNewThread = useNewThreadHandler();
  if (
    projectId === null ||
    mateChatEntries === null ||
    !loneChatNewChatShown(mateChatEntries.entries, extraGroups)
  ) {
    return null;
  }
  return () => void handleNewThread(scopeProjectRef(environmentId, projectId), { chat: true });
}

/**
 * Whether the strip holds the header's line: where a Mate lives with a second
 * chat, or with a crew. Otherwise the header names the Mate itself.
 */
export function useConversationStripShown({
  environmentId,
  currentThreadId,
  extraGroups = NO_GROUPS,
}: Omit<ConversationStripProps, "projectId">): boolean {
  const mateChatEntries = useMateChatEntries(environmentId, currentThreadId);
  return mateChatEntries !== null && stripShown(mateChatEntries.entries, extraGroups);
}

/**
 * Every conversation on a Mate's page, as the header's line: nothing where no
 * Mate lives, and nothing for a Mate with one chat and no crew — the line
 * appears with a second chat or a crew.
 */
export function ConversationStrip({
  environmentId,
  projectId,
  currentThreadId,
  extraGroups = NO_GROUPS,
}: ConversationStripProps) {
  const mateChatEntries = useMateChatEntries(environmentId, currentThreadId);
  const pinningSupported =
    useEnvironment(environmentId)?.serverConfig?.environment.capabilities.threadPinning === true;
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const { archiveThread, pinThread, unpinThread } = useThreadActions();

  if (mateChatEntries === null || !stripShown(mateChatEntries.entries, extraGroups)) return null;
  const { chats, entries } = mateChatEntries;

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
          title: blocked ? CLOSE_HELD : "Couldn't close the chat",
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
    <ConversationStripView
      canMakeMain={pinningSupported}
      groups={[{ id: "chats", label: "Chats", entries }, ...extraGroups]}
      onClose={(entry) => void close(entry)}
      onMakeMain={(entry) => void makeMain(entry)}
      onNewChat={() =>
        void handleNewThread(scopeProjectRef(environmentId, projectId), { chat: true })
      }
      onOpen={open}
    />
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

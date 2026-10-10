import { ConversationOpeningAvatar } from "./ConversationOpeningStage";
import { useAtomValue } from "@effect/atom-react";
import { environmentActivitiesAtom } from "../../zerops/mateActivityAtoms";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ChevronDownIcon, MessagesSquareIcon } from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { ThreadArchiveBlockedError, useThreadActions } from "~/hooks/useThreadActions";
import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useUiStateStore } from "~/uiStateStore";
import { useCrew, useMateCrew } from "~/zerops/crew/useCrew";
import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import { useMateFaceFacts } from "~/zerops/useMateFace";
import { useMateHeaderCues } from "~/zerops/useMateMoments";
import { useKnownMate, useZeropsMate } from "~/zerops/useZeropsMates";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CrewmateMenu } from "../zerops/crew/CrewmateMenu";
import { crewFaces } from "../zerops/crew/SidebarCrewLine.logic";
import { MateFace } from "../zerops/primitives";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import {
  alsoWorkingLine,
  crewmateAccessibleName,
  foldCrew,
  lineChats,
  lineCrew,
  lineLeaving,
  lineMate,
  lineMotion,
  lineStage,
  mateChats,
  mateWorks,
  mateWords,
  sameLineStage,
  type CrewRoom,
  type LineChats,
  type LineCrewmate,
  type LineMate,
  type LineStage,
} from "./ConversationStrip.logic";
import { LineMotion } from "./ConversationStripMotion";

/** Between two faces of the crew (`gap-0.5`). */
const CREW_GAP_PX = 2;

const isArchiveBlocked = Schema.is(ThreadArchiveBlockedError);

/** Why a chat mid-turn keeps its close. */
const CLOSE_HELD = "Stop the agent before closing this chat";

/**
 * A crewmate's face at 20 px: at rest while it is only remembered, and a slot
 * of its size while its tint is not known yet.
 */
function CrewmateFace({ crewmate }: { readonly crewmate: LineCrewmate }) {
  if (crewmate.tint === null) return <span aria-hidden="true" className="size-5 shrink-0" />;
  return (
    <MateFace greets known={crewmate.known} size="sm" state={crewmate.face} tint={crewmate.tint} />
  );
}

/** Who a crewmate is, on hover: its name, whose crew it is on, and its job's first sentence. */
function CrewmateTooltip({ crewmate }: { readonly crewmate: LineCrewmate }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span>
        <span className="font-medium">{crewmate.name}</span>
        {crewmate.role}
      </span>
      {crewmate.job === null ? null : <span className="text-muted-foreground">{crewmate.job}</span>}
    </span>
  );
}

/**
 * The Mate's chats, from the ⌄ after its name — only while it holds more than
 * one: the main one first and marked, the one on screen checked, and *Close
 * this chat* for one on screen that is not the main one.
 */
function MateChatsMenu({
  mateName,
  chats,
  onOpen,
  onClose,
}: {
  readonly mateName: string;
  readonly chats: LineChats;
  readonly onOpen: (threadId: ThreadId) => void;
  readonly onClose: (chat: NonNullable<LineChats["close"]>) => void;
}) {
  const open = chats.chats.find((chat) => chat.open)?.threadId ?? "";
  const { close } = chats;
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            aria-label={`${mateName}'s chats`}
            className="me-1.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground"
            data-chat-header-ghost
            data-conversation-chats
            type="button"
          />
        }
      >
        <ChevronDownIcon aria-hidden="true" className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-72">
        <MenuRadioGroup
          onValueChange={(value: string) => {
            const chat = chats.chats.find((each) => each.threadId === value);
            if (chat !== undefined && !chat.open) onOpen(chat.threadId);
          }}
          value={open}
        >
          {chats.chats.map((chat) => (
            <MenuRadioItem key={chat.threadId} value={chat.threadId} variant="check">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate">{chat.title}</span>
                {chat.main ? (
                  <span className="shrink-0 text-xs text-muted-foreground">main</span>
                ) : null}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {close === null ? null : (
          <>
            <MenuSeparator />
            <MenuItem disabled={close.busy} onClick={() => onClose(close)}>
              Close this chat
            </MenuItem>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}

/**
 * Whether the text in the element it is given ends in an ellipsis: measured
 * before paint after every draw — its words may change while its box keeps
 * its size — and whenever its box changes size.
 */
function useCut(): readonly [(node: HTMLElement | null) => void, boolean] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const measure = () => setCut(node !== null && node.scrollWidth > node.clientWidth);
    measure();
  });
  useLayoutEffect(() => {
    if (node === null) return;
    const observer = new ResizeObserver(() => setCut(node.scrollWidth > node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, node !== null && cut];
}

/**
 * Whether something drawn now came after the first paint: a subject the
 * line was first painted without — the first words sent — arrives; one
 * there from the start is simply there.
 */
function useArrival(present: boolean): boolean {
  const [seen, setSeen] = useState({ present, arrived: false });
  if (seen.present === present) return seen.arrived;
  setSeen({ present, arrived: present });
  return present;
}

/**
 * The Mate, leading the line: its face at 24 and its name at 16/600 in ink.
 * A Mate with no crew writes what its chat is about after it, 14/400 muted
 * past a divider — cut off before the name ever is, and whole on hover once
 * it is (`mateWords`); with a crew the faces need the room, and the subject
 * is the name's hover. While its own chat is open a double-click renames that
 * chat, and — with a crew — it stands on the menu's selected band; with a
 * crewmate's chat on screen it is the same without the band, and a press
 * opens its own chat. A Mate with no crew is never on the band.
 */
function MatePill({
  mate,
  crew,
  chats,
  onOpen,
  onCloseChat,
  onRename,
}: {
  readonly mate: LineMate;
  /** It has a crew: the band says which conversation is on screen. */
  readonly crew: boolean;
  readonly chats: LineChats | null;
  readonly onOpen: (threadId: ThreadId) => void;
  readonly onCloseChat: (chat: NonNullable<LineChats["close"]>) => void;
  readonly onRename: (() => void) | null;
}) {
  const band = crew && mate.open;
  const opens = crew && !mate.open && mate.threadId !== null;
  const [subjectRef, cut] = useCut();
  const { subject, hover } = mateWords(mate, { crew, cut });
  const arrived = useArrival(subject !== null);
  // Its row's face, playing what the row's plays: each Mate's line is drawn anew (its `key`), so
  // the face greets only what changes while it is on screen, and only once it is read.
  const face = useMemo(
    () => (
      <MateFace
        className="size-6"
        cues={mate.cues}
        greets
        known={mate.known ?? false}
        restarting={mate.restarting}
        shape={mate.shape}
        size="sm"
        state={mate.face}
        tint={mate.tint}
      />
    ),
    [mate.cues, mate.known, mate.restarting, mate.shape, mate.face, mate.tint],
  );
  const name = (
    <span className="max-w-48 shrink-0 truncate text-base leading-6 font-semibold text-foreground">
      {mate.name}
    </span>
  );
  const press = (
    <button
      aria-current={mate.open ? "page" : undefined}
      aria-label={mate.open ? mate.name : (mate.tooltip ?? mate.name)}
      className={cn(
        "conversation-mate-press flex h-8 min-w-0 items-center gap-2.5 ps-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        chats === null ? "pe-3" : "pe-1",
        opens ? "cursor-pointer" : "cursor-default",
      )}
      data-conversation-mate-press
      onClick={() => {
        if (opens && mate.threadId !== null) onOpen(mate.threadId);
      }}
      onDoubleClick={(event: ReactMouseEvent) => {
        if (!mate.open || onRename === null) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        onRename();
      }}
      type="button"
    >
      <ConversationOpeningAvatar>{face}</ConversationOpeningAvatar>
      {name}
      {subject === null ? null : (
        // Arriving after the line stands, it fades in where it stays: the
        // name before it never moves.
        <span
          className="conversation-subject flex min-w-0 items-center gap-2.5"
          data-arrived={arrived ? "" : undefined}
          data-conversation-subject=""
        >
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
          <span className="min-w-0 truncate text-sm text-muted-foreground" ref={subjectRef}>
            {subject}
          </span>
        </span>
      )}
    </button>
  );
  return (
    <div
      className={cn(
        "conversation-mate flex h-8 min-w-0 items-center",
        // Only a subject gives way to the line's end; the name never does.
        subject === null && "shrink-0",
      )}
      data-conversation-mate
      data-on={band ? "" : undefined}
      data-opens={opens ? "" : undefined}
    >
      {/* One tree with or without a hover, so the press never remounts as one comes or goes. */}
      <Tooltip disabled={hover === null}>
        <TooltipTrigger render={press} />
        {hover === null ? null : (
          <TooltipPopup align="start" side="bottom">
            {hover}
          </TooltipPopup>
        )}
      </Tooltip>
      {chats === null ? null : (
        <MateChatsMenu chats={chats} mateName={mate.name} onClose={onCloseChat} onOpen={onOpen} />
      )}
    </div>
  );
}

/**
 * The pill's press, over its seat: pressing it opens the crewmate's menu.
 * Transparent — the band under the seat is the pill's ground.
 */
function PillPress({
  crewmate,
  menu,
}: {
  readonly crewmate: LineCrewmate;
  readonly menu: ReactNode;
}) {
  return (
    <Menu>
      <MenuTrigger
        disabled={menu === null}
        render={
          <button
            aria-current="page"
            aria-label={crewmateAccessibleName(crewmate)}
            className="conversation-crewmate absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            data-conversation-crewmate={crewmate.handle}
            data-current="true"
            type="button"
          />
        }
      />
      {menu}
    </Menu>
  );
}

/** A face's press, over its seat: pressing it opens the crewmate's chat; who it is on hover. */
function FacePress({
  crewmate,
  folded,
  onOpen,
}: {
  readonly crewmate: LineCrewmate;
  readonly folded: boolean;
  readonly onOpen: (threadId: ThreadId) => void;
}) {
  const threadId = crewmate.threadId;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={crewmateAccessibleName(crewmate)}
            className={cn(
              "conversation-crewface absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
              threadId === null ? "cursor-default" : "cursor-pointer",
            )}
            data-conversation-crewmate={crewmate.handle}
            onClick={() => {
              if (threadId !== null) onOpen(threadId);
            }}
            tabIndex={folded ? -1 : undefined}
            type="button"
          />
        }
      />
      <TooltipPopup align="start" side="bottom">
        <CrewmateTooltip crewmate={crewmate} />
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * A crewmate's name at 14/500 and its ⌄: in the pill while its chat is on
 * screen, and for a moment after — out of the line's flow, where it stood —
 * while it folds back into the face (`ConversationStripMotion.tsx`). It
 * starts at the face's edge and clips there, so what folds back goes behind
 * it; its words sit in a window the motion slides open and shut, the ⌄
 * riding at the window's edge.
 */
function SeatName({ name, leaving }: { readonly name: string; readonly leaving: boolean }) {
  return (
    <span
      aria-hidden={leaving ? "true" : undefined}
      className={cn(
        "pointer-events-none flex min-w-0 items-center gap-2 overflow-hidden ps-2",
        leaving ? "absolute inset-y-0 start-6" : "relative",
      )}
      data-conversation-label={leaving ? "leaving" : "open"}
    >
      <span className="min-w-0 overflow-hidden" data-conversation-name="">
        <span
          className="block truncate text-sm leading-5 font-medium text-foreground"
          data-conversation-name-text=""
        >
          {name}
        </span>
      </span>
      <ChevronDownIcon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
        data-conversation-chevron=""
      />
    </span>
  );
}

/**
 * One crewmate's place on the line for as long as it is on it: its face at
 * 20 in a 28 px seat, and — while its chat is on screen — its name and ⌄
 * beside it, the seat a pill on the band. The seat is one element whichever
 * it is, its face and name drawn once, so a switch turns a face into the pill
 * and back without drawing either again; only the press over it changes —
 * the pill's opens its menu, a face's opens its chat.
 */
function CrewSeat({
  crewmate,
  folded,
  squeezed,
  leaving,
  menu,
  onOpen,
}: {
  readonly crewmate: LineCrewmate;
  /** Folded into *N more*: out of the line, kept only to be measured. */
  readonly folded: boolean;
  /**
   * The line holds nothing else of the crew, not even *N more*: the pill's
   * name gives way. Otherwise it keeps its width, so what is measured is what
   * it needs, and the other faces fold first.
   */
  readonly squeezed: boolean;
  /** Its chat was just left: its name folds back into its face. */
  readonly leaving: boolean;
  /** The pill's menu: its popup, or `null` while its crew is not read. */
  readonly menu: ReactNode;
  readonly onOpen: (threadId: ThreadId) => void;
}) {
  const open = crewmate.open;
  return (
    <span
      className={cn(
        "relative flex h-7 items-center rounded-lg",
        open ? "ps-1 pe-2" : "px-1",
        open && squeezed ? "min-w-15.5" : "shrink-0",
        folded && "invisible absolute start-0 top-0",
      )}
      data-conversation-seat={crewmate.handle}
    >
      {open ? (
        <PillPress crewmate={crewmate} menu={menu} />
      ) : (
        <FacePress crewmate={crewmate} folded={folded} onOpen={onOpen} />
      )}
      <span aria-hidden="true" className="pointer-events-none relative flex">
        <CrewmateFace crewmate={crewmate} />
      </span>
      {open || leaving ? <SeatName leaving={!open} name={crewmate.name} /> : null}
    </span>
  );
}

/**
 * *N more* at the crew's end, opening what folded: each with its face and
 * name. Drawn unseen while nothing folds, so its room is known before it is
 * needed.
 */
function MoreCrew({
  folded,
  shown,
  onOpen,
}: {
  readonly folded: ReadonlyArray<LineCrewmate>;
  /** Drawn in the line; unseen otherwise, still measured. */
  readonly shown: boolean;
  readonly onOpen: (threadId: ThreadId) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            className={cn(
              "flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 text-line font-medium text-muted-foreground tabular-nums outline-none transition-colors hover:bg-sidebar-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-hover data-popup-open:text-foreground",
              !shown && "invisible absolute start-0 top-0",
            )}
            data-chat-header-ghost
            data-conversation-more
            tabIndex={shown ? undefined : -1}
            type="button"
          />
        }
      >
        {/* Unseen while nothing folds, it holds a count's room. */}
        {folded.length === 0 ? 9 : folded.length} more
        <ChevronDownIcon aria-hidden="true" className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        {folded.map((crewmate) => (
          <MenuItem
            disabled={crewmate.threadId === null}
            key={crewmate.handle}
            onClick={() => {
              if (crewmate.threadId !== null) onOpen(crewmate.threadId);
            }}
          >
            <CrewmateFace crewmate={crewmate} />
            <span className="min-w-0 flex-1 truncate">{crewmate.name}</span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/**
 * The crew's room on the line, measured before paint and again whenever the
 * line or a seat changes size — a panel opening, a name settling. A folded
 * seat stays in the line, out of the flow and unseen, so its width is always
 * known.
 */
function useCrewRoom(): {
  readonly ref: (line: HTMLElement | null) => void;
  readonly room: CrewRoom | null;
} {
  const [line, setLine] = useState<HTMLElement | null>(null);
  const [room, setRoom] = useState<CrewRoom | null>(null);
  useLayoutEffect(() => {
    if (line === null) return;
    const widthOf = (selector: string) =>
      line.querySelector(selector)?.getBoundingClientRect().width ?? 0;
    const measure = () => {
      const widths = new Map<string, number>();
      for (const seat of line.querySelectorAll<HTMLElement>("[data-conversation-seat]")) {
        widths.set(seat.dataset.conversationSeat ?? "", seat.getBoundingClientRect().width);
      }
      const gap = Number.parseFloat(getComputedStyle(line).columnGap) || 0;
      const next: CrewRoom = {
        width:
          line.getBoundingClientRect().width -
          widthOf("[data-conversation-mate]") -
          widthOf("[data-conversation-divider]") -
          2 * gap,
        widths,
        gap: CREW_GAP_PX,
        more: widthOf("[data-conversation-more]") + CREW_GAP_PX,
      };
      setRoom((previous) => (sameRoom(previous, next) ? previous : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(line);
    for (const child of line.querySelectorAll(
      "[data-conversation-mate], [data-conversation-seat]",
    )) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  });
  return { ref: setLine, room };
}

function sameRoom(left: CrewRoom | null, right: CrewRoom): boolean {
  if (left === null || left.width !== right.width || left.more !== right.more) return false;
  if (left.widths.size !== right.widths.size) return false;
  for (const [key, width] of right.widths) if (left.widths.get(key) !== width) return false;
  return true;
}

export interface ConversationStripViewProps {
  readonly mate: LineMate;
  /** The Mate's chats, while it holds more than one. */
  readonly chats: LineChats | null;
  /** The crew, the lead first; `null` for a Mate with no crew. */
  readonly crew: ReadonlyArray<LineCrewmate> | null;
  /** The rename field, over the line from the Mate's name while its chat is renamed. */
  readonly renameField: ReactNode;
  /** The open crewmate's menu: its popup, or `null` while its crew is not read. */
  readonly renderCrewmateMenu: (crewmate: LineCrewmate) => ReactNode;
  readonly onOpen: (threadId: ThreadId) => void;
  readonly onCloseChat: (chat: NonNullable<LineChats["close"]>) => void;
  readonly onRename: (() => void) | null;
}

/**
 * The top of a conversation, one line: the Mate, then — with a crew — a
 * divider and the crew's faces, the crewmate on screen a pill on the band;
 * where the line runs out, faces other than the one on screen fold into
 * *N more*. A face's state and a remembered crew turning live change no
 * width. Switching conversations is one move (`lineMotion`): the band
 * travels, the seats between slide, the name left folds back into its face
 * and the one opened opens out of its own (`ConversationStripMotion.tsx`).
 */
export function ConversationStripView({
  mate,
  chats,
  crew,
  renameField,
  renderCrewmateMenu,
  onOpen,
  onCloseChat,
  onRename,
}: ConversationStripViewProps) {
  const { ref, room } = useCrewRoom();
  const { visible, folded, more } = foldCrew(crew ?? [], crew === null ? null : room);
  const shown = new Set(visible);
  // Which names are folding back into their faces: the one whose chat was
  // just left, for as long as its fold runs.
  const stage = lineStage(mate, crew);
  const [moved, setMoved] = useState<{
    readonly stage: LineStage;
    readonly leaving: ReadonlyArray<string>;
  }>({ stage, leaving: [] });
  if (!sameLineStage(moved.stage, stage)) {
    const motion = lineMotion(moved.stage, stage, { reducedMotion: false });
    setMoved({ stage, leaving: lineLeaving(moved, stage, motion) });
  }
  const leaving = new Set(moved.leaving);
  const onNameFolded = (handle: string) =>
    setMoved((current) =>
      current.leaving.includes(handle)
        ? { ...current, leaving: current.leaving.filter((each) => each !== handle) }
        : current,
    );
  return (
    // The header's own line: the Mate's face on the header's face column, its
    // band reaching into the gutter, and behind everything on it.
    <nav
      aria-label="Conversations"
      className={cn(
        "relative isolate -ms-2 flex min-w-0 flex-1 items-center",
        crew !== null && "gap-3.5",
      )}
      data-conversation-strip
      ref={ref}
    >
      <LineMotion onFolded={onNameFolded} stage={stage} />
      <MatePill
        chats={chats}
        crew={crew !== null}
        mate={mate}
        onCloseChat={onCloseChat}
        onOpen={onOpen}
        onRename={onRename}
      />
      {crew === null ? null : (
        <>
          <span
            aria-hidden="true"
            className="h-4 w-px shrink-0 bg-border"
            data-conversation-divider
          />
          <div
            aria-label="Crew"
            className="relative flex min-w-0 items-center gap-0.5"
            data-conversation-crew
            role="group"
          >
            {crew.map((crewmate) => (
              <CrewSeat
                crewmate={crewmate}
                folded={!shown.has(crewmate)}
                key={crewmate.handle}
                leaving={leaving.has(crewmate.handle)}
                menu={crewmate.open ? renderCrewmateMenu(crewmate) : null}
                onOpen={onOpen}
                squeezed={folded.length > 0 && !more}
              />
            ))}
            <MoreCrew folded={folded} onOpen={onOpen} shown={more} />
          </div>
        </>
      )}
      {renameField}
    </nav>
  );
}

export interface ConversationStripProps {
  readonly environmentId: EnvironmentId;
  /** The chat on screen; `null` for one being started. */
  readonly currentThreadId: ThreadId | null;
  /** The chat on screen, when it is a crewmate's: whose, and its title. */
  readonly crewChat: { readonly handle: string; readonly title: string } | null;
  /** What the chat on screen is about, when it is the Mate's own: its hover. */
  readonly subject: string | null;
  readonly renameField: ReactNode;
  /** Renames the Mate's chat on screen; `null` where it cannot be renamed. */
  readonly onRename: (() => void) | null;
  /** *Change its job*: the crew's Crewmate editor on that crewmate. */
  readonly onEditJob: (handle: string) => void;
  /** *Change the brief*: the crew's Brief editor. */
  readonly onEditBrief: () => void;
}

/**
 * The line where a Mate lives: its chats read off the thread shells, its crew
 * off the crew's feed — or, until the feed answers, the crew HQ holds of it
 * (`useMateCrew`) — and its presses: opening a chat, closing one
 * of the Mate's, and a crewmate's menu. Nothing where no Mate lives.
 */
export function ConversationStrip({
  environmentId,
  currentThreadId,
  crewChat,
  subject,
  renameField,
  onRename,
  onEditJob,
  onEditBrief,
}: ConversationStripProps) {
  // Read, or remembered until read: a reload's header wears the Mate's face from its first frame.
  const mate = useKnownMate(environmentId) ?? null;
  const shells = useThreadShells();
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const { view } = useCrew(environmentId);
  const projectId = useMateOfEnvironment(environmentId)?.projectId;
  // Until its feed answers, the crew HQ holds of the Mate, at rest.
  const held = useMateCrew(projectId ?? null).crew;
  const router = useRouter();
  const { archiveThread } = useThreadActions();
  const chats = useMemo(
    () => mateChats(shells.filter((thread) => thread.environmentId === environmentId)),
    [environmentId, shells],
  );
  // The header's own events, then its Mate's face — the one its row in the menu wears (`mateFace`).
  const opened = useMateHeaderCues({ environmentId, currentThreadId });
  const face = useMateFaceFacts(environmentId, mate);
  const activityByThread = useAtomValue(environmentActivitiesAtom(environmentId));
  if (mate === null) return null;

  const crew = lineCrew({
    view,
    remembered: held === null ? undefined : { faces: crewFaces(held, false) },
    crewChat,
    mateName: mate.name,
    connected: mate.connected,
    lastVisitedAtById,
    activityByThread,
  });

  const open = (threadId: ThreadId) => {
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };

  // Closing the chat on screen lands on the main chat, never on a new one:
  // the move happens first, so archiving does not start a replacement.
  const close = async (chat: NonNullable<LineChats["close"]>) => {
    if (chat.busy) return;
    const main = chats[0];
    if (main !== undefined) {
      await router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, main.id)),
        replace: true,
      });
    }
    const result = await archiveThread(scopeThreadRef(environmentId, chat.threadId), {
      toast: { title: "Chat closed", description: `‘${chat.title}’ is under Archived.` },
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

  const shownMate = lineMate({
    mate,
    face,
    chats,
    crewChatOpen: crewChat !== null,
    subject,
  });
  return (
    // Another Mate's line is a line of its own: it is drawn anew, never travelled into.
    <ConversationStripView
      chats={lineChats(chats, currentThreadId, activityByThread)}
      crew={crew}
      key={environmentId}
      renderCrewmateMenu={(crewmate) =>
        !crewmate.known ? null : (
          <CrewmateMenu
            environmentId={environmentId}
            handle={crewmate.handle}
            mateName={mate.name}
            onEditBrief={onEditBrief}
            onEditJob={onEditJob}
          />
        )
      }
      mate={{ ...shownMate, cues: [...opened, ...(shownMate.cues ?? [])] }}
      onCloseChat={(chat) => void close(chat)}
      onOpen={open}
      onRename={onRename}
      renameField={renameField}
    />
  );
}

/** Whether the Mate living in `environmentId` is at work in any of its chats (`mateWorks`). */
export function useMateWorks(environmentId: EnvironmentId): boolean {
  const shells = useThreadShells();
  const activityByThread = useAtomValue(environmentActivitiesAtom(environmentId));
  return useMemo(
    () =>
      mateWorks(
        mateChats(shells.filter((thread) => thread.environmentId === environmentId)),
        activityByThread,
      ),
    [environmentId, shells, activityByThread],
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
  const activityByThread = useAtomValue(environmentActivitiesAtom(environmentId));
  const mateName = whoLivesHere.kind === "mate" ? whoLivesHere.mate.name : null;
  return useMemo(() => {
    if (mateName === null) return null;
    const line = alsoWorkingLine({
      mateName,
      chats: mateChats(shells.filter((thread) => thread.environmentId === environmentId)),
      currentThreadId,
      typing,
      activityByThread,
    });
    if (line === null) return null;
    return {
      id: "mate-also-working",
      variant: "default",
      icon: <MessagesSquareIcon />,
      title: line,
    };
  }, [currentThreadId, environmentId, mateName, shells, typing, activityByThread]);
}

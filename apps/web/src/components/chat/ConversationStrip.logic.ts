/**
 * The top of a conversation, one line (the owner, 2026-09-29): the Mate
 * leads it, then — only for a Mate with a crew — a divider and the crew's
 * faces. The conversation on screen stands on the menu's selected band: the
 * Mate while its own chat is open, else the crewmate whose chat it is, as a
 * pill with its name. Everything else is a face that opens its chat, and
 * says on hover who it is.
 *
 * A Mate is one agent with several chats over one tree; new ones are no
 * longer started, but a Mate may hold more than one from before. The main
 * chat is the one `resolvePrimaryConversation` answers — the pinned one once
 * there are two — so the menu's row, the index landing and every other caller
 * keep opening it. Everything here is read off the thread shells, the crew's
 * view and the one status resolver; nothing decides a status of its own
 * (R5). A face carries its state, as the menu's faces do: no status word
 * stands on the line, only in a face's accessible name.
 */
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import {
  crewJobSentence,
  crewmateRoleWords,
  mateOwnChatWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import { statusLabel } from "@t3tools/client-runtime/zerops/statusPresentation";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { ThreadId } from "@t3tools/contracts";
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
import {
  mateMarkStateForThreadStatus,
  resolveThreadStatus,
  type ThreadStatus,
} from "@t3tools/shared/threadStatus";

import type { MateFaceCue } from "~/components/zerops/primitives";
import { threadAgentActivity, type ZeropsAgentActivity, mateFaceFor } from "~/zerops/agentActivity";
import { mateFace, type MateFaceFacts } from "~/zerops/mateFace.logic";

function resolveChat(
  thread: EnvironmentThreadShell,
  lastVisitedAt: string | undefined,
): ThreadStatus {
  const activity = threadAgentActivity(thread, lastVisitedAt);
  return resolveThreadStatus(
    lastVisitedAt === undefined ? thread : { ...thread, lastVisitedAt },
    activity.limit?.kind,
  );
}

function lastVisitOf(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id">,
  lastVisitedAtById: Readonly<Record<string, string>>,
): string | undefined {
  return lastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))];
}

function createdAtOf(thread: Pick<EnvironmentThreadShell, "createdAt">): number {
  const parsed = Date.parse(thread.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One Mate's live chats: the main chat first, then the others in the order
 * they were started — a list that reshuffled on every message would move the
 * chat under the pointer.
 */
export function mateChats(
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<EnvironmentThreadShell> {
  const { primary, hidden } = resolvePrimaryConversation(threads);
  if (primary === undefined) return [];
  const others = [...hidden].sort(
    (left, right) => createdAtOf(left) - createdAtOf(right) || left.id.localeCompare(right.id),
  );
  return [primary, ...others];
}

/**
 * The chat to pin when a new one is first sent, or null. *Archive and start
 * fresh* in the main chat archives it and its pin goes with it; the chat that
 * takes its place is the new main one, so its first send takes the pin. That
 * is the one moment other chats are open and none of them is main.
 */
export function replacementChatToPin(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  sentThreadId: ThreadId,
): ThreadId | null {
  const others = mateChats(threads).filter((thread) => thread.id !== sentThreadId);
  if (others.length === 0 || others.some((thread) => thread.pinnedAt != null)) return null;
  return sentThreadId;
}

/** The Mate, as it leads the line. */
export interface LineMate {
  readonly name: string;
  readonly tint: MateTintId;
  /** The shape its person picked; its tint's own when absent. */
  readonly shape?: MateShapeId | undefined;
  /** Its face: the Mate's, as its row in the menu wears it (`mateFace`). */
  readonly face: MateMarkState;
  /** One of its own chats is on screen — or one being started: it stands on the band. */
  readonly open: boolean;
  /** The chat a press opens while another is on screen: its main chat; `null` while it has none. */
  readonly threadId: ThreadId | null;
  /**
   * On hover: what its chat on screen is about, or — while a crewmate's chat
   * is on screen — that a press opens its own; `null` for a chat nobody has
   * spoken into yet.
   */
  readonly tooltip: string | null;
  /** The events its face greets (`mateFace`), the header's own first (`useMateHeaderCues`). */
  readonly cues?: ReadonlyArray<MateFaceCue> | undefined;
  /** Its container is restarting: its face plays the restart while it lasts. */
  readonly restarting?: boolean | undefined;
  /** Its face is read, not a stand-in: only then does it greet a change. */
  readonly known?: boolean | undefined;
}

/**
 * The Mate leading its line. Its face is the Mate's, read from the facts its row in the menu reads
 * (`mateFace`) — never the chat on screen's alone: one Mate wears one face, in the menu and here.
 */
export function lineMate(input: {
  readonly mate: {
    readonly name: string;
    readonly tint: MateTintId;
    readonly shape?: MateShapeId | undefined;
  };
  /** What its face reads (`mateFace`). */
  readonly face: MateFaceFacts;
  /** The Mate's chats, main first (`mateChats`). */
  readonly chats: ReadonlyArray<EnvironmentThreadShell>;
  /** The chat on screen is a crewmate's. */
  readonly crewChatOpen: boolean;
  /** What the chat on screen is about, when it is one of the Mate's own. */
  readonly subject: string | null;
}): LineMate {
  const { mate, chats } = input;
  const open = !input.crewChatOpen;
  const face = mateFace(input.face);
  return {
    name: mate.name,
    tint: mate.tint,
    shape: mate.shape,
    face: face.state,
    open,
    threadId: chats[0]?.id ?? null,
    tooltip: open ? input.subject : mateOwnChatWord(mate.name),
    cues: face.cues,
    restarting: face.restarting,
    known: face.known,
  };
}

/**
 * What the Mate's press says after its name, and on hover (the owner,
 * 2026-09-29: "with a single mate it doesnt have to be in tooltip"). A Mate
 * with no crew has the line to itself: its chat's subject stands on it, and
 * is its hover only where the line cuts it off. With a crew the faces need
 * the room, and the subject — or, on a crewmate's chat, that a press opens
 * the Mate's own — stays the name's hover.
 */
export function mateWords(
  mate: Pick<LineMate, "open" | "tooltip">,
  line: {
    /** A crew stands on the line. */
    readonly crew: boolean;
    /** The subject, written on the line, ends in an ellipsis. */
    readonly cut: boolean;
  },
): { readonly subject: string | null; readonly hover: string | null } {
  if (line.crew || !mate.open) return { subject: null, hover: mate.tooltip };
  return { subject: mate.tooltip, hover: line.cut ? mate.tooltip : null };
}

/**
 * A Mate's chats, for the ⌄ after its name — only while it holds more than
 * one (new chats are no longer started): the main one first and marked, the
 * one on screen checked, and *Close this chat* for one on screen that is not
 * the main one. Closing waits while the chat is mid-turn: archiving refuses it.
 */
export interface LineChats {
  readonly chats: ReadonlyArray<{
    readonly threadId: ThreadId;
    readonly title: string;
    readonly main: boolean;
    readonly open: boolean;
  }>;
  readonly close: {
    readonly threadId: ThreadId;
    readonly title: string;
    readonly busy: boolean;
  } | null;
}

export function lineChats(
  chats: ReadonlyArray<EnvironmentThreadShell>,
  currentThreadId: ThreadId | null,
  activityByThread?: ReadonlyMap<ThreadId, ZeropsAgentActivity>,
): LineChats | null {
  if (chats.length < 2) return null;
  const open = chats.findIndex((chat) => chat.id === currentThreadId);
  const closing = open > 0 ? chats[open] : undefined;
  return {
    chats: chats.map((chat, index) => ({
      threadId: chat.id,
      title: chat.title,
      main: index === 0,
      open: index === open,
    })),
    close:
      closing === undefined
        ? null
        : {
            threadId: closing.id,
            title: closing.title,
            busy:
              closing.session?.status === "running" &&
              closing.session.activeTurnId != null &&
              (activityByThread?.get(closing.id) ?? threadAgentActivity(closing, undefined)).limit
                ?.kind === "none",
          },
  };
}

/** One crewmate on the line: a face that opens its chat, or — its chat on screen — its pill. */
export interface LineCrewmate {
  readonly handle: string;
  readonly name: string;
  /** Its tint; `null` for the crewmate on screen before its crew is read or remembered. */
  readonly tint: MateTintId | null;
  readonly face: MateMarkState;
  readonly lead: boolean;
  /** Its chat is the one on screen: a pill with its name and ⌄, on the band. */
  readonly open: boolean;
  /**
   * Read off the crew's feed: its face wears its state and its menu has what
   * to offer. A face drawn from memory, or from its chat alone, stands at rest.
   */
  readonly known: boolean;
  /** The chat a press opens; `null` before its first stint, or while drawn from memory. */
  readonly threadId: ThreadId | null;
  /** On hover, after its name: who it is (`crewmateRoleWords`). */
  readonly role: string;
  /** On hover, under that: its job's first sentence; `null` for the lead, or unread. */
  readonly job: string | null;
  /** The resolver's word, for its accessible name; `null` at rest. */
  readonly status: string | null;
}

/** A crew as HQ last told this tab of it (`useMateCrew`): its faces, the lead first. */
export interface RememberedLineCrew {
  readonly faces: ReadonlyArray<{
    readonly handle: string;
    readonly displayName: string;
    readonly tint: MateTintId;
    readonly lead: boolean;
  }>;
}

/**
 * The crew on the line, the lead first — or `null` for a Mate with no crew,
 * which draws no divider and no faces. Read from the crew's feed once it is
 * applied; until the feed answers, from the crew HQ holds of it, each face
 * at rest, so a reload paints the line it keeps; and in a
 * crewmate's chat with neither, that crewmate alone, named as its chat was
 * (its title is its name when its stint began). A crewmate is one person
 * across its conversations: it is on screen in any of its stints, a retired
 * one too, and a press opens the stint it talks in now.
 */
export function lineCrew(input: {
  readonly view: CrewView<EnvironmentThreadShell> | null;
  readonly remembered: RememberedLineCrew | undefined;
  /** The chat on screen, when it is a crewmate's: whose, and its title. */
  readonly crewChat: { readonly handle: string; readonly title: string } | null;
  readonly mateName: string;
  /** The Mate's container is connected; its crew sleeps with it otherwise. */
  readonly connected: boolean;
  readonly lastVisitedAtById: Readonly<Record<string, string>>;
  readonly activityByThread?: ReadonlyMap<ThreadId, ZeropsAgentActivity>;
}): ReadonlyArray<LineCrewmate> | null {
  const { view, crewChat, mateName } = input;
  const opens = (handle: string) => crewChat?.handle === handle;
  if (view !== null && view.status === "applied" && view.crewmates.length > 0) {
    return view.crewmates.map(({ crewmate, shell }): LineCrewmate => {
      const status =
        shell === null
          ? null
          : (input.activityByThread?.get(shell.id) ??
            resolveChat(shell, lastVisitOf(shell, input.lastVisitedAtById)));
      const lead = crewmate.kind === "lead";
      return {
        handle: crewmate.handle,
        name: crewmate.displayName,
        tint: crewmate.tint,
        face: mateFaceFor(
          input.connected,
          status === null
            ? undefined
            : { face: "face" in status ? status.face : mateMarkStateForThreadStatus(status.kind) },
        ),
        lead,
        open: opens(crewmate.handle),
        known: true,
        threadId: crewmate.currentThreadId,
        role: crewmateRoleWords(mateName, lead),
        job: lead ? null : crewJobSentence(crewmate.jobFirstLine, crewmate.displayName) || null,
        status: status === null ? null : statusLabel(status.kind),
      };
    });
  }
  // The feed has answered with no crew: none is drawn, save the chat on screen's own.
  const read = view !== null;
  const faces = read ? [] : (input.remembered?.faces ?? []);
  const atRest = mateFaceFor(input.connected, undefined);
  const drawn = faces.map((face): LineCrewmate => ({
    handle: face.handle,
    name: face.displayName,
    tint: face.tint,
    face: atRest,
    lead: face.lead,
    open: opens(face.handle),
    known: false,
    threadId: null,
    role: crewmateRoleWords(mateName, face.lead),
    job: null,
    status: null,
  }));
  if (crewChat === null || drawn.some((face) => face.open)) {
    return drawn.length === 0 ? null : drawn;
  }
  return [
    ...drawn,
    {
      handle: crewChat.handle,
      name: crewChat.title,
      tint: null,
      face: atRest,
      lead: false,
      open: true,
      known: false,
      threadId: null,
      role: crewmateRoleWords(mateName, false),
      job: null,
      status: null,
    },
  ];
}

/** A face's accessible name: who it is, then what it is doing. */
export function crewmateAccessibleName(
  crewmate: Pick<LineCrewmate, "name" | "role" | "status">,
): string {
  const who = `${crewmate.name}${crewmate.role}`;
  return crewmate.status === null ? who : `${who}, ${crewmate.status}`;
}

/** The room the crew has on the line, measured off the page. */
export interface CrewRoom {
  /** What the crew's group may take: the line less the Mate and the divider. */
  readonly width: number;
  /** Each crewmate's drawn width, by handle. */
  readonly widths: ReadonlyMap<string, number>;
  /** Between two neighbours. */
  readonly gap: number;
  /** *N more*, with its gap: room it takes once anything folds. */
  readonly more: number;
}

/**
 * Folds the crew's tail into *N more* when the line cannot hold every face
 * at its drawn width. The crewmate on screen never folds — the face before it
 * goes instead — so the line always shows where you are; the Mate is not the
 * crew's and never folds either. Where even the crewmate on screen and
 * *N more* do not fit side by side — a phone — *N more* gives way and the
 * crewmate's name narrows; the others are a face away in the menu's crew
 * line. Unmeasured (`null`), nothing folds.
 */
export function foldCrew(
  crew: ReadonlyArray<LineCrewmate>,
  room: CrewRoom | null,
): {
  readonly visible: ReadonlyArray<LineCrewmate>;
  readonly folded: ReadonlyArray<LineCrewmate>;
  /** *N more* is drawn: something folded, and it fits. */
  readonly more: boolean;
} {
  const used = (kept: ReadonlyArray<LineCrewmate>, more: boolean): number =>
    kept.reduce((sum, entry) => sum + (room?.widths.get(entry.handle) ?? 0), 0) +
    (room?.gap ?? 0) * Math.max(0, kept.length - 1) +
    (more ? (room?.more ?? 0) : 0);
  if (room === null || used(crew, false) <= room.width) {
    return { visible: crew, folded: [], more: false };
  }
  const open = crew.find((entry) => entry.open);
  const keptOf = (count: number): ReadonlyArray<LineCrewmate> => {
    const head = crew.slice(0, count);
    if (open === undefined || head.includes(open)) return head;
    return [...head.slice(0, Math.max(0, count - 1)), open];
  };
  let kept = keptOf(open === undefined ? 0 : 1);
  for (let count = crew.length - 1; count > 0; count -= 1) {
    const candidate = keptOf(count);
    if (used(candidate, true) <= room.width) {
      kept = candidate;
      break;
    }
  }
  const shown = new Set(kept);
  return {
    visible: crew.filter((entry) => shown.has(entry)),
    folded: crew.filter((entry) => !shown.has(entry)),
    more: used(kept, true) <= room.width,
  };
}

/**
 * The Mate's own place on the band. No crewmate's handle (`[a-z0-9-]`) is
 * ever this, so one key names either.
 */
export const MATE_SEAT = "@mate";

/** The line as its motion reads it: where the band stands, and the crew in its order. */
export interface LineStage {
  /** The Mate (`MATE_SEAT`) or the crewmate whose chat is on screen; `null` for a Mate with no crew. */
  readonly band: string | null;
  /** The crew's handles, the lead first; `null` for a Mate with no crew. */
  readonly crew: ReadonlyArray<string> | null;
}

export function lineStage(
  mate: Pick<LineMate, "open">,
  crew: ReadonlyArray<Pick<LineCrewmate, "handle" | "open">> | null,
): LineStage {
  if (crew === null) return { band: null, crew: null };
  const open = crew.find((entry) => entry.open);
  return {
    band: mate.open || open === undefined ? MATE_SEAT : open.handle,
    crew: crew.map((entry) => entry.handle),
  };
}

function sameCrew(
  left: ReadonlyArray<string> | null,
  right: ReadonlyArray<string> | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.length === right.length && left.every((handle, index) => handle === right[index]);
}

export function sameLineStage(left: LineStage, right: LineStage): boolean {
  return left.band === right.band && sameCrew(left.crew, right.crew);
}

/**
 * How the line goes from one drawing to the next (the owner, 2026-09-29:
 * "why isn't the transition between these ten time more smooth, animated,
 * beautiful?"). The band travels — the faces between sliding, the name left
 * folding back into its face and the one opened opening out of its own —
 * only when the conversation on screen changed between two drawings of the
 * same crew: a switch the person made, on the line, in the menu or back
 * through history, since nothing else changes it. A first paint, a reload,
 * the crew arriving and a crewmate added or removed are placed where they
 * stand. With reduced motion what would travel cross-fades instead.
 */
export function lineMotion(
  previous: LineStage | null,
  next: LineStage,
  options: { readonly reducedMotion: boolean },
): "travel" | "fade" | "place" {
  if (previous === null || previous.band === null || next.band === null) return "place";
  if (previous.band === next.band || !sameCrew(previous.crew, next.crew)) return "place";
  return options.reducedMotion ? "fade" : "travel";
}

/**
 * The crewmates whose names are folding back into their faces after a move:
 * the one whose chat was left — the Mate's name never folds — and any still
 * folding from a press before, less the one opened again. A line placed has
 * none.
 */
export function lineLeaving(
  previous: { readonly stage: LineStage; readonly leaving: ReadonlyArray<string> },
  next: LineStage,
  motion: "travel" | "fade" | "place",
): ReadonlyArray<string> {
  if (motion === "place") return [];
  const left = previous.stage.band;
  const folding =
    left === null || left === MATE_SEAT || left === next.band
      ? previous.leaving
      : [...previous.leaving.filter((handle) => handle !== left), left];
  return folding.filter((handle) => handle !== next.band);
}

/**
 * Whether the Mate is at work in any of its chats (`mateChats`): a turn running, or helpers it
 * started still running after the turn. A watch loop alone is not work.
 */
export function mateWorks(
  chats: ReadonlyArray<EnvironmentThreadShell>,
  activityByThread?: ReadonlyMap<ThreadId, ZeropsAgentActivity>,
): boolean {
  return chats.some(
    (chat) => (activityByThread?.get(chat.id) ?? resolveChat(chat, undefined)).kind === "working",
  );
}

/**
 * The quiet line over the composer while you type in one chat and the Mate is
 * at work in another: nothing is refused — two chats are two terminals on one
 * tree — but the person should know both are changing the same files. The
 * main chat is named first; otherwise the first other chat that works.
 */
export function alsoWorkingLine(input: {
  readonly mateName: string;
  /** The Mate's chats, main first (`mateChats`). */
  readonly chats: ReadonlyArray<EnvironmentThreadShell>;
  readonly currentThreadId: ThreadId | null;
  readonly typing: boolean;
  readonly activityByThread?: ReadonlyMap<ThreadId, ZeropsAgentActivity>;
}): string | null {
  if (!input.typing) return null;
  const index = input.chats.findIndex(
    (chat) =>
      chat.id !== input.currentThreadId &&
      (input.activityByThread?.get(chat.id) ?? resolveChat(chat, undefined)).kind === "working",
  );
  if (index < 0) return null;
  const where = index === 0 ? "your main chat" : `‘${input.chats[index]!.title}’`;
  return `${input.mateName} is also working in ${where} — both change the same files.`;
}

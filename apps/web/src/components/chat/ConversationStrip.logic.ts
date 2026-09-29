/**
 * The conversation strip: every conversation a Mate's page holds, one line
 * under its header — the Mate's chats, then its crew.
 *
 * A Mate is one agent with several chats over one tree. The main chat is the
 * one `resolvePrimaryConversation` answers — the pinned one once there are
 * two — so the sidebar row, the index landing and every other caller keep
 * opening it. Everything here is read off the thread shells and the one
 * status resolver; nothing decides a status of its own (R5). An entry's face
 * carries its state, as the menu's faces do: there is no status word on the
 * strip, only in an entry's accessible name.
 */
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import { crewFaceWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import { statusLabel } from "@t3tools/client-runtime/zerops/statusPresentation";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { ThreadId } from "@t3tools/contracts";
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import {
  mateMarkStateForThreadStatus,
  resolveThreadStatus,
  type ThreadStatus,
  type ThreadStatusInput,
} from "@t3tools/shared/threadStatus";

import { mateFaceFor } from "~/zerops/agentActivity";

function resolveChat(thread: ThreadStatusInput, lastVisitedAt: string | undefined): ThreadStatus {
  return resolveThreadStatus(lastVisitedAt === undefined ? thread : { ...thread, lastVisitedAt });
}

/**
 * What a chat is doing, as the one phrase producer words it: said in its
 * entry's accessible name, while its face shows it. Null for a chat with
 * nothing going on.
 */
export function chatStatus(
  thread: ThreadStatusInput,
  lastVisitedAt: string | undefined,
): string | null {
  return statusLabel(resolveChat(thread, lastVisitedAt).kind);
}

function createdAtOf(thread: Pick<EnvironmentThreadShell, "createdAt">): number {
  const parsed = Date.parse(thread.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One Mate's live chats: the main chat first, then the others in the order
 * they were started — a strip that reshuffled on every message would move the
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
 * The chat to pin as main when a second one is started, or null when nothing
 * needs writing: a chat is pinned already, or there is none. Pinning is what
 * keeps the first chat main — every caller of `resolvePrimaryConversation`
 * keeps opening it rather than whichever chat was spoken in last.
 */
export function mainChatToPin(threads: ReadonlyArray<EnvironmentThreadShell>): ThreadId | null {
  const live = threads.filter((thread) => thread.archivedAt === null);
  if (live.some((thread) => thread.pinnedAt != null)) return null;
  return resolvePrimaryConversation(live).primary?.id ?? null;
}

/**
 * The chat to pin when a new one is first sent, or null. *Archive and start
 * fresh* in the main chat archives it and its pin goes with it; the chat that takes its
 * place is the new main one, so its first send takes the pin. That is the one
 * moment other chats are open and none of them is main — a second chat
 * started from the strip pins the main chat before it exists.
 */
export function replacementChatToPin(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  sentThreadId: ThreadId,
): ThreadId | null {
  const others = mateChats(threads).filter((thread) => thread.id !== sentThreadId);
  if (others.length === 0 || others.some((thread) => thread.pinnedAt != null)) return null;
  return sentThreadId;
}

/**
 * One entry in the strip. Typed rather than rendered so every group — the
 * Mate's chats, its crew — brings its entries in one shape: a face in its tint
 * wearing its state, a name, and the thread a click opens.
 */
export interface ConversationStripEntry {
  readonly key: string;
  /** The thread a click opens; null for a chat being started, which has no thread yet. */
  readonly threadId: ThreadId | null;
  /** The name it goes by: the Mate's for its main chat, a chat's title, a crewmate's name. */
  readonly label: string;
  readonly face: { readonly tint: MateTintId; readonly state: MateMarkState };
  /** The resolver's word for what it is doing, for its accessible name; null at rest. */
  readonly status: string | null;
  /**
   * The crew's lead, where its name does not say so already: its role, said
   * on hover and in its accessible name — *Ada, the lead*, as the menu's
   * crew line says it. Its place, first in the crew, says it too.
   */
  readonly role?: string;
  readonly current: boolean;
  /**
   * `open` closes (archives) it; `busy` is a chat mid-turn, which archiving
   * refuses, its close held. `none` has no close at all: the main chat — it
   * is not closed from under the others, and *Make main* on another is the
   * way to close it — the chat being started, and every crewmate.
   */
  readonly close: "open" | "busy" | "none";
  /** Whether *Make main* applies: every chat but the main one. */
  readonly canMakeMain: boolean;
}

/** A labelled run of entries; a further group stands apart from the one before it. */
export interface ConversationStripGroup {
  readonly id: string;
  /** The group's accessible name. */
  readonly label: string;
  readonly entries: ReadonlyArray<ConversationStripEntry>;
}

/**
 * The chats group: every chat wears the Mate's face in its own state — in a
 * second chat, what the Mate does there — the main chat under the Mate's
 * name, every other chat under its title.
 */
export function chatEntries(input: {
  readonly chats: ReadonlyArray<EnvironmentThreadShell>;
  readonly currentThreadId: ThreadId | null;
  /** The person is on a chat not sent yet — a draft beside the Mate's chats. */
  readonly startingChat: boolean;
  readonly mate: { readonly name: string; readonly tint: MateTintId; readonly connected: boolean };
  readonly lastVisitedAtById: Readonly<Record<string, string>>;
}): ReadonlyArray<ConversationStripEntry> {
  const faceOf = (status: ThreadStatus | null) => ({
    tint: input.mate.tint,
    state: mateFaceFor(
      input.mate.connected,
      status === null ? undefined : { face: mateMarkStateForThreadStatus(status.kind) },
    ),
  });
  const chats = input.chats.map((chat, index): ConversationStripEntry => {
    const resolved = resolveChat(
      chat,
      input.lastVisitedAtById[scopedThreadKey(scopeThreadRef(chat.environmentId, chat.id))],
    );
    const common = {
      key: chat.id,
      threadId: chat.id,
      face: faceOf(resolved),
      status: statusLabel(resolved.kind),
      current: chat.id === input.currentThreadId,
    };
    if (index > 0) {
      const busy = chat.session?.status === "running" && chat.session.activeTurnId != null;
      return { ...common, label: chat.title, close: busy ? "busy" : "open", canMakeMain: true };
    }
    return { ...common, label: input.mate.name, close: "none", canMakeMain: false };
  });
  if (!input.startingChat) return chats;
  return [
    ...chats,
    {
      key: "starting",
      threadId: null,
      label: "New chat",
      face: faceOf(null),
      status: null,
      current: true,
      close: "none",
      canMakeMain: false,
    },
  ];
}

/** The lead's role, where its name does not carry the word already. */
function leadRole(name: string): string | undefined {
  return /\blead\b/iu.test(name) ? undefined : crewFaceWord(name, true);
}

/**
 * The crew group (PRD §4.2): one entry per crewmate, the lead first — its face
 * in its own tint wearing its current stint's state, and its name, as the
 * menu's crew line and its own header name it; the `@handle` is what the
 * composer types, not what the strip reads. A crewmate is one person across
 * its conversations, so its entry is the current one on any of its stints, a
 * retired one too, and a click opens the stint it talks in now. Crew entries
 * have no close.
 */
export function crewEntries(input: {
  readonly view: CrewView<EnvironmentThreadShell> | null;
  readonly currentThreadId: ThreadId | null;
  /** The Mate's container is connected; its crew sleeps with it otherwise. */
  readonly connected: boolean;
  readonly lastVisitedAtById: Readonly<Record<string, string>>;
}): ConversationStripGroup {
  const { view } = input;
  const onScreen =
    view === null || input.currentThreadId === null
      ? undefined
      : view.stints.get(input.currentThreadId)?.handle;
  const entries =
    view === null || view.status !== "applied"
      ? []
      : view.crewmates.map(({ crewmate, shell }): ConversationStripEntry => {
          const resolved =
            shell === null
              ? null
              : resolveChat(
                  shell,
                  input.lastVisitedAtById[
                    scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id))
                  ],
                );
          const role = crewmate.kind === "lead" ? leadRole(crewmate.displayName) : undefined;
          return {
            key: `crew:${crewmate.handle}`,
            threadId: crewmate.currentThreadId,
            label: crewmate.displayName,
            ...(role === undefined ? {} : { role }),
            face: {
              tint: crewmate.tint,
              state: mateFaceFor(
                input.connected,
                resolved === null
                  ? undefined
                  : { face: mateMarkStateForThreadStatus(resolved.kind) },
              ),
            },
            status: resolved === null ? null : statusLabel(resolved.kind),
            current: onScreen === crewmate.handle,
            close: "none",
            canMakeMain: false,
          };
        });
  return { id: "crew", label: "Crew", entries };
}

/**
 * An entry's name in ink or muted: in ink where it is the conversation on
 * screen, or where it has something for the person — a question or a turn
 * they have not seen, which its face says too. Everything else is muted:
 * working, idle and asleep are the face's alone.
 */
export function entryInk(entry: Pick<ConversationStripEntry, "current" | "face">): "ink" | "muted" {
  return entry.current || entry.face.state === "needs" || entry.face.state === "done"
    ? "ink"
    : "muted";
}

/** An entry's accessible name: its name, or the lead's role, then what it is doing. */
export function entryAccessibleName(
  entry: Pick<ConversationStripEntry, "label" | "role" | "status">,
): string {
  const name = entry.role ?? entry.label;
  return entry.status === null ? name : `${name}, ${entry.status}`;
}

/**
 * Whether the strip is drawn at all. A Mate with one chat and nothing
 * beside it looks exactly as it did before chats existed: the row appears
 * with a second chat, or with a group of its own to show.
 */
export function stripShown(
  chats: ReadonlyArray<ConversationStripEntry>,
  extraGroups: ReadonlyArray<ConversationStripGroup>,
): boolean {
  return chats.length > 1 || extraGroups.some((group) => group.entries.length > 0);
}

/**
 * Where the strip is not drawn, the one way to a second chat: a single New
 * chat button in the header, for a Mate whose one chat is on screen. Not for a
 * first chat still being written — that one is the Mate's only conversation.
 */
export function loneChatNewChatShown(
  chats: ReadonlyArray<ConversationStripEntry>,
  extraGroups: ReadonlyArray<ConversationStripGroup>,
): boolean {
  return !stripShown(chats, extraGroups) && chats.length === 1 && chats[0]!.threadId !== null;
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
}): string | null {
  if (!input.typing) return null;
  const index = input.chats.findIndex(
    (chat) => chat.id !== input.currentThreadId && resolveThreadStatus(chat).kind === "working",
  );
  if (index < 0) return null;
  const where = index === 0 ? "your main chat" : `‘${input.chats[index]!.title}’`;
  return `${input.mateName} is also working in ${where} — both change the same files.`;
}

/** The room the strip's row has, measured off the page. */
export interface StripRoom {
  /** The row's own width. */
  readonly width: number;
  /** Each entry's drawn width, by key. */
  readonly widths: ReadonlyMap<string, number>;
  /** Between two neighbours in the row. */
  readonly gap: number;
  /** Before each group after the first, on top of the gap. */
  readonly groupGap: number;
  /** What stands in the row whatever folds — New chat — with its gap. */
  readonly fixed: number;
  /** The More button, with its gap: room it takes once anything folds. */
  readonly more: number;
}

/**
 * Folds the strip's tail into *More* when the row cannot hold every entry at
 * its drawn width — *More* takes room of its own. The entry you are on never
 * folds: the one before it goes instead, so the strip always shows where you
 * are. At least one entry stays. Unmeasured (`null`), nothing folds.
 */
export function foldStrip(
  groups: ReadonlyArray<ConversationStripGroup>,
  room: StripRoom | null,
): {
  readonly visible: ReadonlyArray<ConversationStripGroup>;
  readonly folded: ReadonlyArray<ConversationStripEntry>;
} {
  const all = groups.flatMap((group) => group.entries);
  const used = (kept: ReadonlyArray<ConversationStripEntry>, more: boolean): number => {
    const drawn = groups.filter((group) => group.entries.some((entry) => kept.includes(entry)));
    return (
      kept.reduce((sum, entry) => sum + (room?.widths.get(entry.key) ?? 0), 0) +
      (room?.gap ?? 0) * Math.max(0, kept.length - 1) +
      (room?.groupGap ?? 0) * Math.max(0, drawn.length - 1) +
      (room?.fixed ?? 0) +
      (more ? (room?.more ?? 0) : 0)
    );
  };
  if (room === null || used(all, false) <= room.width) return { visible: groups, folded: [] };
  const current = all.find((entry) => entry.current);
  const keptOf = (count: number): ReadonlyArray<ConversationStripEntry> => {
    const head = all.slice(0, count);
    if (current === undefined || head.includes(current)) return head;
    return [...head.slice(0, count - 1), current];
  };
  let kept = keptOf(1);
  for (let count = all.length - 1; count > 1; count -= 1) {
    const candidate = keptOf(count);
    if (used(candidate, true) <= room.width) {
      kept = candidate;
      break;
    }
  }
  const shown = new Set(kept);
  return {
    visible: groups.map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => shown.has(entry)),
    })),
    folded: all.filter((entry) => !shown.has(entry)),
  };
}

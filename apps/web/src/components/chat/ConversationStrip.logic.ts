/**
 * The conversation strip: a Mate's chats, one row above its conversation.
 *
 * A Mate is one agent with several chats over one tree. The main chat is the
 * one `resolvePrimaryConversation` answers — the pinned one once there are
 * two — so the sidebar row, the index landing and every other caller keep
 * opening it. Everything here is read off the thread shells and the one
 * status resolver; nothing decides a status of its own (R5).
 */
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import { statusLabel, statusPulses } from "@t3tools/client-runtime/zerops/statusPresentation";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { ThreadId } from "@t3tools/contracts";
import type { MateMarkState, MateTintId, ServiceStatusToneId } from "@t3tools/shared/brand";
import {
  mateMarkStateForThreadStatus,
  resolveThreadStatus,
  type ThreadStatus,
  type ThreadStatusInput,
  type ThreadStatusToneId,
} from "@t3tools/shared/threadStatus";

import { mateFaceFor } from "~/zerops/agentActivity";

/** A strip entry's state: the resolver's word, in the `StatusDot` tone it wears. */
export interface ConversationStripStatus {
  readonly word: string;
  readonly tone: ServiceStatusToneId;
  readonly pulse: boolean;
}

/**
 * The dot's colour for a thread's tone. Everything that waits on the person —
 * an approval, a question, a plan — is one amber: the strip only has to say
 * "look here", the word says why.
 */
const DOT_TONE: Readonly<Record<ThreadStatusToneId, ServiceStatusToneId>> = {
  attention: "attention",
  input: "attention",
  plan: "attention",
  active: "busy",
  danger: "failed",
  success: "ok",
  neutral: "off",
};

function resolveChat(thread: ThreadStatusInput, lastVisitedAt: string | undefined): ThreadStatus {
  return resolveThreadStatus(lastVisitedAt === undefined ? thread : { ...thread, lastVisitedAt });
}

function stripStatus(status: ThreadStatus): ConversationStripStatus | null {
  const word = statusLabel(status.kind);
  if (word === null) return null;
  return { word, tone: DOT_TONE[status.toneId], pulse: statusPulses(status.kind) };
}

/**
 * What a chat is doing, through the one resolver and the one phrase producer.
 * Null for a chat with nothing going on: there is no word for it, and a dot
 * never stands without its word.
 */
export function chatStatus(
  thread: ThreadStatusInput,
  lastVisitedAt: string | undefined,
): ConversationStripStatus | null {
  return stripStatus(resolveChat(thread, lastVisitedAt));
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
 * The chat to pin when a new one is first sent, or null. *New session* in the
 * main chat archives it and its pin goes with it; the chat that takes its
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
 * One chip in the strip. Typed rather than rendered so a later group — the
 * crew — brings its entries in the same shape: a face in its tint, a label,
 * the resolver's word, and the thread a click opens.
 */
export interface ConversationStripEntry {
  readonly key: string;
  /** The thread a click opens; null for a chat being started, which has no thread yet. */
  readonly threadId: ThreadId | null;
  readonly label: string;
  readonly face?: { readonly tint: MateTintId; readonly state: MateMarkState };
  readonly status: ConversationStripStatus | null;
  readonly current: boolean;
  /**
   * `open` closes (archives) it. Held: `main` is the main chat while other
   * chats are open — it cannot be closed from under them — and `busy` is a
   * chat mid-turn, which archiving refuses. `none` has no close at all.
   */
  readonly close: "open" | "main" | "busy" | "none";
  /** Whether *Make main* applies: every chat but the main one. */
  readonly canMakeMain: boolean;
}

/** A labelled run of entries; the strip draws a divider between groups. */
export interface ConversationStripGroup {
  readonly id: string;
  /** The group's accessible name. */
  readonly label: string;
  readonly entries: ReadonlyArray<ConversationStripEntry>;
}

/**
 * The chats group: the main chat wears the Mate's face and name, every other
 * chat its own title.
 */
export function chatEntries(input: {
  readonly chats: ReadonlyArray<EnvironmentThreadShell>;
  readonly currentThreadId: ThreadId | null;
  /** The person is on a chat not sent yet — a draft beside the Mate's chats. */
  readonly startingChat: boolean;
  readonly mate: { readonly name: string; readonly tint: MateTintId; readonly connected: boolean };
  readonly lastVisitedAtById: Readonly<Record<string, string>>;
}): ReadonlyArray<ConversationStripEntry> {
  const alone = input.chats.length === 1 && !input.startingChat;
  const chats = input.chats.map((chat, index): ConversationStripEntry => {
    const resolved = resolveChat(
      chat,
      input.lastVisitedAtById[scopedThreadKey(scopeThreadRef(chat.environmentId, chat.id))],
    );
    const common = {
      key: chat.id,
      threadId: chat.id,
      status: stripStatus(resolved),
      current: chat.id === input.currentThreadId,
    };
    if (index > 0) {
      const busy = chat.session?.status === "running" && chat.session.activeTurnId != null;
      return { ...common, label: chat.title, close: busy ? "busy" : "open", canMakeMain: true };
    }
    return {
      ...common,
      label: input.mate.name,
      face: {
        tint: input.mate.tint,
        state: mateFaceFor(input.mate.connected, {
          face: mateMarkStateForThreadStatus(resolved.kind),
        }),
      },
      close: alone ? "none" : "main",
      canMakeMain: false,
    };
  });
  if (!input.startingChat) return chats;
  return [
    ...chats,
    {
      key: "starting",
      threadId: null,
      label: "New chat",
      status: null,
      current: true,
      close: "none",
      canMakeMain: false,
    },
  ];
}

/**
 * The crew group (PRD §4.2): one chip per crewmate, the lead first — its face
 * in its own tint wearing its current stint's state, its `@handle`, the
 * resolver's word. A crewmate is one person across its conversations, so its
 * chip is the current one on any of its stints, a retired one too, and a
 * click opens the stint it talks in now. Crew chips have no close.
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
          return {
            key: `crew:${crewmate.handle}`,
            threadId: crewmate.currentThreadId,
            label: `@${crewmate.handle}`,
            face: {
              tint: crewmate.tint,
              state: mateFaceFor(
                input.connected,
                resolved === null
                  ? undefined
                  : { face: mateMarkStateForThreadStatus(resolved.kind) },
              ),
            },
            status: resolved === null ? null : stripStatus(resolved),
            current: onScreen === crewmate.handle,
            close: "none",
            canMakeMain: false,
          };
        });
  return { id: "crew", label: "Crew", entries };
}

/**
 * Whether the chip row is drawn at all. A Mate with one chat and nothing
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
 * Where the row is not drawn, the one way to a second chat: a single New chat
 * button in the header row, for a Mate whose one chat is on screen. Not for a
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

/**
 * Folds the strip's tail into *More* when it holds more entries than there
 * are slots — the *More* chip takes a slot of its own. The entry you are on
 * never folds: the one before it goes instead, so the strip always shows
 * where you are.
 */
export function foldStrip(
  groups: ReadonlyArray<ConversationStripGroup>,
  slots: number,
): {
  readonly visible: ReadonlyArray<ConversationStripGroup>;
  readonly folded: ReadonlyArray<ConversationStripEntry>;
} {
  const all = groups.flatMap((group) => group.entries);
  if (all.length <= slots) return { visible: groups, folded: [] };
  const keep = Math.max(1, slots - 1);
  const kept = all.slice(0, keep);
  const current = all.find((entry) => entry.current);
  if (current !== undefined && !kept.includes(current)) {
    kept.splice(keep - 1, 1, current);
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

/**
 * Whether a task a person took from the Board for their Mate has its conversation: HQ says what they
 * took (the Mate's `taken`), the Mate's conversation rows say which tasks were taken into each
 * (`ConversationRow.takenTasks`). A taken task none of them carries is stranded — the Take's
 * conversation did not open, or its brief did not go — and offers **Open its conversation**, on
 * every surface and device, from what HQ and the Mate hold rather than from the tab that pressed.
 *
 * Pure: no network, no clock, no platform globals.
 *
 * @module takenConversation
 */

/** What a stranded task says, wherever it stands: on its Board row and in its Mate's conversation. */
export const STRANDED_TAKE_WORDS = "Its conversation didn't open.";
export const OPEN_TAKEN_LABEL = "Open its conversation";
export const OPENING_TAKEN_WORDS = "Opening its conversation…";

/** A Mate's conversations as this tab holds them, for what they carry. */
export interface TakenConversations {
  /** The list naming its conversations has answered whole here (`threadsListedAtom`). */
  readonly listed: boolean;
  /** Its server names each row's taken tasks (`conversationTakenTasks`); an older one names none. */
  readonly namesTaken: boolean;
  /** The tasks taken into its conversations. */
  readonly carried: ReadonlyArray<string>;
}

const NONE: ReadonlyArray<never> = [];

/**
 * The tasks of `taken` that none of the Mate's conversations carries; none while its conversations
 * are not read whole here, or come from a server that names no row's task — never a guess, since
 * Open its conversation opens a second one where a conversation already carries it.
 */
export function strandedTakes<T extends { readonly id: string }>(
  taken: ReadonlyArray<T> | undefined,
  conversations: TakenConversations | undefined,
): ReadonlyArray<T> {
  if (taken === undefined || taken.length === 0 || conversations === undefined) return NONE;
  if (!conversations.listed || !conversations.namesTaken) return NONE;
  const carried = new Set(conversations.carried);
  const stranded = taken.filter((task) => !carried.has(task.id));
  return stranded.length === 0 ? NONE : stranded;
}

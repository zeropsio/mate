/**
 * Whether a task a person took from the Board for their Mate is in one of its conversations: HQ
 * says what they took (the Mate's `taken`), the Mate's conversation rows say which tasks were taken
 * into each (`ConversationRow.takenTasks`). A taken task none of them carries is stranded — its
 * brief did not reach the Mate's main conversation — and offers **Send it again**, on every surface
 * and device, from what HQ and the Mate hold rather than from the tab that pressed.
 *
 * Pure: no network, no clock, no platform globals.
 *
 * @module takenConversation
 */

/** What a stranded task says, wherever it stands: on its Board row and in its Mate's conversation. */
export const STRANDED_TAKE_WORDS = "Its brief didn't reach your Mate.";
export const SEND_TAKEN_LABEL = "Send it again";
export const SENDING_TAKEN_WORDS = "Sending it to your Mate…";

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
 * Send it again sends the brief a second time where a conversation already carries it.
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

/** Where a Take sends its task's brief (`takeLandsIn`). */
export type TakeLanding =
  | { readonly kind: "main"; readonly conversationId: string }
  | { readonly kind: "new" };

/**
 * Where a Take sends its task's brief: into the Mate's main conversation `main`, where its server
 * takes a brief into a conversation under way and names each row's taken tasks
 * (`conversationTakenTasks`); a new conversation for the task where the server is older — it
 * refuses a brief into one under way — or where the Mate has no conversation yet.
 */
export function takeLandsIn(
  takesIntoMain: boolean,
  main: { readonly id: string } | undefined,
): TakeLanding {
  return takesIntoMain && main !== undefined
    ? { kind: "main", conversationId: main.id }
    : { kind: "new" };
}

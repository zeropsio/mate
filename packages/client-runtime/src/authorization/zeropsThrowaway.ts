/**
 * Throwaway Zerops tokens — how a person proves who they are to something
 * that is not the Zerops API.
 *
 * ## The problem
 *
 * A person's Zerops token reaches every org they belong to and never expires.
 * Today the app hands that token to each Mate's door, every fifteen minutes,
 * into a container its owner, its agent and the code that agent runs can all
 * change. The Mate's own token proves the Mate; nothing proves the caller
 * except the caller's whole identity.
 *
 * ## What replaces it
 *
 * At each connection the app mints an integration token with **no rights** —
 * `NO_ACCESS` at the org, no project grants, no flags — named for that one
 * receiver, hands over its value, and deletes it seconds later. The receiver
 * reads `createdByUser` and learns who is at its door; with its own token it
 * then checks that person's role. Nothing is re-sent afterwards, so a
 * container never holds a credential of the person's at all.
 *
 * Measured 2026-09-15 (ledger, *A member's throwaway token as their
 * identity*): a `NO_ACCESS` member with no grants mints one from a personal
 * token or a plain sign-in session with no sudo step; it names them; a
 * Mate-shaped key resolves their role from it; and **a captured one is worth
 * nothing** — it cannot mint, cannot raise itself, cannot delete itself and
 * cannot read a project. Only the person's own credential can take it back.
 * A round trip is about 0.65 s, and a deleted token answers `401` ~0.6 s later.
 *
 * ## Why the flags matter more than the grants
 *
 * A receiver refuses a token carrying **any** flag, and this never mints one.
 * A token minted through a delegation names the *delegating* person as its
 * creator, and the delegation every Mate carries is exactly `NO_ACCESS` +
 * *can create projects* — so a flagged token is not a throwaway whoever made
 * it, and an unflagged one cannot have come from a Mate.
 *
 * ## The value
 *
 * It exists as an argument and a local, and nowhere else: not in storage, not
 * in a returned value, not in a log line. {@link withThrowaway} is the only
 * way to use one, and it hands the value to one callback and deletes the token
 * in `finally` — admitted, refused, or the network gone. A door that did not
 * take it may have it held in this page's memory for its next try, while it is
 * young (`ZeropsThrowawayPlatform.hold`): a try that fails then costs no mint.
 *
 * @module authorization/zeropsThrowaway
 */
import { DOOR_PREFIX } from "@t3tools/shared/zeropsDoor";

/**
 * Names a throwaway after the Mate it is for, `mate-door:{projectId}:{nonce}`
 * (`DOOR_PREFIX`, the one the door checks). The receiver checks the name
 * against its own project, so a throwaway captured at one Mate's door is not
 * a pass to another.
 */
export function doorThrowawayName(projectId: string, nonce: string): string {
  return `${DOOR_PREFIX}:${projectId}:${nonce}`;
}

/** Whether a token on the account is one of our throwaways, left behind by a crash. */
export function isThrowawayName(name: string): boolean {
  return name.startsWith(`${DOOR_PREFIX}:`);
}

/**
 * The two platform calls a throwaway is. Injected rather than imported so this
 * module reaches no network of its own, and so a test can watch the order.
 */
export interface ZeropsThrowawayPlatform {
  /**
   * `POST /client/{org}/integration-token` — `NO_ACCESS`, no `projects`, no
   * flags, this name. The implementation is `ZeropsApiClient.mintThrowaway`,
   * an `account-write` that closed project writes never hold up.
   */
  readonly mint: (input: {
    readonly clientId: string;
    readonly name: string;
    /** The door it is for: the throwaway held for that door is handed back, while young. */
    readonly door?: string;
  }) => Promise<{ readonly id: string; readonly token: string }>;
  /**
   * `DELETE /client/{org}/integration-token/{tokenId}`, as the person who
   * minted it: with the access token the mint carried, on a deadline of its
   * own and never a caller's signal. The implementation is
   * `ZeropsApiClient.deleteThrowaway`.
   */
  readonly remove: (input: {
    readonly clientId: string;
    readonly tokenId: string;
  }) => Promise<void>;
  /**
   * Holds a throwaway its door did not take for the door's next try: the next mint for that
   * door hands it back while it is young, and it is removed once it is not. Absent: every
   * throwaway is removed after its try.
   */
  readonly hold?: (input: {
    readonly clientId: string;
    readonly door: string;
    readonly throwaway: { readonly id: string; readonly token: string };
  }) => void;
}

/** How one use of a throwaway went: what it answered, or what it threw. */
export type ThrowawayOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly cause: unknown };

export interface WithThrowawayInput<T> {
  readonly platform: ZeropsThrowawayPlatform;
  readonly clientId: string;
  /** {@link doorThrowawayName}. */
  readonly name: string;
  /** The one place the value is ever seen. Its result is what this returns. */
  readonly use: (token: string) => Promise<T>;
  /** The door it is for, where a throwaway it did not take is held for its next try. */
  readonly door?: string;
  /**
   * Whether the door did not take it with this outcome, so it is held for the door's next try
   * rather than removed. Absent: every outcome removes it.
   */
  readonly keep?: (outcome: ThrowawayOutcome<T>) => boolean;
  /**
   * Called when the token could not be taken back. The throwaway has no
   * rights and the start-up sweep is the backstop, so this never fails the
   * call — but a client that logs nothing here would never learn it is
   * leaking rows into the account's token list.
   */
  readonly onOrphaned?: (cause: unknown) => void;
}

/**
 * Mints a throwaway, hands its value to one callback, and deletes it whatever
 * happened.
 *
 * The deletion runs on every path — the receiver admitted the caller, refused
 * them, or never answered — because a throwaway that outlives its call is a
 * row in the account's token list that blocks removing its owner (Zerops
 * refuses to remove a member who still holds tokens, measured 2026-09-15).
 *
 * Nothing interrupts the deletion: the caller giving up, the account closing
 * or somebody else signing in to the tab mid-call all leave it running, and it
 * acts as the person who minted or not at all. Nobody waits for it: a door
 * exchange's answer is returned as soon as it is known, and the deletion runs
 * on to its own end. Its deadline and its one retry are not the exchange's to
 * sit through; the exchange has a deadline of its own (DESIGN §4.4).
 *
 * A deletion that itself fails is reported and swallowed: the caller's outcome
 * is the answer, and a token with no rights is not worth turning a successful
 * sign-in into a failure over.
 *
 * A door that did not take it (`keep`) has it held for its next try instead, where the platform
 * holds throwaways, and the next mint for that door hands it back while it is young.
 */
export async function withThrowaway<T>(input: WithThrowawayInput<T>): Promise<T> {
  const { door } = input;
  const minted = await input.platform.mint({
    clientId: input.clientId,
    name: input.name,
    ...(door === undefined ? {} : { door }),
  });
  let outcome: ThrowawayOutcome<T> = { ok: false, cause: undefined };
  try {
    const value = await input.use(minted.token);
    outcome = { ok: true, value };
    return value;
  } catch (cause) {
    outcome = { ok: false, cause };
    throw cause;
  } finally {
    const hold = input.platform.hold;
    if (door !== undefined && hold !== undefined && input.keep?.(outcome) === true) {
      hold({ clientId: input.clientId, door, throwaway: minted });
    } else {
      const orphaned = (cause: unknown) => input.onOrphaned?.(cause);
      void (async () => {
        await input.platform.remove({ clientId: input.clientId, tokenId: minted.id });
      })().catch(orphaned);
    }
  }
}

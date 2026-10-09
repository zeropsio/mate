/**
 * Opening a Mate without handing it anything of yours.
 *
 * The app used to send the person's own Zerops token to each container's door,
 * and again every fifteen minutes — a credential that reaches every org they
 * belong to and never expires, into a container its owner, its agent and the
 * code that agent runs can all change.
 *
 * Now it mints a throwaway instead: an integration token with no rights at
 * all, named `mate-door:{projectId}:{nonce}`, presented once, and deleted the
 * moment the door has answered — admitted, refused, or the network gone
 * (`authorization/zeropsThrowaway.ts`). The Mate reads who made it and looks
 * that person's role up with its own key, and from then on re-checks by itself
 * (server `ZeropsMembershipWatch`), so nothing is ever re-sent.
 *
 * ## The value is never kept
 *
 * It exists as an argument and a local. {@link connectThroughThrowaway} hands
 * it to one callback and to nothing else; no caller stores it, returns it, or
 * writes it anywhere. One a door did not take is held in this page's memory
 * for the door's next try, for {@link THROWAWAY_REUSE_MS} from its mint, and
 * deleted then: a door tried again mints nothing (KRLS, 2026-10-03: a stall of
 * the organization's reads left a throwaway per try).
 *
 * ## The sweep
 *
 * `withThrowaway` deletes in `finally`, but a delete can fail — and Zerops
 * refuses to remove a member who still holds tokens (measured 2026-09-15), so
 * the rows are not harmless. Cleanup is owed before every mint ({@link ThrowawayDebt}),
 * by the throwaway's own name, and the id its mint answered with is kept beside it; it is
 * settled only after its token is deleted or Zerops refused the mint. A delete
 * is attempted once; a failed delete keeps its exact target and failed/unknown reason
 * until the person asks to delete again. A crash stays owed, and only then does the app
 * list the organization's tokens and delete exactly the ones it owes — by id, or by name
 * where the mint's answer was lost ({@link planThrowawaySweep}); never another tab's or
 * device's by its look or its age. It waits five minutes past the newest owed mint, the
 * same window the door itself allows, so a throwaway another tab of this browser is
 * mid-flight with is never swept out from under it. Only when the person asks does it also
 * delete their own throwaways older than that window by the platform's `created`
 * ({@link planExpiredThrowaways}): no door admits one any more, whichever tab or device
 * minted it, and nothing else ever takes one back.
 *
 * @module doorThrowaway
 */

import {
  doorThrowawayName,
  isThrowawayName,
  withThrowaway,
  type ThrowawayOutcome,
  type ZeropsThrowawayPlatform,
} from "../authorization/zeropsThrowaway.ts";

export * from "./doorThrowawayState.ts";
import { THROWAWAY_SWEEP_AGE_MS, type OwedThrowaway } from "./doorThrowawayState.ts";

export { zeropsThrowawayPlatform } from "../data/adapters/doorThrowaway.ts";

export interface ConnectThroughThrowawayInput<T> {
  readonly platform: ZeropsThrowawayPlatform;
  /** The org that owns the Mate's project — where the token is minted. */
  readonly clientId: string;
  /** The Mate's project, which the door checks the name against. */
  readonly projectId: string;
  /** Tells this throwaway apart from another minted in the same second. */
  readonly nonce: string;
  /** The one place the value is ever seen. */
  readonly connect: (doorToken: string) => Promise<T>;
  /** Told when the token could not be taken back; never fails the connect. */
  readonly onOrphaned?: ((cause: unknown) => void) | undefined;
  /**
   * Whether the door did not take the throwaway with this outcome: it is then held for the
   * door's next try, while young, rather than deleted. Absent: it is deleted whatever happened.
   */
  readonly keep?: (outcome: ThrowawayOutcome<T>) => boolean;
}

/**
 * Hands one door a throwaway — the one held for it from a try it did not take, while young, else a
 * new one — and deletes it once the door took it, or holds it for the door's next try.
 */
export function connectThroughThrowaway<T>(input: ConnectThroughThrowawayInput<T>): Promise<T> {
  return withThrowaway({
    platform: input.platform,
    clientId: input.clientId,
    name: doorThrowawayName(input.projectId, input.nonce),
    door: input.projectId,
    ...(input.onOrphaned === undefined ? {} : { onOrphaned: input.onOrphaned }),
    ...(input.keep === undefined ? {} : { keep: input.keep }),
    use: input.connect,
  });
}

/** A token as the account's token list describes it — no value, ever. */
export interface AccountTokenRow {
  readonly id: string;
  readonly name?: string | undefined;
  /** When the platform minted it, by the platform's clock. */
  readonly created?: string | undefined;
  /** The user who minted it. */
  readonly createdByUser?: string | undefined;
}

/**
 * The person's own throwaways that no door admits any more, as the ids to delete: named as a
 * throwaway, minted by `userId`, and older than the door's window by the platform's `created`.
 * Whichever tab or device minted one, it can open nothing now; a row missing its creator or its
 * mint time is left.
 */
export function planExpiredThrowaways(input: {
  readonly tokens: ReadonlyArray<AccountTokenRow>;
  readonly userId: string;
  readonly nowEpochMs: number;
}): ReadonlyArray<string> {
  return input.tokens.flatMap((token) => {
    if (token.name === undefined || !isThrowawayName(token.name)) return [];
    if (token.createdByUser !== input.userId || token.created === undefined) return [];
    const createdMs = Date.parse(token.created);
    return Number.isFinite(createdMs) && input.nowEpochMs - createdMs > THROWAWAY_SWEEP_AGE_MS
      ? [token.id]
      : [];
  });
}

/**
 * The throwaways this browser owes, as the ids to delete: the one its mint answered with, by that
 * id — listed or not, a token that is gone is gone — or, its answer lost, the one the token list
 * names as minted under its name. A token merely named like a throwaway, or old, is somebody
 * else's — another tab's, another device's — and left.
 */
export function planThrowawaySweep(input: {
  readonly tokens: ReadonlyArray<AccountTokenRow>;
  readonly owed: ReadonlyArray<OwedThrowaway>;
}): ReadonlyArray<string> {
  const ids = input.owed.flatMap((owed) => (owed.tokenId === undefined ? [] : [owed.tokenId]));
  const names = new Set(
    input.owed.flatMap((owed) => (owed.tokenId === undefined ? [owed.attempt] : [])),
  );
  const named = input.tokens.flatMap((token) =>
    token.name !== undefined && isThrowawayName(token.name) && names.has(token.name)
      ? [token.id]
      : [],
  );
  return [...new Set([...ids, ...named])];
}

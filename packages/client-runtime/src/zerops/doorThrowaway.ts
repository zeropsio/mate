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
 * the rows are not harmless. A delete is tried again while Zerops cannot
 * answer, waiting longer each time; one that still fails, or a mint whose
 * answer was lost, is owed ({@link ThrowawayDebt}), and only then does the app
 * list the organization's tokens and delete the person's own `mate-door:*`
 * tokens older than five minutes, and the `gitea-signin:*` ones main's client
 * leaves. {@link planThrowawaySweep}
 * decides which; five minutes is the same window the door itself allows, so a
 * throwaway another tab is mid-flight with is never swept out from under it.
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
import { ZeropsApiError, type ZeropsApiClient } from "./api.ts";
import { diagnosticFailure, mateDiagnostics } from "./diagnostics.ts";

/** Nothing older than this is still anybody's live throwaway. */
export const THROWAWAY_SWEEP_AGE_MS = 5 * 60 * 1000;

/**
 * Where a throwaway this tab minted could not be deleted: the organization, and when its newest
 * such delete failed (wall ms). An organization's tokens are listed only to take those back
 * (`planThrowawaySweep`; step A, open question 10) — never on a load, never by the day.
 */
export interface ThrowawayDebt {
  readonly owe: (clientId: string, atMs: number) => void;
  /** When the newest delete this tab owes `clientId` failed; null while it owes none. */
  readonly failedAt: (clientId: string) => number | null;
  /** A sweep took back what failed up to `upToMs`: owed no longer, unless one failed since. */
  readonly settle: (clientId: string, upToMs: number) => void;
  /** Told on every change. */
  readonly subscribe: (listener: () => void) => () => void;
}

export function makeThrowawayDebt(): ThrowawayDebt {
  const owed = new Map<string, number>();
  const listeners = new Set<() => void>();
  const told = () => {
    for (const listener of listeners) listener();
  };
  return {
    owe: (clientId, atMs) => {
      owed.set(clientId, Math.max(atMs, owed.get(clientId) ?? atMs));
      told();
    },
    failedAt: (clientId) => owed.get(clientId) ?? null,
    settle: (clientId, upToMs) => {
      const failed = owed.get(clientId);
      if (failed === undefined || failed > upToMs) return;
      owed.delete(clientId);
      told();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** This tab's debt, shared by every platform built here, as its mint budgets are. */
export const throwawayDebt: ThrowawayDebt = makeThrowawayDebt();

/**
 * How long a throwaway delete that Zerops could not answer waits before each try again, in turn:
 * a stall of the organization's reads (KRLS, 2026-10-03: a minute of them timing out) is outlasted,
 * and only then is the delete owed to the sweep.
 */
export const THROWAWAY_DELETE_RETRIES_MS: ReadonlyArray<number> = [5_000, 15_000, 45_000];

/**
 * How long a throwaway its door did not take is held for the door's next try: well inside the
 * five minutes a door admits one for (`THROWAWAY_SWEEP_AGE_MS`), then it is deleted.
 */
export const THROWAWAY_REUSE_MS = 2 * 60 * 1000;

/**
 * Whether a failed delete is worth trying again: the platform was not
 * reached, did not answer in time, or answered 429/5xx. A 401 or 403 is the
 * minting session's own verdict and is left to the sweep.
 */
function isTransientDeleteFailure(cause: unknown): boolean {
  return (
    cause instanceof ZeropsApiError &&
    (cause.kind === "network" || cause.kind === "server" || cause.status === 429)
  );
}

/**
 * How fast mints start, as a bucket: a full one starts `burst` at once, and it refills at
 * `perMinute`, never past `burst`.
 */
export interface MintPaceConfig {
  readonly burst: number;
  readonly perMinute: number;
}

/** Door exchanges the background — the Mate left last, repair — may start at once. */
export const DOOR_MINT_BURST = 10;
/**
 * The background's door mints refill at one every two seconds. The platform drew no 429 at 80
 * mints a minute, each deleted at once (measured 2026-10-01), and the most this pace starts in a
 * minute, a full bucket and a minute's refill, is half that.
 */
export const DOOR_MINTS_PER_MINUTE = 30;
export const DOOR_MINT_PACE: MintPaceConfig = {
  burst: DOOR_MINT_BURST,
  perMinute: DOOR_MINTS_PER_MINUTE,
};
/** How long background mints stand still after the platform answers one with 429. */
export const DOOR_MINT_THROTTLE_MS = 30_000;

/**
 * The bucket behind a mint budget, on a monotonic clock in milliseconds. Only the background
 * waits on it: a mint the person asked for — the Mate the route names, the Connect they pressed —
 * is spent at once, past empty if it must, and the background waits that debt out (never more
 * than one bucket of it). A 429 holds the background for {@link DOOR_MINT_THROTTLE_MS}, or the
 * platform's `Retry-After` when that is longer, and it then refills from empty.
 */
export interface MintPace {
  /** When a background mint may start, with `owed` mints already promised; `now` once it may. */
  readonly readyAt: (now: number, owed?: number) => number;
  /** A mint started, asked for or not. */
  readonly spend: (now: number) => void;
  /** The platform answered a mint 429. */
  readonly throttled: (now: number, retryAfterMs?: number | null) => void;
}

export function makeMintPace(config: MintPaceConfig): MintPace {
  const perMs = config.perMinute / 60_000;
  /** The bucket's level at `from`; it refills only after `from`, which a hold moves ahead. */
  let tokens = config.burst;
  let from = Number.NEGATIVE_INFINITY;
  const level = (now: number) =>
    now <= from ? tokens : Math.min(config.burst, tokens + (now - from) * perMs);
  return {
    readyAt: (now, owed = 0) => {
      const need = 1 + owed;
      const start = Math.max(now, from);
      const short = need - level(start);
      return short <= 0 ? start : start + short / perMs;
    },
    spend: (now) => {
      const left = level(now) - 1;
      if (now > from) from = now;
      tokens = Math.max(left, -config.burst);
    },
    throttled: (now, retryAfterMs = null) => {
      const left = Math.min(level(now), 0);
      from = Math.max(from, now + Math.max(DOOR_MINT_THROTTLE_MS, retryAfterMs ?? 0));
      tokens = left;
    },
  };
}

/**
 * Hands out mints at the pace of {@link MintPace}: past it, a background mint waits for its turn.
 * The pace belongs to the account epoch it was spent in (`ZeropsApiClient.accountEpoch`): the
 * next account in the tab starts with a full bucket, and a mint still waiting from an epoch that
 * has ended is refused rather than started.
 */
export interface MintBudget {
  readonly take: (
    epoch: number,
    options?: { readonly signal?: AbortSignal | undefined; readonly asked?: boolean },
  ) => Promise<void>;
  /** The platform answered a mint 429, asking for `retryAfterMs` when it said. */
  readonly throttled: (retryAfterMs: number | null) => void;
}

function makeMintBudget(config: MintPaceConfig, now: () => number): MintBudget {
  let pace = makeMintPace(config);
  let pacedIn = Number.NEGATIVE_INFINITY;
  const take: MintBudget["take"] = async (epoch, { signal, asked = false } = {}) => {
    for (;;) {
      signal?.throwIfAborted();
      if (epoch < pacedIn) {
        throw new ZeropsApiError("This account session has ended.", "expired-session", 401);
      }
      if (epoch > pacedIn) {
        pace = makeMintPace(config);
        pacedIn = epoch;
      }
      const at = now();
      const readyAt = pace.readyAt(at);
      if (asked || readyAt <= at) {
        pace.spend(at);
        return;
      }
      await slotFree(readyAt - at, signal);
    }
  };
  return { take, throttled: (retryAfterMs) => pace.throttled(now(), retryAfterMs) };
}

function slotFree(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    // @effect-diagnostics-next-line globalTimers:off -- plain promises: a budget wait, no Effect runtime here.
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * The doors' mint budget (DESIGN I12). Per tab: there is no leader to share one across tabs
 * (D10).
 */
export interface ThrowawayMintBudgets {
  readonly door: MintBudget;
}

export function makeThrowawayMintBudgets(
  now: () => number = () => performance.now(),
): ThrowawayMintBudgets {
  return { door: makeMintBudget(DOOR_MINT_PACE, now) };
}

/** This tab's budgets, shared by every platform built here. */
const tabMintBudgets = makeThrowawayMintBudgets();

/**
 * What each throwaway minted in this tab is deleted with — its name, and the access token its mint
 * carried — and when it was minted (wall ms). Held from the mint to the delete, and no longer, by
 * whichever platform deletes it: a door's next try may come through another.
 */
const mintedHere = new Map<
  string,
  { readonly name: string; readonly mintingToken: string; readonly mintedAtMs: number }
>();

/**
 * The throwaway each door did not take, held for its next try while young: by account epoch,
 * organization and door. Its value lives here and nowhere else, until it is taken or deleted.
 */
const heldForDoor = new Map<
  string,
  { readonly id: string; readonly token: string; readonly expire: () => void }
>();

/**
 * The two platform calls a throwaway is, backed by the signed-in account's own
 * API client.
 *
 * `mintThrowaway` mints `NO_ACCESS` with no projects and refuses to set a
 * flag of any kind, which is what makes what it mints a throwaway rather than
 * something a door has to argue with, and why a closed account window does
 * not hold it up. A mint first takes a slot from this tab's door budget — at
 * once when `asked`, the person having asked for this Mate — and a
 * 429 holds that budget's background mints; `signal` ends the wait and the mint — never the delete,
 * which runs on its own deadline with the token the mint carried and is tried
 * again on {@link THROWAWAY_DELETE_RETRIES_MS} while Zerops cannot answer. A
 * delete that still fails, or a mint whose answer was lost — a throwaway may
 * stand that nobody holds — owes the organization a sweep.
 *
 * A throwaway its door did not take is held for the door's next try for
 * {@link THROWAWAY_REUSE_MS} from its mint (`hold`), and the next mint for that
 * door hands it back: a door tried again mints nothing.
 */
export function zeropsThrowawayPlatform(
  client: ZeropsApiClient,
  options: {
    readonly signal?: AbortSignal | undefined;
    readonly asked?: boolean;
    readonly budgets?: ThrowawayMintBudgets;
    readonly debt?: ThrowawayDebt;
  } = {},
): ZeropsThrowawayPlatform {
  const { signal, asked = false, budgets = tabMintBudgets, debt = throwawayDebt } = options;
  const doorKey = (clientId: string, door: string) =>
    `${String(client.accountEpoch)}\u0000${clientId}\u0000${door}`;
  // @effect-diagnostics-next-line globalDate:off -- plain promises: a throwaway's age, on the wall clock its `created` is on.
  const nowMs = () => Date.now();

  const remove: ZeropsThrowawayPlatform["remove"] = async (input) => {
    const diagnostic = {
      kind: "throwaway",
      action: "delete",
      clientId: input.clientId,
      tokenId: input.tokenId,
    } as const;
    const throwaway = mintedHere.get(input.tokenId);
    mintedHere.delete(input.tokenId);
    const attempt = async () => {
      try {
        if (throwaway === undefined) {
          throw new ZeropsApiError(
            "This throwaway was not minted here, so there is no token to delete it with.",
            "invalid-input",
          );
        }
        await client.deleteThrowaway(
          { clientId: input.clientId, tokenId: input.tokenId, name: throwaway.name },
          { token: throwaway.mintingToken },
        );
        mateDiagnostics.record({ ...diagnostic, outcome: "ok" });
      } catch (cause) {
        mateDiagnostics.record({ ...diagnostic, outcome: "failed", ...diagnosticFailure(cause) });
        throw cause;
      }
    };
    try {
      for (let tried = 0; ; tried += 1) {
        try {
          await attempt();
          return;
        } catch (cause) {
          const wait = THROWAWAY_DELETE_RETRIES_MS[tried];
          if (wait === undefined || !isTransientDeleteFailure(cause)) throw cause;
          // @effect-diagnostics-next-line globalTimers:off -- plain promises: the retry's own pause.
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      }
    } catch (cause) {
      // Left on the account: this tab owes its organization a sweep.
      debt.owe(input.clientId, nowMs());
      throw cause;
    }
  };

  /** Deletes a throwaway nobody waits on: a delete that fails is owed, and told nowhere else. */
  const release = (clientId: string, tokenId: string) =>
    void remove({ clientId, tokenId }).catch(() => undefined);

  return {
    mint: async (input) => {
      if (input.door !== undefined) {
        const key = doorKey(input.clientId, input.door);
        const held = heldForDoor.get(key);
        if (held !== undefined) {
          heldForDoor.delete(key);
          held.expire();
          return { id: held.id, token: held.token };
        }
      }
      const diagnostic = { kind: "throwaway", action: "mint", clientId: input.clientId } as const;
      return client
        .mintThrowaway(
          { clientId: input.clientId, name: input.name },
          {
            ...(signal === undefined ? {} : { signal }),
            beforeMint: () => budgets.door.take(client.accountEpoch, { signal, asked }),
          },
        )
        .then(
          (throwaway) => {
            mintedHere.set(throwaway.id, {
              name: input.name,
              mintingToken: throwaway.mintingToken,
              mintedAtMs: nowMs(),
            });
            mateDiagnostics.record({ ...diagnostic, outcome: "ok", tokenId: throwaway.id });
            return { id: throwaway.id, token: throwaway.token };
          },
          (cause: unknown) => {
            if (cause instanceof ZeropsApiError && cause.status === 429) {
              budgets.door.throttled(cause.retryAfterMs);
            }
            // Its answer lost, a throwaway may stand that nobody here can delete: the sweep can.
            if (cause instanceof ZeropsApiError && cause.kind === "uncertain") {
              debt.owe(input.clientId, nowMs());
            }
            mateDiagnostics.record({
              ...diagnostic,
              outcome: "failed",
              ...diagnosticFailure(cause),
            });
            throw cause;
          },
        );
    },
    remove,
    hold: ({ clientId, door, throwaway }) => {
      const minted = mintedHere.get(throwaway.id);
      const leftMs = minted === undefined ? 0 : minted.mintedAtMs + THROWAWAY_REUSE_MS - nowMs();
      if (leftMs <= 0) {
        release(clientId, throwaway.id);
        return;
      }
      const key = doorKey(clientId, door);
      const before = heldForDoor.get(key);
      if (before !== undefined && before.id !== throwaway.id) {
        before.expire();
        release(clientId, before.id);
      }
      // @effect-diagnostics-next-line globalTimers:off -- plain promises: a held throwaway's end.
      const timer = setTimeout(() => {
        if (heldForDoor.get(key)?.id !== throwaway.id) return;
        heldForDoor.delete(key);
        release(clientId, throwaway.id);
      }, leftMs);
      heldForDoor.set(key, {
        id: throwaway.id,
        token: throwaway.token,
        expire: () => clearTimeout(timer),
      });
    },
  };
}

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
  readonly created?: string | undefined;
}

/**
 * Which of the account's tokens are throwaways left behind by a crash.
 *
 * A row whose `created` does not parse is left alone: a token nobody can date
 * is a token nobody can call stale, and deleting one on a guess would take out
 * a live sign-in.
 */
export function planThrowawaySweep(input: {
  readonly tokens: ReadonlyArray<AccountTokenRow>;
  readonly nowEpochMs: number;
  readonly maxAgeMs?: number;
}): ReadonlyArray<string> {
  const maxAgeMs = input.maxAgeMs ?? THROWAWAY_SWEEP_AGE_MS;
  const stale: Array<string> = [];
  for (const token of input.tokens) {
    if (token.name === undefined || !isThrowawayName(token.name)) continue;
    if (token.created === undefined) continue;
    const createdMs = Date.parse(token.created);
    if (!Number.isFinite(createdMs)) continue;
    if (input.nowEpochMs - createdMs > maxAgeMs) stale.push(token.id);
  }
  return stale;
}

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
 * writes it anywhere.
 *
 * ## The sweep
 *
 * `withThrowaway` deletes in `finally`, but a tab closed mid-flight, a crashed
 * renderer or a killed process leaves a row behind — and Zerops refuses to
 * remove a member who still holds tokens (measured 2026-09-15), so the rows
 * are not harmless. At start-up the app therefore deletes the person's own
 * `mate-door:*` and `gitea-signin:*` tokens older than five minutes.
 * {@link planThrowawaySweep} decides which; five minutes is the same window
 * the door itself allows, so a throwaway another tab is mid-flight with is
 * never swept out from under it.
 *
 * @module doorThrowaway
 */

import {
  GITEA_THROWAWAY_PREFIX,
  doorThrowawayName,
  isThrowawayName,
  withThrowaway,
  type ZeropsThrowawayPlatform,
} from "../authorization/zeropsThrowaway.ts";
import { ZeropsApiError, type ZeropsApiClient } from "./api.ts";
import { diagnosticFailure, mateDiagnostics } from "./diagnostics.ts";

/** Nothing older than this is still anybody's live throwaway. */
export const THROWAWAY_SWEEP_AGE_MS = 5 * 60 * 1000;

/** How long a throwaway delete that Zerops could not answer waits before its one retry. */
export const THROWAWAY_DELETE_RETRY_MS = 5_000;

/**
 * Whether a failed delete is worth its one retry: the platform was not
 * reached, did not answer in time, or answered 429/5xx. A 401 or 403 is the
 * minting session's own verdict and is left to the sweep.
 */
function isTransientDeleteFailure(cause: unknown): boolean {
  return (
    cause instanceof ZeropsApiError &&
    (cause.kind === "network" || cause.kind === "server" || cause.status === 429)
  );
}

/** Door exchanges this tab may mint for in any minute (DESIGN §4.4). */
export const DOOR_MINTS_PER_MINUTE = 10;
/** Gitea sign-ins this tab may mint for in any minute, apart from the doors'. */
export const GITEA_MINTS_PER_MINUTE = 4;
const MINT_BUDGET_WINDOW_MS = 60_000;

/**
 * Hands out mints at a bounded rate: past the budget, a mint waits for a slot.
 * Slots belong to the account epoch they were taken in
 * (`ZeropsApiClient.accountEpoch`): the next account in the tab starts with a
 * budget of its own, and a mint still waiting from an epoch that has ended is
 * refused rather than given one of its slots.
 */
export interface MintBudget {
  readonly take: (epoch: number, signal?: AbortSignal) => Promise<void>;
}

function makeMintBudget(perMinute: number, now: () => number): MintBudget {
  const taken: Array<number> = [];
  let takenIn = Number.NEGATIVE_INFINITY;
  const take = async (epoch: number, signal?: AbortSignal): Promise<void> => {
    for (;;) {
      signal?.throwIfAborted();
      if (epoch < takenIn) {
        throw new ZeropsApiError("This account session has ended.", "expired-session", 401);
      }
      if (epoch > takenIn) {
        taken.length = 0;
        takenIn = epoch;
      }
      const at = now();
      while (taken.length > 0 && at - taken[0]! >= MINT_BUDGET_WINDOW_MS) taken.shift();
      if (taken.length < perMinute) {
        taken.push(at);
        return;
      }
      await slotFree(taken[0]! + MINT_BUDGET_WINDOW_MS - at, signal);
    }
  };
  return { take };
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
 * One budget per kind of throwaway, so a Gitea that keeps asking never takes
 * a door exchange's slot (DESIGN I12). Per tab: there is no leader to share
 * one across tabs (D10).
 */
export interface ThrowawayMintBudgets {
  readonly door: MintBudget;
  readonly gitea: MintBudget;
}

export function makeThrowawayMintBudgets(
  now: () => number = () => performance.now(),
): ThrowawayMintBudgets {
  return {
    door: makeMintBudget(DOOR_MINTS_PER_MINUTE, now),
    gitea: makeMintBudget(GITEA_MINTS_PER_MINUTE, now),
  };
}

/** This tab's budgets, shared by every platform built here. */
const tabMintBudgets = makeThrowawayMintBudgets();

/**
 * The two platform calls a throwaway is, backed by the signed-in account's own
 * API client.
 *
 * `mintThrowaway` mints `NO_ACCESS` with no projects and refuses to set a
 * flag of any kind, which is what makes what it mints a throwaway rather than
 * something a door has to argue with. A mint first takes a slot from this
 * tab's budget for its kind, and waits for a closed account window rather
 * than refusing; `signal` ends both waits and the mint — never the delete,
 * which runs on its own deadline with the token the mint carried and is tried
 * once more after {@link THROWAWAY_DELETE_RETRY_MS} when Zerops could not
 * answer.
 */
export function zeropsThrowawayPlatform(
  client: ZeropsApiClient,
  signal?: AbortSignal,
  budgets: ThrowawayMintBudgets = tabMintBudgets,
): ZeropsThrowawayPlatform {
  /**
   * What each throwaway minted here is deleted with: its name, and the access
   * token its mint carried. Held from the mint to the delete, and no longer.
   */
  const minted = new Map<string, { readonly name: string; readonly mintingToken: string }>();
  return {
    mint: async (input) => {
      const purpose = input.name.startsWith(`${GITEA_THROWAWAY_PREFIX}:`) ? "gitea" : "door";
      const diagnostic = {
        kind: "throwaway",
        action: "mint",
        purpose,
        clientId: input.clientId,
      } as const;
      return client
        .mintThrowaway(
          { clientId: input.clientId, name: input.name },
          {
            ...(signal === undefined ? {} : { signal }),
            beforeMint: () => budgets[purpose].take(client.accountEpoch, signal),
          },
        )
        .then(
          (throwaway) => {
            minted.set(throwaway.id, { name: input.name, mintingToken: throwaway.mintingToken });
            mateDiagnostics.record({ ...diagnostic, outcome: "ok", tokenId: throwaway.id });
            return { id: throwaway.id, token: throwaway.token };
          },
          (cause: unknown) => {
            mateDiagnostics.record({
              ...diagnostic,
              outcome: "failed",
              ...diagnosticFailure(cause),
            });
            throw cause;
          },
        );
    },
    remove: async (input) => {
      const diagnostic = {
        kind: "throwaway",
        action: "delete",
        clientId: input.clientId,
        tokenId: input.tokenId,
      } as const;
      const throwaway = minted.get(input.tokenId);
      minted.delete(input.tokenId);
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
        await attempt();
      } catch (cause) {
        if (!isTransientDeleteFailure(cause)) throw cause;
        // @effect-diagnostics-next-line globalTimers:off -- plain promises: the retry's own pause.
        await new Promise((resolve) => setTimeout(resolve, THROWAWAY_DELETE_RETRY_MS));
        await attempt();
      }
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
}

/**
 * Mints a throwaway for one Mate, hands its value to the connect, and deletes
 * it whatever happened.
 */
export function connectThroughThrowaway<T>(input: ConnectThroughThrowawayInput<T>): Promise<T> {
  return withThrowaway({
    platform: input.platform,
    clientId: input.clientId,
    name: doorThrowawayName(input.projectId, input.nonce),
    ...(input.onOrphaned === undefined ? {} : { onOrphaned: input.onOrphaned }),
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

/** Throwaway mint/delete boundary; cleanup debt and locks remain supplied by the captured account. */
import type { ZeropsThrowawayPlatform } from "../../authorization/zeropsThrowaway.ts";
import { ZeropsApiError, type ZeropsApiClient } from "../../zerops/api.ts";
import { diagnosticFailure, mateDiagnostics } from "../../zerops/diagnostics.ts";
import {
  makeThrowawayMintBudgets,
  throwawayDebt,
  throwawayCleanupFailureState,
  THROWAWAY_REUSE_MS,
  type ThrowawayDebt,
  type ThrowawayMintBudgets,
} from "../../zerops/doorThrowawayState.ts";

/** This tab's budgets, shared by every platform built here. */
let tabMintBudgets: ThrowawayMintBudgets | undefined;

/**
 * What each throwaway minted in this tab is deleted with — its name, and the access token its mint
 * carried — and when it was minted (wall ms). Held from the mint to the delete, and no longer, by
 * whichever platform deletes it: a door's next try may come through another.
 */
const mintedHere = new Map<
  string,
  {
    readonly name: string;
    readonly mintingToken: string;
    readonly mintedAtMs: number;
    readonly debt: ThrowawayDebt;
  }
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
 * which runs once on its own deadline with the token the mint carried. A failed
 * delete stays visible in the captured account's debt until Delete again. A mint whose
 * answer was lost stays owed to the organization's sweep.
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
  const {
    signal,
    asked = false,
    budgets = (tabMintBudgets ??= makeThrowawayMintBudgets()),
    debt = throwawayDebt,
  } = options;
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
      throwaway.debt.finish(input.clientId, throwaway.name);
    } catch (cause) {
      mateDiagnostics.record({ ...diagnostic, outcome: "failed", ...diagnosticFailure(cause) });
      (throwaway?.debt ?? debt).failCleanup(input.clientId, nowMs(), {
        attempt: throwaway?.name ?? input.tokenId,
        tokenId: input.tokenId,
        state: throwawayCleanupFailureState(cause),
        reason: cause instanceof Error ? cause.message : "Zerops did not confirm cleanup.",
      });
      throw cause;
    }
  };

  /** Deletes once; the captured account owns the visible failure if the answer is lost or refused. */
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
      // Persist before the possible write: a crash or lost answer still leaves an owned sweep.
      debt.owe(input.clientId, nowMs(), input.name);
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
              debt,
            });
            debt.minted(input.clientId, input.name, throwaway.id);
            mateDiagnostics.record({ ...diagnostic, outcome: "ok", tokenId: throwaway.id });
            return { id: throwaway.id, token: throwaway.token };
          },
          (cause: unknown) => {
            if (cause instanceof ZeropsApiError && cause.status === 429) {
              budgets.door.throttled(cause.retryAfterMs);
            }
            // Its answer lost, a throwaway may stand that nobody here can delete: the sweep can.
            if (cause instanceof ZeropsApiError && cause.kind === "uncertain") {
              debt.owe(input.clientId, nowMs(), input.name);
            } else if (cause instanceof ZeropsApiError) {
              debt.finish(input.clientId, input.name);
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

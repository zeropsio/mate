/**
 * Takes back the throwaways this tab failed to delete.
 *
 * Every throwaway is deleted in a `finally` (`doorThrowaway.ts`), and one whose delete failed is
 * owed (`throwawayDebt`): Zerops refuses to remove a member who still holds tokens (measured
 * 2026-09-15), so the rows are not harmless — enough of them and a leaver cannot be taken off the
 * org. What a closed tab or a killed renderer leaves stays: it carries no rights, and listing the
 * organization's tokens to find it cost every load a read KRLS took 17 s to answer (step A, open
 * question 10).
 *
 * So the organization's tokens are listed only where this tab owes it a sweep, once the newest
 * failed throwaway is past the door's own window (`THROWAWAY_SWEEP_AGE_MS`): younger, it is any
 * tab's live throwaway, and `planThrowawaySweep` would leave it. Its own `mate-door:*` tokens and
 * the `gitea-signin:*` ones main's client leaves are deleted; nothing else on the list is ours to
 * touch. Failures are swallowed — a token the account may not delete, or a network that dropped,
 * must not put an error on a screen that is otherwise fine; the debt stays for the next mount.
 */

import {
  planThrowawaySweep,
  throwawayDebt,
  THROWAWAY_SWEEP_AGE_MS,
} from "@t3tools/client-runtime/zerops/doorThrowaway";
import { useEffect, useSyncExternalStore } from "react";

import { readZeropsCell } from "./readZeropsCell";
import { useZeropsData } from "./zeropsDataContext";

import { useZeropsSession } from "./ZeropsSessionProvider";

/** How far past the door's window a sweep waits, so the newest failed throwaway is stale to it. */
const PAST_THE_WINDOW_MS = 1_000;

export function useZeropsThrowawaySweep(input: {
  readonly clientId: string | undefined;
  readonly enabled: boolean;
}): void {
  const { client } = useZeropsSession();
  const { organizationRef, runtime } = useZeropsData();
  const { clientId, enabled } = input;
  const owed = () => (clientId === undefined ? null : throwawayDebt.failedAt(clientId));
  const failedAt = useSyncExternalStore(throwawayDebt.subscribe, owed, owed);

  useEffect(() => {
    if (!enabled || clientId === undefined || failedAt === null) return;
    const controller = new AbortController();
    const sweep = async () => {
      try {
        // The account's one token list, shared with every reader of it (the account's cells).
        const request = {
          kind: "tokens",
          account: runtime.scope,
          organization: organizationRef(clientId),
        } as const;
        const tokens = await readZeropsCell(runtime.cells, request, controller.signal);
        const stale = planThrowawaySweep({
          tokens: tokens.map((token) => ({
            id: token.tokenId,
            name: token.name,
            ...(token.created === undefined ? {} : { created: token.created }),
          })),
          nowEpochMs: Date.now(),
        });
        // Each delete makes the shared list read again (the client tells the store of it).
        for (const tokenId of stale) {
          if (controller.signal.aborted) return;
          await client.deleteIntegrationToken({ clientId, tokenId }, controller.signal);
        }
        throwawayDebt.settle(clientId, failedAt);
      } catch {
        // Housekeeping: still owed, for the next mount.
      }
    };
    const timer = setTimeout(
      () => void sweep(),
      Math.max(0, failedAt + THROWAWAY_SWEEP_AGE_MS + PAST_THE_WINDOW_MS - Date.now()),
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, clientId, enabled, failedAt, organizationRef, runtime]);
}

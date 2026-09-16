/**
 * Takes back the throwaways a crash left behind.
 *
 * Every throwaway is deleted in a `finally` (`doorThrowaway.ts`), but a tab
 * closed mid-connect, a killed renderer or a lost network leaves the row on
 * the account — and Zerops refuses to remove a member who still holds tokens
 * (measured 2026-09-15), so the rows are not harmless: enough of them and a
 * leaver cannot be taken off the org.
 *
 * So the app sweeps at start-up, once per account per session, over the
 * person's own `mate-door:*` and `gitea-signin:*` tokens older than five
 * minutes. Anything younger is left alone: five minutes is the window the door
 * itself allows, so another tab's live connect is never swept out from under
 * it, and nothing else on the token list is ours to touch.
 *
 * It runs beside `useZeropsGroupReach` for the same reason that one does: the
 * projects screen is where an account is read, and a repair nobody asked for
 * belongs where it costs nothing. Failures are swallowed — a token the account
 * may not delete, or a network that dropped, must not put an error on a screen
 * that is otherwise fine.
 */

import { planThrowawaySweep } from "@t3tools/client-runtime/zerops/doorThrowaway";
import { useEffect, useRef } from "react";

import { useZeropsSession } from "./ZeropsSessionProvider";

export function useZeropsThrowawaySweep(input: {
  readonly clientId: string | undefined;
  readonly enabled: boolean;
}): void {
  const { client } = useZeropsSession();
  const swept = useRef<string | null>(null);
  const { clientId, enabled } = input;

  useEffect(() => {
    if (!enabled || clientId === undefined) return;
    if (swept.current === clientId) return;
    swept.current = clientId;

    const controller = new AbortController();
    void (async () => {
      try {
        const tokens = await client.listIntegrationTokens(clientId, controller.signal);
        const stale = planThrowawaySweep({ tokens, nowEpochMs: Date.now() });
        for (const tokenId of stale) {
          if (controller.signal.aborted) return;
          await client.deleteIntegrationToken({ clientId, tokenId }, controller.signal);
        }
      } catch {
        // Housekeeping: the next sign-in tries again.
        swept.current = null;
      }
    })();

    return () => {
      controller.abort();
    };
  }, [client, clientId, enabled]);
}

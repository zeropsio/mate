/**
 * Takes back the throwaways a crash left behind.
 *
 * Every throwaway is deleted in a `finally` (`doorThrowaway.ts`), but a tab
 * closed mid-connect, a killed renderer or a lost network leaves the row on
 * the account — and Zerops refuses to remove a member who still holds tokens
 * (measured 2026-09-15), so the rows are not harmless: enough of them and a
 * leaver cannot be taken off the org.
 *
 * So the app sweeps at start-up, once a day per account on a browser
 * (`throwawaySweepDue`), over the person's own `mate-door:*` and
 * `gitea-signin:*` tokens older than five minutes. Anything younger is left alone: five minutes is the window the door
 * itself allows, so another tab's live connect is never swept out from under
 * it, and nothing else on the token list is ours to touch.
 *
 * It runs beside `useZeropsGroupReach` for the same reason that one does: the
 * projects screen is where an account is read, and a repair nobody asked for
 * belongs where it costs nothing. Failures are swallowed — a token the account
 * may not delete, or a network that dropped, must not put an error on a screen
 * that is otherwise fine.
 */

import {
  planThrowawaySweep,
  throwawaySweepDue,
} from "@t3tools/client-runtime/zerops/doorThrowaway";
import { useEffect, useRef } from "react";

import { useZeropsSession } from "./ZeropsSessionProvider";

/** When this browser last swept each account, by organization id. */
const SWEPT_STORAGE_KEY = "zerops-mate.throwaway-swept.v1";

const readSwept = (): Record<string, number> => {
  try {
    const held: unknown = JSON.parse(localStorage.getItem(SWEPT_STORAGE_KEY) ?? "{}");
    return typeof held === "object" && held !== null ? (held as Record<string, number>) : {};
  } catch {
    return {};
  }
};

const rememberSwept = (clientId: string, atMs: number): void => {
  try {
    localStorage.setItem(SWEPT_STORAGE_KEY, JSON.stringify({ ...readSwept(), [clientId]: atMs }));
  } catch {
    // Storage blocked: the next open sweeps again, as before.
  }
};

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
    const lastSwept = readSwept()[clientId];
    if (!throwawaySweepDue(typeof lastSwept === "number" ? lastSwept : null, Date.now())) return;

    const controller = new AbortController();
    void (async () => {
      try {
        const tokens = await client.listIntegrationTokens(clientId, controller.signal);
        const stale = planThrowawaySweep({ tokens, nowEpochMs: Date.now() });
        for (const tokenId of stale) {
          if (controller.signal.aborted) return;
          await client.deleteIntegrationToken({ clientId, tokenId }, controller.signal);
        }
        rememberSwept(clientId, Date.now());
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

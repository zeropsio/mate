/**
 * One inventory-owned cleanup attempt for the account's persisted door debt. Outstanding mints
 * wait past the door window; failed cleanup stays visible until an explicit again. An explicit
 * cleanup also discovers legacy leftovers, without an unconditional token-list read on loads.
 */
import {
  planThrowawaySweep,
  THROWAWAY_SWEEP_AGE_MS,
} from "@t3tools/client-runtime/zerops/doorThrowaway";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { readZeropsCell } from "./readZeropsCell";
import { accountThrowawayDebt } from "./throwawayDebt";
import { useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** Past the door's window, so the newest recorded mint is eligible for the sweep. */
const PAST_THE_WINDOW_MS = 1_000;

type CleanupState = {
  readonly state: "idle" | "waiting" | "running" | "done" | "failed";
  readonly failure: string | null;
};
export interface ThrowawaySweepView extends CleanupState {
  readonly again: () => void;
}

const IDLE: CleanupState = { state: "idle", failure: null };

export function useZeropsThrowawaySweep(input: {
  readonly clientId: string | undefined;
  readonly enabled: boolean;
}): ThrowawaySweepView {
  const { client } = useZeropsSession();
  const { organizationRef, runtime } = useZeropsData();
  const { clientId, enabled } = input;
  const debt = accountThrowawayDebt(client);
  const owed = () => (clientId === undefined ? null : debt.failedAt(clientId));
  const failedAt = useSyncExternalStore(debt.subscribe, owed, owed);
  const [ask, setAsk] = useState<{
    readonly debt: typeof debt;
    readonly clientId: string | undefined;
    readonly n: number;
  } | null>(null);
  const asked = ask?.debt === debt && ask.clientId === clientId ? ask.n : 0;
  const [view, setView] = useState({ debt, clientId, ...IDLE });
  const scope = useRef<AbortController | null>(null);
  const attempted = useRef<{
    readonly debt: typeof debt;
    readonly clientId: string;
    readonly asked: number;
  } | null>(null);
  const again = useCallback(
    () =>
      setAsk((value) => ({
        debt,
        clientId,
        n: value?.debt === debt && value.clientId === clientId ? value.n + 1 : 1,
      })),
    [clientId, debt],
  );

  // A new mint updates the queue without aborting a cleanup already in flight. An organization
  // or account change does abort it, before its next delete or any settlement of the old debt.
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    return () => controller.abort();
  }, [clientId, debt]);

  useEffect(() => {
    const controller = scope.current;
    if (!enabled || clientId === undefined || controller === null || controller.signal.aborted)
      return;
    const previous = attempted.current;
    if (previous?.debt === debt && previous.clientId === clientId && previous.asked === asked)
      return;
    const explicit = asked > 0;
    if (failedAt === null && !explicit) return;
    const publish = (next: CleanupState) => {
      if (!controller.signal.aborted) setView({ debt, clientId, ...next });
    };
    if (!explicit && debt.sweepFailed(clientId)) {
      publish({ state: "failed", failure: "Sign-in cleanup failed. Try again." });
      return;
    }
    const sweep = async () => {
      attempted.current = { debt, clientId, asked };
      publish({ state: "running", failure: null });
      // Capture the eligible debt before the list read: a mint arriving meanwhile stays owed.
      const upToMs = Math.min(
        debt.failedAt(clientId) ?? Date.now(),
        Date.now() - THROWAWAY_SWEEP_AGE_MS - 1,
      );
      try {
        const request = {
          kind: "tokens",
          account: runtime.scope,
          organization: organizationRef(clientId),
        } as const;
        const tokens = await readZeropsCell(runtime.cells, request, controller.signal, explicit);
        if (controller.signal.aborted) return;
        const stale = planThrowawaySweep({
          tokens: tokens
            .filter(
              (token) =>
                token.createdByUser === undefined || token.createdByUser === client.session?.userId,
            )
            .map((token) => ({
              id: token.tokenId,
              name: token.name,
              ...(token.created === undefined ? {} : { created: token.created }),
            })),
          nowEpochMs: Date.now(),
        });
        for (const tokenId of stale) {
          if (controller.signal.aborted) return;
          await client.deleteIntegrationToken({ clientId, tokenId }, controller.signal);
        }
        if (controller.signal.aborted) return;
        debt.settle(clientId, upToMs);
        publish({ state: "done", failure: null });
      } catch (cause) {
        // Explicit legacy discovery can fail without an existing debt: own its next cleanup too.
        if (controller.signal.aborted) return;
        debt.failSweep(clientId, upToMs);
        publish({
          state: "failed",
          failure: cause instanceof Error ? cause.message : "Zerops did not confirm cleanup.",
        });
      }
    };
    const wait = explicit
      ? 0
      : Math.max(0, failedAt! + THROWAWAY_SWEEP_AGE_MS + PAST_THE_WINDOW_MS - Date.now());
    if (wait > 0) publish({ state: "waiting", failure: null });
    const timer = setTimeout(() => void sweep(), wait);
    return () => clearTimeout(timer);
  }, [asked, client, clientId, debt, enabled, failedAt, organizationRef, runtime]);

  return { ...(view.debt === debt && view.clientId === clientId ? view : IDLE), again };
}

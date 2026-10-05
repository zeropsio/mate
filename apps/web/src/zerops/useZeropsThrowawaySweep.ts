/**
 * The account's door debt, cleaned up as its `throwaway-sweep` operation: once inventory admits the
 * account, outstanding mints wait past the door window, then one sweep is submitted; the person's
 * *Delete again* submits an explicit one. What the sweep deletes, and what stays owed, is the
 * operation's (`executors/throwawaySweep.ts`); this hook only says where the cleanup stands. A
 * failed cleanup stays visible until an explicit again.
 */
import { SWEEP_FAILED_REASON } from "@t3tools/client-runtime/data";
import {
  THROWAWAY_SWEEP_AGE_MS,
  type ThrowawayCleanupFailure,
} from "@t3tools/client-runtime/zerops/doorThrowaway";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useAccountOperations } from "./accountOperations";
import { accountThrowawayDebt } from "./throwawayDebt";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** Past the door's window, so the newest recorded mint is eligible for the sweep. */
const PAST_THE_WINDOW_MS = 1_000;

type CleanupState = {
  readonly state: "idle" | "waiting" | "running" | "done" | "failed" | "unknown";
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
  const { client, user } = useZeropsSession();
  const userId = user?.id ?? null;
  const operations = useAccountOperations();
  const { clientId, enabled } = input;
  const debt = accountThrowawayDebt(client);
  // Mint and deletion can finish in the same millisecond: the outcome, not just its time,
  // must wake the presentation.
  const snapshot = () =>
    clientId === undefined
      ? ""
      : JSON.stringify([
          debt.failedAt(clientId),
          debt.cleanupFailures(clientId),
          debt.sweepFailed(clientId),
        ]);
  const cleanupSnapshot = useSyncExternalStore(debt.subscribe, snapshot, snapshot);
  const [failedAt, failures, needsAgain] = useMemo(
    () =>
      JSON.parse(cleanupSnapshot || "[null,[],false]") as readonly [
        number | null,
        ReadonlyArray<ThrowawayCleanupFailure>,
        boolean,
      ],
    [cleanupSnapshot],
  );
  const [view, setView] = useState({ debt, clientId, ...IDLE });
  /** The sweep this account and organization submitted last, and whether it is still out. */
  const submitted = useRef<{
    readonly debt: typeof debt;
    readonly clientId: string;
    readonly explicit: boolean;
    running: boolean;
  } | null>(null);

  const sweep = useCallback(
    (explicit: boolean) => {
      if (clientId === undefined) return;
      const attempt = { debt, clientId, explicit, running: true };
      submitted.current = attempt;
      const publish = (next: CleanupState) => setView({ debt, clientId, ...next });
      publish({ state: "running", failure: null });
      void operations
        .submit({ kind: "throwaway-sweep", clientId, userId, explicit })
        .then(({ progress, evidence }) => {
          attempt.running = false;
          if (progress.stage === "done" && progress.outcome === "succeeded") {
            publish({ state: "done", failure: null });
            return;
          }
          const outstanding = debt.cleanupFailures(clientId)[0];
          publish({
            state: outstanding?.state ?? "failed",
            failure: outstanding?.reason ?? evidence ?? SWEEP_FAILED_REASON,
          });
        })
        .catch((cause: unknown) => {
          // A sweep that broke on the way is over: it says why, and may be asked again.
          attempt.running = false;
          publish({
            state: "failed",
            failure: cause instanceof Error ? cause.message : SWEEP_FAILED_REASON,
          });
        });
    },
    [clientId, debt, operations, userId],
  );

  const again = useCallback(() => {
    const last = submitted.current;
    if (last?.running === true && last.debt === debt && last.clientId === clientId) return;
    sweep(true);
  }, [clientId, debt, sweep]);

  // Once inventory admits the account: a failed cleanup is shown until the person asks again; a
  // debt still inside the door's window waits it out; then one sweep.
  useEffect(() => {
    if (!enabled || clientId === undefined || failedAt === null) return;
    const last = submitted.current;
    const ours = last !== null && last.debt === debt && last.clientId === clientId;
    if (needsAgain) {
      // Our own sweep said how it failed; a failure recorded since is shown over it.
      if (ours && (last.running || failures.length === 0)) return;
      const failure = failures[0];
      setView({
        debt,
        clientId,
        state: failure?.state ?? "failed",
        failure: failure?.reason ?? SWEEP_FAILED_REASON,
      });
      return;
    }
    if (ours) return;
    const wait = Math.max(0, failedAt + THROWAWAY_SWEEP_AGE_MS + PAST_THE_WINDOW_MS - Date.now());
    if (wait === 0) {
      sweep(false);
      return;
    }
    setView({ debt, clientId, state: "waiting", failure: null });
    const timer = setTimeout(() => sweep(false), wait);
    return () => clearTimeout(timer);
  }, [clientId, debt, enabled, failedAt, failures, needsAgain, sweep]);

  return { ...(view.debt === debt && view.clientId === clientId ? view : IDLE), again };
}

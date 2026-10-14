/**
 * The account's door debt, cleaned up as its `throwaway-sweep` operation: once inventory admits the
 * account, outstanding mints wait past the door window, then one sweep is submitted; the person's
 * *Delete again* submits an explicit one. What the sweep deletes, and what stays owed, is the
 * operation's (`executors/throwawaySweep.ts`); this hook only says where the cleanup stands. A
 * refused cleanup stays visible until an explicit again. One whose outcome is unknown (it never
 * reached Zerops, or Zerops failed) asks again by itself a few times first, quietly: its tokens
 * carry no rights, and a network blip is not the person's to fix.
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

/** The waits before each automatic again of a cleanup whose outcome is unknown. */
const UNKNOWN_RETRY_MS = [30_000, 120_000, 600_000] as const;

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
  /** The automatic agains this account and organization spent, and the one waiting. */
  const retries = useRef<{
    readonly debt: typeof debt;
    readonly clientId: string | undefined;
    count: number;
  }>({ debt, clientId, count: 0 });
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sweepLater = useRef<(explicit: boolean) => void>(() => undefined);

  /**
   * Schedules the next automatic again of a cleanup whose outcome is unknown, showing it as
   * queued; false for a refusal, or once the tries are spent.
   */
  const retryUnknown = useCallback(
    (failure: ThrowawayCleanupFailure | undefined): boolean => {
      if (failure?.state !== "unknown" || clientId === undefined) return false;
      if (retries.current.debt !== debt || retries.current.clientId !== clientId)
        retries.current = { debt, clientId, count: 0 };
      if (retryTimer.current === null) {
        const wait = UNKNOWN_RETRY_MS[retries.current.count];
        if (wait === undefined) return false;
        retries.current.count += 1;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          sweepLater.current(true);
        }, wait);
      }
      setView({ debt, clientId, state: "waiting", failure: null });
      return true;
    },
    [clientId, debt],
  );
  // A pending again belongs to the account and organization it was scheduled for.
  useEffect(
    () => () => {
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    },
    [clientId, debt],
  );
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
            retries.current = { debt, clientId, count: 0 };
            publish({ state: "done", failure: null });
            return;
          }
          const outstanding = debt.cleanupFailures(clientId)[0];
          if (retryUnknown(outstanding)) return;
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
    [clientId, debt, operations, retryUnknown, userId],
  );
  useEffect(() => {
    sweepLater.current = sweep;
  }, [sweep]);

  const again = useCallback(() => {
    const last = submitted.current;
    if (last?.running === true && last.debt === debt && last.clientId === clientId) return;
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
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
      if (retryUnknown(failure)) return;
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
  }, [clientId, debt, enabled, failedAt, failures, needsAgain, retryUnknown, sweep]);

  return { ...(view.debt === debt && view.clientId === clientId ? view : IDLE), again };
}

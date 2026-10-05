/**
 * One inventory-owned cleanup attempt for the account's persisted door debt. Outstanding mints
 * wait past the door window, then exactly the throwaways owed are deleted — by the id their mint
 * answered, or by their name where that answer was lost — never another tab's or device's by its
 * look or its age. An explicit cleanup also deletes the person's own throwaways older than the
 * door's window by the platform's `created`: no door admits them, whoever minted them. Failed
 * cleanup stays visible until an explicit again. Nothing owed lists nothing until asked.
 */
import {
  planExpiredThrowaways,
  planThrowawaySweep,
  THROWAWAY_SWEEP_AGE_MS,
  throwawayCleanupFailureState,
  type ThrowawayCleanupFailure,
} from "@t3tools/client-runtime/zerops/doorThrowaway";
import { ZeropsApiError } from "@t3tools/client-runtime/zerops";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { readZeropsCell } from "./readZeropsCell";
import { accountThrowawayDebt } from "./throwawayDebt";
import { useZeropsData } from "./zeropsDataContext";
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
  const userId = user?.id;
  const { organizationRef, runtime } = useZeropsData();
  const { clientId, enabled } = input;
  const debt = accountThrowawayDebt(client);
  // Mint and deletion can finish in the same millisecond: the outcome, not just its time,
  // must wake the presentation and cancel any queued inventory cleanup.
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
    running: boolean;
  } | null>(null);
  const again = useCallback(() => {
    const active = attempted.current;
    if (active?.running && active.debt === debt && active.clientId === clientId) return;
    setAsk((value) => ({
      debt,
      clientId,
      n: value?.debt === debt && value.clientId === clientId ? value.n + 1 : 1,
    }));
  }, [clientId, debt]);

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
    const alreadyAttempted =
      previous?.debt === debt && previous.clientId === clientId && previous.asked === asked;
    if (alreadyAttempted && previous.running) return;
    const explicit = asked > 0 && !alreadyAttempted;
    if (failedAt === null && !explicit) return;
    const publish = (next: CleanupState) => {
      if (!controller.signal.aborted) setView({ debt, clientId, ...next });
    };
    const publishOutstandingFailure = () => {
      const failure = debt.cleanupFailures(clientId)[0];
      publish({
        state: failure?.state ?? "failed",
        failure: failure?.reason ?? "Sign-in cleanup failed. Delete again.",
      });
    };
    if (!explicit && needsAgain) {
      const failure = failures[0];
      if (failure === undefined && alreadyAttempted) return;
      publish({
        state: failure?.state ?? "failed",
        failure: failure?.reason ?? "Sign-in cleanup failed. Delete again.",
      });
      return;
    }
    if (alreadyAttempted) return;
    const sweep = async () => {
      const attempt = { debt, clientId, asked, running: true };
      attempted.current = attempt;
      publish({ state: "running", failure: null });
      // Capture the eligible debt before the list read: a mint arriving meanwhile stays owed.
      const upToMs = Math.min(
        debt.failedAt(clientId) ?? Date.now(),
        Date.now() - THROWAWAY_SWEEP_AGE_MS - 1,
      );
      try {
        const targets = explicit ? failures : [];
        if (targets.length > 0 && targets.every((target) => target.tokenId !== undefined)) {
          for (const target of targets) {
            if (controller.signal.aborted || target.tokenId === undefined) return;
            try {
              await client.deleteIntegrationToken(
                { clientId, tokenId: target.tokenId },
                controller.signal,
              );
            } catch (cause) {
              if (controller.signal.aborted) return;
              if (!(cause instanceof ZeropsApiError && cause.kind === "not-found")) {
                const state = throwawayCleanupFailureState(cause);
                const failure =
                  cause instanceof Error ? cause.message : "Zerops did not confirm cleanup.";
                debt.failCleanup(clientId, Date.now(), { ...target, state, reason: failure });
                publish({ state, failure });
                return;
              }
            }
            if (controller.signal.aborted) return;
            debt.finish(clientId, target.attempt);
          }
          const outstanding = debt.cleanupFailures(clientId)[0];
          publish(
            outstanding === undefined
              ? { state: "done", failure: null }
              : {
                  state: outstanding.state,
                  failure: outstanding.reason,
                },
          );
          return;
        }
        const owed = debt.owed(clientId, upToMs);
        const request = {
          kind: "tokens",
          account: runtime.scope,
          organization: organizationRef(clientId),
        } as const;
        // An automatic sweep needs the list only for a mint whose answer was lost, found by its
        // name; an explicit one also reads it for the person's own throwaways no door admits.
        const tokens =
          explicit || owed.some((entry) => entry.tokenId === undefined)
            ? await readZeropsCell(runtime.cells, request, controller.signal, explicit)
            : [];
        if (controller.signal.aborted) return;
        const rows = tokens.map((token) => ({
          id: token.tokenId,
          name: token.name,
          created: token.created,
          createdByUser: token.createdByUser,
        }));
        const stale = new Set([
          ...planThrowawaySweep({ tokens: rows, owed }),
          ...(explicit && userId !== undefined
            ? planExpiredThrowaways({ tokens: rows, userId, nowEpochMs: Date.now() })
            : []),
        ]);
        for (const tokenId of stale) {
          if (controller.signal.aborted) return;
          if (!explicit && debt.sweepFailed(clientId)) {
            publishOutstandingFailure();
            return;
          }
          try {
            await client.deleteIntegrationToken({ clientId, tokenId }, controller.signal);
          } catch (cause) {
            if (!(cause instanceof ZeropsApiError && cause.kind === "not-found")) throw cause;
          }
        }
        if (controller.signal.aborted) return;
        if (!explicit && debt.sweepFailed(clientId)) {
          publishOutstandingFailure();
          return;
        }
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
      } finally {
        attempt.running = false;
      }
    };
    const wait = explicit
      ? 0
      : Math.max(0, failedAt! + THROWAWAY_SWEEP_AGE_MS + PAST_THE_WINDOW_MS - Date.now());
    if (wait > 0) publish({ state: "waiting", failure: null });
    const timer = setTimeout(() => void sweep(), wait);
    return () => clearTimeout(timer);
  }, [
    asked,
    client,
    clientId,
    debt,
    enabled,
    failedAt,
    failures,
    needsAgain,
    organizationRef,
    runtime,
    userId,
  ]);

  return { ...(view.debt === debt && view.clientId === clientId ? view : IDLE), again };
}

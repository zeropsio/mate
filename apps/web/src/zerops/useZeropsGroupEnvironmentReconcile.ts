/**
 * Finishes a stage or a production whose creation lost its last writes, or whose deploy key HQ
 * does not hold, or holds broken (main D21, E07).
 *
 * A creation makes its project, waits for its services, then attaches the project to its
 * application in HQ and hands HQ its deploy key (`addGroupEnvironment.ts`). Those live in the page
 * that made it: a reload in that minute kept the project and lost them, and the page went on
 * asking for a production it already had (the rehearsal of 2026-09-17). Off the list the projects
 * screen already reads, this runs the same writes for every half-made environment — each
 * idempotent, so a creation still on its way in this tab is not raced (the reconcile waits for it)
 * and one that finished elsewhere is a no-op.
 *
 * Each repair runs once per change in what it repairs — the half-made
 * environment as the list states it — and never again because the page's
 * gate flipped: a repair in flight is not aborted by the gate closing, and an
 * entry already repaired is not started over when it opens (a cold load's
 * loading flips repeated it, a `GET /project` and two broker reads each time).
 * A failed one is tried again on a backoff (`RECONCILE_RETRY_MS`); what is
 * outstanding meanwhile shows as the row that still asks.
 */

import type { HalfMadeGroupEnvironment, ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import type { HqEndpoint } from "@t3tools/client-runtime/zerops/hq";
import { useEffect, useRef, useState } from "react";

import { addGroupEnvironment, type AddGroupEnvironmentOutcome } from "./addGroupEnvironment";
import { accountHqApi } from "./accountHq";

export function useZeropsGroupEnvironmentReconcile(input: {
  readonly enabled: boolean;
  readonly client: ZeropsApiClient;
  readonly clientId: string | undefined;
  /** The organization's HQ, where the registry and the keys live; none while no organization is open. */
  readonly hq: HqEndpoint | undefined;
  readonly halfMade: ReadonlyArray<HalfMadeGroupEnvironment>;
  /** What each repair came to — the caller says what is still outstanding. */
  readonly onOutcome?:
    | ((entry: HalfMadeGroupEnvironment, outcome: AddGroupEnvironmentOutcome) => void)
    | undefined;
}): void {
  const { client, clientId, enabled, halfMade, hq } = input;
  const onOutcome = useRef(input.onOutcome);
  onOutcome.current = input.onOutcome;
  // The list through a ref: its identity changes on every inventory push,
  // and an effect keyed on it aborted a repair between the branch and the
  // pull request (2026-09-17). The key below is what changes when the list
  // does.
  const latest = useRef(halfMade);
  latest.current = halfMade;
  // What this tab has run a repair for, per project: the entry it repaired (a changed entry is
  // repaired again), and how its last run ended. An entry is put in before its repair starts, so
  // two runs cannot repair the same one; one given back (an unmount before its turn) is taken out,
  // so the next enabled run reaches it — otherwise a page with two half-made environments repaired
  // the first, was remounted, and never looked at the second again (measured 2026-09-18).
  const attempted = useRef(
    new Map<
      string,
      {
        readonly entry: string;
        state: "running" | "done" | "failed";
        failures: number;
        retryAtMs: number;
      }
    >(),
  );
  /** The repairs in flight, aborted only when the page goes, never by its gate closing. */
  const running = useRef(new Set<AbortController>());
  useEffect(() => {
    const inFlight = running.current;
    return () => {
      for (const controller of inFlight) controller.abort();
      inFlight.clear();
    };
  }, []);
  /** Moves when a failed repair's backoff is over, so the effect looks again. */
  const [due, setDue] = useState(0);
  const key = halfMade
    .map((entry) => JSON.stringify(entry))
    .sort()
    .join(";");

  useEffect(() => {
    if (!enabled || clientId === undefined || hq === undefined || key === "") return;
    const now = Date.now();
    const pending = latest.current.filter((entry) => {
      const record = attempted.current.get(entry.projectId);
      return (
        record === undefined ||
        record.entry !== JSON.stringify(entry) ||
        (record.state === "failed" && now >= record.retryAtMs)
      );
    });
    if (pending.length === 0) return;
    for (const entry of pending) {
      const before = attempted.current.get(entry.projectId);
      attempted.current.set(entry.projectId, {
        entry: JSON.stringify(entry),
        state: "running",
        failures: before?.entry === JSON.stringify(entry) ? before.failures : 0,
        retryAtMs: 0,
      });
    }
    const controller = new AbortController();
    running.current.add(controller);
    /** Gives back every entry this run will not reach, so the next one does. */
    const release = (from: number) => {
      for (const entry of pending.slice(from)) attempted.current.delete(entry.projectId);
    };
    /** A repair that failed is tried again once its backoff is over. */
    const failed = (entry: HalfMadeGroupEnvironment) => {
      const record = attempted.current.get(entry.projectId);
      if (record === undefined) return;
      record.failures += 1;
      const waitMs = RECONCILE_RETRY_MS[Math.min(record.failures, RECONCILE_RETRY_MS.length) - 1]!;
      record.state = "failed";
      record.retryAtMs = Date.now() + waitMs;
      setTimeout(() => {
        if (!controller.signal.aborted) setDue((count) => count + 1);
      }, waitMs);
    };
    void (async () => {
      try {
        for (const [index, entry] of pending.entries()) {
          if (controller.signal.aborted) return release(index);
          const outcome = await addGroupEnvironment({
            client,
            hq: accountHqApi(client, clientId, hq),
            clientId,
            groupId: entry.groupId,
            environment: { tier: entry.tier, project: entry.projectId },
            signal: controller.signal,
          }).catch((): AddGroupEnvironmentOutcome | undefined => undefined);
          // An abort — the page went — leaves it unfinished, so this entry is given back too.
          if (controller.signal.aborted) return release(index);
          if (outcome === undefined || outcome.failed !== undefined) failed(entry);
          else {
            const record = attempted.current.get(entry.projectId);
            if (record !== undefined) record.state = "done";
          }
          if (outcome !== undefined) onOutcome.current?.(entry, outcome);
        }
      } finally {
        running.current.delete(controller);
      }
    })();
    // No cleanup: the gate closing (a loading flip) does not abort a repair in flight; the
    // page going does (above). `key` is the half-made list; the list is read through a ref so a
    // re-render does not abort a repair in flight either.
  }, [client, clientId, due, enabled, hq, key]);
}

/** How long a failed repair waits before it is tried again, by its count of failures. */
export const RECONCILE_RETRY_MS: ReadonlyArray<number> = [30_000, 60_000, 120_000, 300_000];

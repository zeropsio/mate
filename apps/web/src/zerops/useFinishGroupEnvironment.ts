/**
 * Finishes a stage or a production whose creation lost its last writes, or whose deploy key HQ
 * does not hold, or holds broken (main D21, E07) — when the person asks, from its project's menu.
 *
 * A creation makes its project, waits for its services, then attaches the project to its
 * application in HQ and hands HQ its deploy key (`addGroupEnvironment.ts`). Those live in the page
 * that made it: a reload in that minute kept the project and lost them. The projects page says so
 * on the project's row and offers *Finish setting up*; it never runs the writes by itself (audit
 * R2, 2026-10-03: an admin's open client minted a deploy key 1 s after an import, with no click,
 * and two tabs could mint two). Each write is idempotent: one that finished elsewhere is a no-op.
 *
 * What a finish came to is said on its project's row: running, or — where a step did not go
 * through — that it could not; one that went through says nothing more.
 */

import type {
  GroupEnvironmentTier,
  HalfMadeGroupEnvironment,
} from "@t3tools/client-runtime/zerops";
import type { HqEndpoint } from "@t3tools/client-runtime/zerops/hq";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AccountOperations } from "./accountOperations";
import { addGroupEnvironment } from "./addGroupEnvironment";

export interface FinishGroupEnvironment {
  /** The projects whose environment is being finished now, by group, with its tier. */
  readonly finishing: ReadonlyMap<string, GroupEnvironmentTier>;
  /** The projects whose last finish did not go through, by group, with its tier. */
  readonly unfinished: ReadonlyMap<string, GroupEnvironmentTier>;
  /** Finishes `entry`, as the person asked. */
  readonly finish: (entry: HalfMadeGroupEnvironment) => void;
}

const without = <V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> => {
  const next = new Map(map);
  next.delete(key);
  return next;
};

export function useFinishGroupEnvironment(input: {
  /** The account's operations: the attach and the key HQ executes, and HQ's navigation. */
  readonly operations: Pick<AccountOperations, "run" | "untilEnvironment">;
  readonly clientId: string | undefined;
  /** The organization's HQ, where the registry and the keys live; none while no organization is open. */
  readonly hq: HqEndpoint | undefined;
}): FinishGroupEnvironment {
  const { operations, clientId, hq } = input;
  const [finishing, setFinishing] = useState<ReadonlyMap<string, GroupEnvironmentTier>>(
    () => new Map(),
  );
  const [unfinished, setUnfinished] = useState<ReadonlyMap<string, GroupEnvironmentTier>>(
    () => new Map(),
  );
  /** The finishes in flight, aborted when the page goes. */
  const running = useRef(new Set<AbortController>());
  useEffect(() => {
    const inFlight = running.current;
    return () => {
      for (const controller of inFlight) controller.abort();
      inFlight.clear();
    };
  }, []);

  const finish = useCallback(
    (entry: HalfMadeGroupEnvironment) => {
      if (clientId === undefined || hq === undefined) return;
      const controller = new AbortController();
      running.current.add(controller);
      setFinishing((current) => new Map(current).set(entry.groupId, entry.tier));
      void (async () => {
        let wentThrough = false;
        try {
          const outcome = await addGroupEnvironment({
            operations,
            orgId: clientId,
            hq,
            groupId: entry.groupId,
            environment: { tier: entry.tier, project: entry.projectId },
          });
          wentThrough = outcome.failed === undefined;
        } catch {
          // A finish that threw did not go through: its row says so.
        }
        running.current.delete(controller);
        if (controller.signal.aborted) return;
        setFinishing((current) => without(current, entry.groupId));
        setUnfinished((current) =>
          wentThrough
            ? without(current, entry.groupId)
            : new Map(current).set(entry.groupId, entry.tier),
        );
      })();
    },
    [operations, clientId, hq],
  );

  return { finishing, unfinished, finish };
}

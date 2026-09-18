/**
 * Finishes a stage or a production whose creation lost its last writes.
 *
 * A creation makes its project, waits for its services, then registers the
 * project in the group, grants the broker and declares it on the group repo
 * (`addGroupEnvironment.ts`). Those three live in the page that made it: a
 * reload in that minute kept the project and lost them, and the page went on
 * asking for a production it already had (the rehearsal of 2026-09-17). Off
 * the list the projects screen already reads, this runs the same three
 * writes for every half-made environment — each idempotent, so a creation
 * still on its way in this tab is not raced (the reconcile waits for it) and
 * one that finished elsewhere is a no-op.
 *
 * Failures are swallowed: a background repair, tried again on the next read;
 * what is outstanding shows as the row that still asks.
 */

import type {
  HalfMadeGroupEnvironment,
  ZeropsApiClient,
  ZeropsRegistry,
} from "@t3tools/client-runtime/zerops";
import { useEffect, useRef } from "react";

import { addGroupEnvironment, type AddGroupEnvironmentOutcome } from "./addGroupEnvironment";
import { giteaClientFor } from "./giteaSession";
import { registryGroupSlug } from "./useZeropsRegistry";

export function useZeropsGroupEnvironmentReconcile(input: {
  readonly enabled: boolean;
  readonly client: ZeropsApiClient;
  readonly clientId: string | undefined;
  readonly giteaOrigin: string | undefined;
  readonly giteaProjectId: string | undefined;
  readonly registry: ZeropsRegistry;
  readonly refreshRegistry: () => void;
  readonly halfMade: ReadonlyArray<HalfMadeGroupEnvironment>;
  /** What each repair came to — the caller says what is still outstanding. */
  readonly onOutcome?:
    | ((entry: HalfMadeGroupEnvironment, outcome: AddGroupEnvironmentOutcome) => void)
    | undefined;
}): void {
  const { client, clientId, enabled, giteaOrigin, giteaProjectId, halfMade, refreshRegistry } =
    input;
  const registry = useRef(input.registry);
  registry.current = input.registry;
  const refresh = useRef(refreshRegistry);
  refresh.current = refreshRegistry;
  const onOutcome = useRef(input.onOutcome);
  onOutcome.current = input.onOutcome;
  // The list through a ref: its identity changes on every inventory push,
  // and an effect keyed on it aborted a repair between the branch and the
  // pull request (2026-09-17). The key below is what changes when the list
  // does.
  const latest = useRef(halfMade);
  latest.current = halfMade;
  // What this tab has already run a repair for. An entry is put in before its
  // repair starts, so two effects cannot run the same one, and taken out again
  // if the effect is torn down before that entry's turn — otherwise a page with
  // two half-made environments repaired the first, was remounted, and never
  // looked at the second again (measured 2026-09-18: the test org's stage kept
  // its missing deploy token through reload after reload while its production
  // got one).
  const attempted = useRef(new Set<string>());
  const key = halfMade
    .map((entry) => `${entry.groupId}:${entry.projectId}:${entry.tier}`)
    .sort()
    .join(";");

  useEffect(() => {
    if (!enabled || clientId === undefined || giteaOrigin === undefined || key === "") return;
    const pending = latest.current.filter((entry) => !attempted.current.has(entry.projectId));
    if (pending.length === 0) return;
    for (const entry of pending) attempted.current.add(entry.projectId);
    const controller = new AbortController();
    /** Gives back every entry this run will not reach, so the next one does. */
    const release = (from: number) => {
      for (const entry of pending.slice(from)) attempted.current.delete(entry.projectId);
    };
    void (async () => {
      for (const [index, entry] of pending.entries()) {
        if (controller.signal.aborted) return release(index);
        const outcome = await addGroupEnvironment({
          client,
          gitea: giteaClientFor(giteaOrigin),
          clientId,
          giteaProjectId,
          registry: registry.current,
          groupId: entry.groupId,
          slug: registryGroupSlug(registry.current, entry.groupId),
          environment: {
            displayName: entry.displayName,
            tier: entry.tier,
            project: entry.projectId,
          },
          signal: controller.signal,
        }).catch((): AddGroupEnvironmentOutcome | undefined => undefined);
        // An abort during the repair leaves it unfinished, so this entry is
        // given back too: the next effect is what tries it again.
        if (controller.signal.aborted) return release(index);
        if (outcome !== undefined) onOutcome.current?.(entry, outcome);
      }
      if (!controller.signal.aborted) refresh.current();
    })();
    return () => {
      controller.abort();
    };
    // `key` is the half-made list; the list, the registry and the refresh are
    // read through refs so a re-render does not abort a repair in flight.
  }, [client, clientId, enabled, giteaOrigin, giteaProjectId, key]);
}

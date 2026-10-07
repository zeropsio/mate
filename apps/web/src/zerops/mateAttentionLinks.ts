/**
 * The account's two hands on its Mates' attention, held with its store (`ZeropsAccountData`):
 *
 * - **useOpenMatesAttention** reads the attention straight from each Mate this page holds open — its
 *   socket connected, its project known — for as long as it is; HQ's relay covers the rest.
 * - **useMateResultsSeen** tells HQ which results of a Mate the person saw (`seenResultsOf`), so HQ
 *   counts what they have not seen, whichever device they saw it on.
 */
import { useAtomValue } from "@effect/atom-react";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  makeMateAttentionWire,
  makeMateHealthWire,
  startMateHealth,
  matesAttention,
  startMateAttention,
  type AccountStore,
  type MateAttentionRead,
} from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useEffect, useRef } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { zeropsEnvironmentsAtom } from "../state/zerops";
import { useUiStateStore } from "../uiStateStore";
import { seenResultsOf } from "./mateActivity";

/** The app's connection registry, once its runtime is built. */
const connectionRegistryAtom = connectionAtomRuntime.atom(
  Effect.map(EnvironmentRegistry, (registry) => registry),
);

export function useOpenMatesAttention(store: AccountStore): void {
  const environments = useAtomValue(zeropsEnvironmentsAtom);
  const registry = Option.getOrUndefined(AsyncResult.value(useAtomValue(connectionRegistryAtom)));
  // Each open Mate by its project, as one key: the links move only when the set does.
  const open = environments
    .flatMap((environment) =>
      environment.connection.phase === "connected" &&
      typeof environment.zeropsProjectId === "string"
        ? [`${environment.zeropsProjectId}=${environment.environmentId}`]
        : [],
    )
    .toSorted()
    .join(",");
  const running = useRef<{
    readonly store: AccountStore;
    readonly links: Map<string, { readonly stop: () => void }>;
  } | null>(null);
  useEffect(() => {
    if (registry === undefined) return;
    // Another account's store: what ran for the one before stops.
    if (running.current?.store !== store) {
      for (const link of running.current?.links.values() ?? []) link.stop();
      running.current = { store, links: new Map() };
    }
    const { links } = running.current;
    const wanted = new Set(open.length === 0 ? [] : open.split(","));
    for (const [entry, link] of links) {
      if (wanted.has(entry)) continue;
      link.stop();
      links.delete(entry);
    }
    for (const entry of wanted) {
      if (links.has(entry)) continue;
      const [projectId, environmentId] = entry.split("=") as [string, EnvironmentId];
      const health = startMateHealth({
        projectId,
        store,
        wire: makeMateHealthWire({ registry, environmentId }),
      });
      const attention = startMateAttention({
        projectId,
        store,
        wire: makeMateAttentionWire({ registry, environmentId }),
      });
      links.set(entry, {
        stop: () => {
          health.stop();
          attention.stop();
        },
      });
    }
  }, [open, registry, store]);
  useEffect(
    () => () => {
      for (const link of running.current?.links.values() ?? []) link.stop();
      running.current = null;
    },
    [],
  );
}

const NO_ATTENTION_READ: Readonly<Record<string, MateAttentionRead>> = {};
const NO_ATTENTION = Atom.make(NO_ATTENTION_READ);

export function useMateResultsSeen(
  store: AccountStore,
  orgId: string | null,
  seen: (projectId: string, resultIds: ReadonlyArray<string>) => void,
): void {
  const attention = useAtomValue(
    orgId === null ? NO_ATTENTION : store.data.project(matesAttention, orgId),
  );
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  /**
   * What was told HQ already, by project, while it counted the same unseen: told again once its
   * count moves. A word told while HQ's link is down, the link tells HQ once it is up again.
   */
  const told = useRef(new Map<string, { readonly unseen: number; readonly ids: Set<string> }>());
  useEffect(() => {
    told.current.clear();
  }, [orgId, store]);
  useEffect(() => {
    for (const [projectId, read] of Object.entries(attention)) {
      // Only HQ counts what is unseen; nothing to tell it while it counts nothing.
      if (read.attention === null || read.unseen === null || read.unseen === 0) continue;
      const prior = told.current.get(projectId);
      const already = prior?.unseen === read.unseen ? prior.ids : new Set<string>();
      const fresh = seenResultsOf(read.attention, lastVisitedAtById).filter(
        (id) => !already.has(id),
      );
      if (fresh.length === 0) continue;
      for (const id of fresh) already.add(id);
      told.current.set(projectId, { unseen: read.unseen, ids: already });
      seen(projectId, fresh);
    }
  }, [attention, lastVisitedAtById, seen]);
}

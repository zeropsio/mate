/**
 * Where a host demands the topology of the project its environment belongs to (DESIGN §2.C C11).
 * The topology itself is derived from the account's runtime (`projectTopologyAtom`), so every
 * reader — this host, and the protected roots through `useZeropsTopology` — sees one value with
 * nobody writing it.
 */
import type { RuntimeInterestDescriptor } from "@t3tools/client-runtime/zerops/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo, useSyncExternalStore } from "react";

import { PROJECT_HISTORY_WINDOW, type ProjectTopologySnapshot } from "../state/zerops";
import { useEnvironmentProjectRef, useEnvironmentTopology } from "./useZeropsFeeds";
import * as Effect from "effect/Effect";
import { useZeropsData, useZeropsDataInterest } from "./zeropsDataContext";

const subscribeVisibility = (notify: () => void) => {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
};
const visibleSnapshot = () =>
  typeof document === "undefined" || document.visibilityState !== "hidden";

export function useProjectTopology(
  environmentId: EnvironmentId | null,
  { metrics = false }: { readonly metrics?: boolean } = {},
): ProjectTopologySnapshot & { readonly again: () => void } {
  const tabVisible = useSyncExternalStore(subscribeVisibility, visibleSnapshot, () => true);
  const metricsVisible = metrics && tabVisible;
  const project = useEnvironmentProjectRef(environmentId);
  const { runtime } = useZeropsData();
  const topologyDescriptor = useMemo<RuntimeInterestDescriptor | null>(
    () => (project === null ? null : { kind: "project-topology", project }),
    [project],
  );
  const metricsDescriptor = useMemo<RuntimeInterestDescriptor | null>(
    () =>
      project === null || !metricsVisible ? null : { kind: "project-current-metrics", project },
    [project, metricsVisible],
  );
  const historyDescriptor = useMemo<RuntimeInterestDescriptor | null>(
    () =>
      project === null || !metricsVisible
        ? null
        : { kind: "project-metric-history", project, window: PROJECT_HISTORY_WINDOW },
    [project, metricsVisible],
  );
  useZeropsDataInterest(topologyDescriptor);
  useZeropsDataInterest(metricsDescriptor);
  useZeropsDataInterest(historyDescriptor);
  const snapshot = useEnvironmentTopology(environmentId);
  return {
    ...snapshot,
    again: () => {
      if (project !== null) void Effect.runPromise(runtime.refresh(project));
    },
  };
}

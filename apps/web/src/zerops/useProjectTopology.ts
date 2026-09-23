/**
 * Where a host demands the topology of the project its environment belongs to (DESIGN §2.C C11).
 * The topology itself is derived from the account's runtime (`projectTopologyAtom`), so every
 * reader — this host, and the protected roots through `useZeropsTopology` — sees one value with
 * nobody writing it.
 */
import type { RuntimeInterestDescriptor } from "@t3tools/client-runtime/zerops/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import { PROJECT_HISTORY_WINDOW, type ProjectTopologySnapshot } from "../state/zerops";
import { useEnvironmentProjectRef, useEnvironmentTopology } from "./useZeropsFeeds";
import { useZeropsDataInterest } from "./zeropsDataContext";

export function useProjectTopology(environmentId: EnvironmentId | null): ProjectTopologySnapshot {
  const project = useEnvironmentProjectRef(environmentId);
  const topologyDescriptor = useMemo<RuntimeInterestDescriptor | null>(
    () =>
      project === null ? null : { kind: "project-topology", project, includeCurrentMetrics: false },
    [project],
  );
  const metricsDescriptor = useMemo<RuntimeInterestDescriptor | null>(
    () => (project === null ? null : { kind: "project-current-metrics", project }),
    [project],
  );
  const historyDescriptor = useMemo<RuntimeInterestDescriptor | null>(
    () =>
      project === null
        ? null
        : { kind: "project-metric-history", project, window: PROJECT_HISTORY_WINDOW },
    [project],
  );
  useZeropsDataInterest(topologyDescriptor);
  useZeropsDataInterest(metricsDescriptor);
  useZeropsDataInterest(historyDescriptor);
  return useEnvironmentTopology(environmentId);
}

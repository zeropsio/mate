/**
 * Where a host demands the topology of the project its environment belongs to (DESIGN §2.C C11).
 * The topology itself is derived from the account's runtime and store (`projectTopologyAtom`), so
 * every reader — this host, and the protected roots through `useZeropsTopology` — sees one value
 * with nobody writing it. A host that shows the project's resources demands its current use and
 * its last day from the account's store while it shows them in a visible tab.
 */
import type { RuntimeInterestDescriptor } from "@t3tools/client-runtime/zerops/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo, useSyncExternalStore } from "react";

import type { ProjectTopologySnapshot } from "../state/zerops";
import { useEnvironmentProjectRef, useEnvironmentTopology } from "./useZeropsFeeds";
import * as Effect from "effect/Effect";
import { useAccountDataOptional, useDetailDemand } from "./ZeropsAccountData";
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
  const project = useEnvironmentProjectRef(environmentId);
  const { runtime } = useZeropsData();
  const retry = useAccountDataOptional()?.retry;
  const topologyDescriptor = useMemo<RuntimeInterestDescriptor | null>(
    () => (project === null ? null : { kind: "project-topology", project }),
    [project],
  );
  useZeropsDataInterest(topologyDescriptor);
  const shownProjectId = metrics && tabVisible ? (project?.projectId ?? null) : null;
  useDetailDemand("usage", undefined, shownProjectId);
  useDetailDemand("usageHistory", undefined, shownProjectId);
  const snapshot = useEnvironmentTopology(environmentId);
  return {
    ...snapshot,
    again: () => {
      if (project !== null) void Effect.runPromise(runtime.refresh(project));
      retry?.();
    },
  };
}

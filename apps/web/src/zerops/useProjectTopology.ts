/**
 * Where a host demands the topology of the project its environment belongs to (DESIGN §2.C C11).
 * The topology itself is derived from the account's store (`projectTopologyAtom`), so
 * every reader — this host, and the protected roots through `useZeropsTopology` — sees one value
 * with nobody writing it. A host that shows the project's resources demands its current use and
 * its last day from the account's store while it shows them in a visible tab.
 */
import { usageOwnerOf } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import type { ProjectTopologySnapshot } from "@t3tools/client-runtime/data";
import { useEnvironmentProjectRef, useEnvironmentTopology } from "./useZeropsFeeds";
import { useAccountDataOptional, useDetailDemand } from "./ZeropsAccountData";

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
  const account = useAccountDataOptional();
  // The project's own organization, whichever is shown: a thread's Mate may run in another.
  const shownOwner =
    metrics && tabVisible && project !== null
      ? usageOwnerOf(project.organization.organizationId, project.projectId)
      : null;
  useDetailDemand("usage", undefined, shownOwner);
  useDetailDemand("usageHistory", undefined, shownOwner);
  const snapshot = useEnvironmentTopology(environmentId);
  return {
    ...snapshot,
    again: () => {
      account?.retry();
    },
  };
}

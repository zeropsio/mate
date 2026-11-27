/**
 * What Your app has, for its pane's header: the change Sites says each of the Mate's stages has
 * (`mateLinks`, `yourAppHas`), from the same reads, by the stage's hostname.
 */
import type { YourAppHas } from "@t3tools/client-runtime/zerops/yourAppHas";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";
import { useProjectsServiceValues } from "~/zerops/accountData";
import { useAppsChanges } from "~/zerops/projectFlows";
import { useMatesLeases } from "~/zerops/useMatesLeases";
import { useZeropsDetailCandidates } from "~/zerops/useZeropsCandidates";
import { deploysOf, mateLinks } from "./SidebarProjectSites.logic";

const NONE: ReadonlyArray<string> = [];
const NOTHING: ReadonlyMap<string, YourAppHas> = new Map();

export function useYourAppHas(
  /** The Mate's own project and its application; undefined where the conversation has neither. */
  mate: { readonly projectId: string; readonly groupId: string } | undefined,
): ReadonlyMap<string, YourAppHas> {
  const projectId = mate?.projectId;
  const groupId = mate?.groupId;
  const { listing } = useZeropsDetailCandidates();
  const row =
    projectId === undefined
      ? undefined
      : heldCandidates(listing).rows.find((entry) => entry.project.id === projectId);
  const appIds = useMemo(() => (groupId === undefined ? NONE : [groupId]), [groupId]);
  const merged = useAppsChanges(appIds).changes.get(groupId ?? "")?.merged;
  const projectIds = useMemo(() => (projectId === undefined ? NONE : [projectId]), [projectId]);
  const services = useProjectsServiceValues(projectIds)[projectId ?? ""];
  // Only a dev pool's parts read zcp's leases, as Sites does (`readsLeases`).
  const pooled = projectId !== undefined && (row?.services?.pools ?? NONE).length > 0;
  const copies = useMatesLeases(pooled ? [{ projectId }] : [])[projectId ?? ""];
  return useMemo(() => {
    if (projectId === undefined) return NOTHING;
    const links = mateLinks({
      projectId,
      name: "",
      owner: undefined,
      routes: row?.routes,
      hostnames: row?.services?.hostnames,
      controlPlane: row?.service?.name,
      pools: row?.services?.pools,
      leases: copies?.leases,
      poolPairs: copies?.poolPairs,
      standIns: copies?.standIns,
      merged,
      deployedAt: deploysOf(services),
    });
    return new Map(
      (links?.services ?? []).flatMap((entry) =>
        entry.yourApp === true && entry.has !== undefined ? [[entry.service, entry.has]] : [],
      ),
    );
  }, [projectId, row, copies, merged, services]);
}

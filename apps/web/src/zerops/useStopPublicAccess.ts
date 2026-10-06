/**
 * A stop's public face — its addresses and what it could open — belongs to the drawn stop's id,
 * apart from navigation and deployment reads: its routing is held — read again on its cadence —
 * only while a surface draws that stop's addresses (`publicAccess`); its project's and services'
 * rows are the account's live ones.
 */
import { publicAccess, type PublicAccessView } from "@t3tools/client-runtime/data";
import type { ProjectRef } from "@t3tools/client-runtime/zerops/data";
import { Atom } from "effect/unstable/reactivity";
import { useContext, useEffect, useMemo } from "react";

import { againStopDeployment, useStopDeployments } from "./accountForge";
import { invalidateZerops } from "./accountInvalidations";
import { useAccountDataOptional, useProjection } from "./ZeropsAccountData";
import { ZeropsDataContext } from "./zeropsDataContext";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

const READING: PublicAccessView = { routes: [], offers: [], state: "reading", denied: false };
const NOT_READ = Atom.make(READING);

/** The stops' project refs, as their deployments are read. */
function useStopRefs(projectIds: ReadonlyArray<string>): ReadonlyArray<ProjectRef> {
  const data = useContext(ZeropsDataContext);
  const organizationId = useZeropsSessionOptional()?.activeOrganization?.id;
  const key = projectIds.join(",");
  return useMemo(
    () =>
      data === null || organizationId === undefined || key === ""
        ? []
        : key.split(",").map((id) => data.projectRef(organizationId, id)),
    [data, organizationId, key],
  );
}

/**
 * A chip's stops' deployments, demanded while the chip is drawn — without reading their public
 * access, which only an open stop menu reads (navigation starts no detail read).
 */
export function useStopDeploymentDemand(projectIds: ReadonlyArray<string>): void {
  useStopDeployments(useStopRefs(projectIds));
}

export function useStopPublicAccess(projectId: string | undefined): {
  /** The stop is read: a surface shows its own addresses, not the ones it was handed. */
  readonly bound: boolean;
  readonly shown: PublicAccessView | undefined;
  readonly access: PublicAccessView;
  /** Reads it again after a failure; a denial asks for the viewer's access anew first. */
  readonly again: () => void;
} {
  const account = useAccountDataOptional();
  const demandDetail = account?.demandDetail;
  const orgId = account?.orgId ?? null;
  const refs = useStopRefs(projectId === undefined ? [] : [projectId]);
  useStopDeployments(refs);
  const [ref] = refs;
  useEffect(() => {
    if (demandDetail === undefined || projectId === undefined) return;
    return demandDetail({ family: "publicRouting", ownerId: projectId });
  }, [demandDetail, projectId]);
  const bound = projectId !== undefined && orgId !== null;
  const access = useProjection(publicAccess, bound ? { orgId, projectId } : null, NOT_READ);
  return {
    bound,
    shown: bound ? access : undefined,
    access,
    again: () => {
      if (projectId === undefined || account === null) return;
      if (access.denied) {
        invalidateZerops({ topic: "access", change: "renew-now" });
        if (ref !== undefined) againStopDeployment(ref);
      }
      account.retryDetail({ family: "publicRouting", ownerId: projectId });
    },
  };
}

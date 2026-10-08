import {
  mateRecovery,
  ownRowWanted,
  usageOwnerOf,
  type MateRecovery,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useAccountOrgId, useDetailDemand, useProjection } from "./ZeropsAccountData";
import { useZeropsSessionOptional } from "./sessionContext";

const NONE = Atom.make<MateRecovery>({
  standing: { kind: "unknown" },
  status: undefined,
  process: undefined,
});

export function useMateRecovery(
  projectId: string | null,
  serviceId: string | undefined,
  observeHistory = true,
): MateRecovery {
  const orgId = useAccountOrgId();
  const recovery = useProjection(
    mateRecovery,
    orgId === null || projectId === null ? null : { orgId, projectId, serviceId },
    NONE,
  );
  const viewerRole = useZeropsSessionOptional()?.activeOrganization?.roleCode;
  useDetailDemand(
    "usage",
    undefined,
    orgId === null || projectId === null ? null : usageOwnerOf(orgId, projectId),
  );
  // Unknown identity needs an owner verdict even before a roster baseline or beyond its page cap.
  // Known rows use the same listing-grant policy as the menu, through one demand.
  useDetailDemand(
    "project",
    "project",
    orgId !== null &&
      (recovery.standing.kind === "unknown" ||
        ownRowWanted(
          viewerRole,
          recovery.standing.kind === "listed" ? recovery.standing.project : null,
        ))
      ? projectId
      : null,
  );
  useDetailDemand("process", "history", observeHistory ? projectId : null);
  return recovery;
}

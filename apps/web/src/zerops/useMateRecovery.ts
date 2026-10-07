import { mateRecovery, usageOwnerOf, type MateRecovery } from "@t3tools/client-runtime/data";
import { Atom } from "effect/unstable/reactivity";
import { useAccountOrgId, useDetailDemand, useProjection } from "./ZeropsAccountData";

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
  useDetailDemand(
    "usage",
    undefined,
    orgId === null || projectId === null ? null : usageOwnerOf(orgId, projectId),
  );
  useDetailDemand("project", "project", projectId);
  useDetailDemand("process", "history", observeHistory ? projectId : null);
  return useProjection(
    mateRecovery,
    orgId === null || projectId === null ? null : { orgId, projectId, serviceId },
    NONE,
  );
}

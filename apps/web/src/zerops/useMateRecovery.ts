import { mateRecovery, usageOwnerOf, type MateRecovery } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useAccountOrgId, useDetailDemand, useProjection } from "./ZeropsAccountData";

const NONE = Atom.make<MateRecovery>({
  standing: { kind: "unknown" },
  status: undefined,
  process: undefined,
});

export function useMateRecovery(
  projectId: string | null,
  serviceId: string | undefined,
): MateRecovery {
  const orgId = useAccountOrgId();
  const recovery = useProjection(
    mateRecovery,
    orgId === null || projectId === null ? null : { orgId, projectId, serviceId },
    NONE,
  );
  useDetailDemand(
    "usage",
    undefined,
    orgId === null || projectId === null ? null : usageOwnerOf(orgId, projectId),
  );
  // A route opened before the roster knows its project, or beyond its page cap, needs the owner's
  // verdict by its id; a placed Mate's own row the account holds (`data/placedRows.ts`).
  useDetailDemand(
    "project",
    "project",
    orgId !== null && recovery.standing.kind === "unknown" ? projectId : null,
  );
  useDetailDemand("process", "history", projectId);
  return recovery;
}

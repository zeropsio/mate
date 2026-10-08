import {
  mateRecovery,
  shownProjectsAtom,
  usageOwnerOf,
  type MateRecovery,
} from "@t3tools/client-runtime/data";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useAccountOrgId, useDetailDemand, useProjection } from "./ZeropsAccountData";
import { useVisibleProjectAccess } from "./useVisibleProjectAccess";

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
  const roster = useAtomValue(shownProjectsAtom);
  useDetailDemand(
    "usage",
    undefined,
    orgId === null || projectId === null ? null : usageOwnerOf(orgId, projectId),
  );
  useVisibleProjectAccess(projectId === null ? [] : [projectId]);
  // A cold URL missing from a complete roster needs an owner verdict; absence alone proves nothing.
  useDetailDemand(
    "project",
    "project",
    recovery.standing.kind === "unknown" &&
      roster.complete &&
      !roster.projects.some((project) => project.id === projectId)
      ? projectId
      : null,
  );
  useDetailDemand("process", "history", observeHistory ? projectId : null);
  return recovery;
}

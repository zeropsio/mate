import { Atom } from "effect/unstable/reactivity";
import { lifecycleRemainders, NO_LIFECYCLE_REMAINDERS } from "@t3tools/client-runtime/data";
import { useProjection } from "./ZeropsAccountData";
import { officialHq, useAccountHq } from "./accountHq";
import { useZeropsSession } from "./ZeropsSessionProvider";

const EMPTY = Atom.make(NO_LIFECYCLE_REMAINDERS);
export function useLifecycleRemainders() {
  const { activeOrganization } = useZeropsSession();
  const hq = useAccountHq(activeOrganization?.id);
  return useProjection(
    lifecycleRemainders,
    activeOrganization === null || hq.hq.kind !== "official"
      ? null
      : { orgId: activeOrganization.id, hqProjectId: officialHq(hq).projectId },
    EMPTY,
  );
}

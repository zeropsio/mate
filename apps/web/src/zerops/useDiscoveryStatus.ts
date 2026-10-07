/** Read listing coverage rather than whether discovery stopped trying. */
import { discoveryStatus, type DiscoveryStatus } from "@t3tools/client-runtime/data";
import { Atom } from "effect/unstable/reactivity";
import { useAccountHq } from "./accountHq";
import { useAccountOrgId, useProjection } from "./ZeropsAccountData";
const INCOMPLETE = Atom.make<DiscoveryStatus>("incomplete");
export function useDiscoveryStatus(): DiscoveryStatus {
  const orgId = useAccountOrgId();
  const hq = useAccountHq(orgId ?? undefined);
  return useProjection(
    discoveryStatus,
    orgId === null
      ? null
      : {
          orgId,
          hqAbsent: hq.status === "ready" && hq.hq.kind === "none",
        },
    INCOMPLETE,
  );
}

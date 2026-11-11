/** Read listing coverage rather than whether discovery stopped trying. */
import { discoveryStatus, type DiscoveryStatus } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useAccountOrgId, useProjection } from "./ZeropsAccountData";
const INCOMPLETE = Atom.make<DiscoveryStatus>("incomplete");
export function useDiscoveryStatus(): DiscoveryStatus {
  const orgId = useAccountOrgId();
  return useProjection(discoveryStatus, orgId, INCOMPLETE);
}

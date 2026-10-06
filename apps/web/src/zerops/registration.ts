/** A Mate's registration as its retained operation says it, including after its press ends. */
import { mateRegistration, type MateRegistration } from "@t3tools/client-runtime/data";
import { Atom } from "effect/unstable/reactivity";
import { useAccountOrgId, useProjection } from "./ZeropsAccountData";

const NOT_SENT = Atom.make<MateRegistration>({ attempt: 0, state: "waiting" });
export function useMateRegistration(projectId: string): MateRegistration {
  const orgId = useAccountOrgId();
  return useProjection(mateRegistration, orgId === null ? null : { orgId, projectId }, NOT_SENT);
}

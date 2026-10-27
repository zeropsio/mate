import { Atom } from "effect/reactivity";
import { lifecycleRemainders, NO_LIFECYCLE_REMAINDERS } from "@t3tools/client-runtime/data";
import { useProjection } from "./ZeropsAccountData";
import { configuredHq } from "./accountHq";
import { useZeropsSession } from "./ZeropsSessionProvider";

const EMPTY = Atom.make(NO_LIFECYCLE_REMAINDERS);
export function useLifecycleRemainders() {
  const { activeOrganization } = useZeropsSession();
  return useProjection(
    lifecycleRemainders,
    activeOrganization === null
      ? null
      : { orgId: activeOrganization.id, hqProjectId: configuredHq().projectId },
    EMPTY,
  );
}

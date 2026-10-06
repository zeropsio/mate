/**
 * Environments whose final setup is missing, through the account's projection. The finish action
 * runs through the account's creation operations.
 */
import { environmentSetup } from "@t3tools/client-runtime/data";
import type { HalfMadeGroupEnvironment } from "@t3tools/client-runtime/zerops";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { useAccountOperations } from "./accountOperations";
import { useAccountHq } from "./accountHq";
import { useFinishGroupEnvironment } from "./useFinishGroupEnvironment";
import { useAccountOrgId, useProjection } from "./ZeropsAccountData";
import { useZeropsSession } from "./ZeropsSessionProvider";

const NONE = Atom.make<ReadonlyArray<HalfMadeGroupEnvironment & { readonly finish: boolean }>>([]);

export function useEnvironmentSetup(projectIds: ReadonlyArray<string>) {
  const orgId = useAccountOrgId();
  const halfMade = useProjection(
    environmentSetup,
    useMemo(() => (orgId === null ? null : { orgId, projectIds }), [orgId, projectIds]),
    NONE,
  );
  const { activeOrganization } = useZeropsSession();
  const operations = useAccountOperations();
  const { hq } = useAccountHq(activeOrganization?.id);
  const finishing = useFinishGroupEnvironment({
    operations,
    clientId: activeOrganization?.id,
    hq: hq.kind === "official" ? hq : undefined,
  });
  return { halfMade, finishing };
}

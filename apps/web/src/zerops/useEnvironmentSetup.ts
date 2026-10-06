/**
 * Environments whose final setup is missing, through the account's projection. The finish action
 * remains with the creation operations until that family lands.
 */
import { environmentSetup } from "@t3tools/client-runtime/data";
import type { HalfMadeGroupEnvironment } from "@t3tools/client-runtime/zerops";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

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
  const { activeOrganization, client } = useZeropsSession();
  const { hq } = useAccountHq(activeOrganization?.id);
  const finishing = useFinishGroupEnvironment({
    client,
    clientId: activeOrganization?.id,
    hq: hq.kind === "official" ? hq : undefined,
  });
  return { halfMade, finishing };
}

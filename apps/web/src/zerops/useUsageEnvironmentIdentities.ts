/**
 * Who each usage environment belongs to (`usageEnvironmentIdentities.ts`),
 * off the same candidate listing, registered environments and org members the
 * left menu reads. Empty while nobody is signed in to Zerops.
 */
import { useAtomValue } from "@effect/atom-react";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";

import { zeropsEnvironmentsAtom } from "../state/zerops";
import { registeredZeropsOrigins } from "./environmentOrigins";
import {
  usageEnvironmentIdentities,
  type UsageEnvironmentIdentities,
} from "./usageEnvironmentIdentities";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { useZeropsOrganizationMembers } from "./useZeropsMateOwners";
import { useZeropsSession } from "./ZeropsSessionProvider";

const NONE: UsageEnvironmentIdentities = new Map();

export function useUsageEnvironmentIdentities(): UsageEnvironmentIdentities {
  const session = useZeropsSession();
  const signedIn = session.status === "signed-in";
  const { listing } = useZeropsCandidates();
  const environments = useAtomValue(zeropsEnvironmentsAtom);
  const members = useZeropsOrganizationMembers({
    clientId: session.activeOrganization?.id,
    enabled: signedIn,
  });
  const viewerUserId = session.user?.id ?? null;
  return useMemo(
    () =>
      signedIn
        ? usageEnvironmentIdentities({
            candidates: heldCandidates(listing).rows,
            registeredOrigins: registeredZeropsOrigins(environments),
            members,
            viewerUserId,
          })
        : NONE,
    [signedIn, listing, environments, members, viewerUserId],
  );
}

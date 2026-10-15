import { Atom } from "effect/reactivity";
import { platformCapabilities, projectRoleOffers, roleOffers } from "@t3tools/client-runtime/data";
import { useMemo } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useAccountDataOptional, useProjection } from "./accountData";
import { useEnvironmentProjectRef } from "./useZeropsFeeds";
const UNKNOWN = Atom.make({
  membershipKnown: false,
  createProject: false,
  setUpChief: false,
  reachesEveryProject: false,
  manageOrganization: false,
  projectAccessKnown: false,
  read: false,
  operate: false,
  administer: false,
});
/** All native project controls read the same verdict as operation admission. */
export function usePlatformCapabilities(environmentId: EnvironmentId | null) {
  const account = useAccountDataOptional();
  const project = useEnvironmentProjectRef(environmentId);
  return useProjection(
    platformCapabilities,
    project === null
      ? account?.orgId == null
        ? null
        : { orgId: account.orgId, viewer: account.viewer }
      : {
          orgId: project.organization.organizationId,
          projectId: project.projectId,
          viewer: account?.viewer,
        },
    UNKNOWN,
  );
}

/**
 * What the organization's surfaces offer by the viewer's role (`roleOffers`): New project and a
 * Chief of their own, each hidden once the role is known to forbid it.
 */
export function useRoleOffers() {
  const capabilities = usePlatformCapabilities(null);
  return useMemo(() => roleOffers(capabilities), [capabilities]);
}

/**
 * What a Zerops project's own surfaces offer by the viewer's role there (`projectRoleOffers`): its
 * addresses to manage only where the role operates it.
 */
export function useProjectRoleOffers(projectId: string | undefined) {
  const account = useAccountDataOptional();
  const capabilities = useProjection(
    platformCapabilities,
    account?.orgId == null || projectId === undefined
      ? null
      : { orgId: account.orgId, projectId, viewer: account.viewer },
    UNKNOWN,
  );
  return useMemo(() => projectRoleOffers(capabilities), [capabilities]);
}

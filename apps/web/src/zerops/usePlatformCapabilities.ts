import { Atom } from "effect/reactivity";
import {
  creditOffers,
  platformCapabilities,
  platformViewer,
  projectRoleOffers,
  roleOffers,
  teamOffers,
} from "@t3tools/client-runtime/data";
import { useMemo } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useAccountDataOptional, useProjection } from "./accountData";
import { useEnvironmentProjectRef } from "./useZeropsFeeds";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";
const UNKNOWN = Atom.make({
  membershipKnown: false,
  createProject: false,
  setUpChief: false,
  reachesEveryProject: false,
  manageOrganization: false,
  editFinances: false,
  projectAccessKnown: false,
  read: false,
  operate: false,
  administer: false,
});
/**
 * The viewer's membership in `orgId`: as read, else as the signed-in session last knew it
 * (`platformViewer`), so a reload paints the person's own role and takes nothing back.
 */
function useViewerOf(orgId: string | null | undefined) {
  const account = useAccountDataOptional();
  const lastKnown = useZeropsSessionOptional()?.activeOrganization;
  return orgId == null ? undefined : platformViewer({ orgId, read: account?.viewer, lastKnown });
}

/** All native project controls read the same verdict as operation admission. */
export function usePlatformCapabilities(environmentId: EnvironmentId | null) {
  const account = useAccountDataOptional();
  const project = useEnvironmentProjectRef(environmentId);
  const orgId = project === null ? account?.orgId : project.organization.organizationId;
  const viewer = useViewerOf(orgId);
  return useProjection(
    platformCapabilities,
    project === null
      ? orgId == null
        ? null
        : { orgId, viewer }
      : { orgId: project.organization.organizationId, projectId: project.projectId, viewer },
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

/** Whether the viewer brings people into the organization (`teamOffers`): Invite. */
export function useTeamOffers() {
  const capabilities = usePlatformCapabilities(null);
  return useMemo(() => teamOffers(capabilities), [capabilities]);
}

/** Whether the organization's credit is the viewer's to add in HQ (`creditOffers`). */
export function useCreditOffers() {
  const capabilities = usePlatformCapabilities(null);
  return useMemo(() => creditOffers(capabilities), [capabilities]);
}

/**
 * The native permission verdict for a project, including before HQ admits its Mate.
 */
export function useProjectCapabilities(projectId: string | undefined) {
  const account = useAccountDataOptional();
  const viewer = useViewerOf(account?.orgId);
  return useProjection(
    platformCapabilities,
    account?.orgId == null || projectId === undefined
      ? null
      : { orgId: account.orgId, projectId, viewer },
    UNKNOWN,
  );
}

export function useProjectRoleOffers(projectId: string | undefined) {
  const capabilities = useProjectCapabilities(projectId);
  return useMemo(() => projectRoleOffers(capabilities), [capabilities]);
}

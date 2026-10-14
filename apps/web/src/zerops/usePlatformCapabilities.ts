import { Atom } from "effect/reactivity";
import { platformCapabilities } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { useAccountDataOptional, useProjection } from "./accountData";
import { useEnvironmentProjectRef } from "./useZeropsFeeds";
const UNKNOWN = Atom.make({
  createProject: false,
  manageOrganization: false,
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

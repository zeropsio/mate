/** Conversation permission is read from admission; signers never establish client permission. */
import { agentAdmission } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { usePlatformCapabilities } from "./usePlatformCapabilities";
import { useHqProjectPerson, zeropsMateOwnerOf } from "./useZeropsMateOwners";
import { useEnvironmentProjectRef } from "./useZeropsFeeds";
import { useZeropsAgentAuth } from "./useZeropsFeeds";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

export function useMateReadOnly(
  environmentId: EnvironmentId | null,
  instanceId: string | undefined,
): boolean {
  const read = useZeropsAgentAuth(environmentId);
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  const project = useEnvironmentProjectRef(environmentId);
  const people = useHqProjectPerson(project?.projectId ?? "");
  const owner = zeropsMateOwnerOf(people?.owner, viewerSubject);
  const capabilities = usePlatformCapabilities(environmentId);
  return agentAdmission({
    operate: project === null ? undefined : capabilities.operate,
    environmentId: environmentId ?? "",
    instanceId,
    viewerSubject,
    read,
    providers: [],
    mateName: "This Mate",
    owner:
      people?.owned === false ? null : owner === undefined ? undefined : { mine: owner.isViewer },
  }).readOnly;
}

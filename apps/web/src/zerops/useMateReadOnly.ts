/** Conversation permission is read from admission; signers never establish client permission. */
import { readsAlong } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { usePlatformCapabilities } from "./usePlatformCapabilities";
import { useHqProjectPerson, zeropsMateOwnerOf } from "./useZeropsMateOwners";
import { useEnvironmentProjectRef } from "./useZeropsFeeds";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

export function useMateReadOnly(environmentId: EnvironmentId | null): boolean {
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  const project = useEnvironmentProjectRef(environmentId);
  const people = useHqProjectPerson(project?.projectId ?? "");
  const owner = zeropsMateOwnerOf(people?.owner, viewerSubject);
  const capabilities = usePlatformCapabilities(environmentId);
  return readsAlong({
    operate: project === null ? undefined : capabilities.operate,
    owner:
      people?.owned === false ? null : owner === undefined ? undefined : { mine: owner.isViewer },
  });
}

/**
 * Whether the viewer may update this Mate: unless they only read along in it, or as an admin of
 * its project, as its server rules too.
 */
export function useMayUpdateMate(environmentId: EnvironmentId): boolean {
  const readOnly = useMateReadOnly(environmentId);
  const { administer } = usePlatformCapabilities(environmentId);
  return !readOnly || administer;
}

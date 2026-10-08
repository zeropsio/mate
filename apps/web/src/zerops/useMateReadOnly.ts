/** Conversation permission is read from admission; signers never establish client permission. */
import { agentAdmission } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { useZeropsAgentAuth } from "./useZeropsFeeds";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

export function useMateReadOnly(
  environmentId: EnvironmentId | null,
  instanceId: string | undefined,
): boolean {
  const read = useZeropsAgentAuth(environmentId);
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  return agentAdmission({
    environmentId: environmentId ?? "",
    instanceId,
    viewerSubject,
    read,
    providers: [],
    mateName: "This Mate",
  }).readOnly;
}

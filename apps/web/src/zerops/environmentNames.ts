/**
 * The Zerops project's name per mate environment, read off the candidate
 * list — what a picker calls an environment when the workspace folder
 * ("www", the same in every container) says nothing. Pure: the candidate
 * list is the one source, and `useZeropsCandidates` publishes the result.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";

export function zeropsEnvironmentNames(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ReadonlyMap<EnvironmentId, string> {
  const names = new Map<EnvironmentId, string>();
  for (const candidate of candidates) {
    const environmentId = candidate.environmentId;
    if (environmentId === undefined || names.has(environmentId)) continue;
    const name = candidate.project.name.trim();
    if (name.length > 0) names.set(environmentId, name);
  }
  return names;
}

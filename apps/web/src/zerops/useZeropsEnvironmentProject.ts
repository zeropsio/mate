import type { EnvironmentId } from "@t3tools/contracts";

import { useMateOfEnvironment } from "./accountEnvironments";

/** A Mate's project, with the organization that lists it. */
export interface EnvironmentProject {
  readonly projectId: string;
  readonly orgId: string;
}

/**
 * Which Zerops project a connected environment is, from the Mate this tab read serving it.
 * `undefined` until it is known — a write that guessed the project would land on somebody else's.
 */
export function useZeropsEnvironmentProject(
  environmentId: EnvironmentId | null,
): EnvironmentProject | undefined {
  const mate = useMateOfEnvironment(environmentId);
  return mate === undefined || mate.orgId === null
    ? undefined
    : { projectId: mate.projectId, orgId: mate.orgId };
}

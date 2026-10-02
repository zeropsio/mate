import type { RecordProjectRef } from "@t3tools/client-runtime/zerops/environments";
import type { EnvironmentId } from "@t3tools/contracts";

import { useRegistrationRecord } from "./registrationRecords";

/**
 * Which Zerops project a connected environment is, from its registration record. `undefined`
 * until it is known — a write that guessed the project would land on somebody else's.
 */
export function useZeropsEnvironmentProject(
  environmentId: EnvironmentId | null,
): RecordProjectRef | undefined {
  return useRegistrationRecord(environmentId)?.projectRef ?? undefined;
}

/**
 * A Mate coming up (`/mate/$projectId`) is the one on screen, though its path names no
 * environment: once its environment is known, its socket goes first (`connection/admission.ts`),
 * and the page leaving lets go. A conversation's route names its own through the account stage.
 */
import { connectionAdmission, type ConnectionAdmission } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";

export function usePreferredConnection(
  environmentId: EnvironmentId | null,
  admission: Pick<ConnectionAdmission, "hold"> = connectionAdmission,
): void {
  // Its own claim: leaving releases only it, never the route a conversation named meanwhile.
  useEffect(
    () => (environmentId === null ? undefined : admission.hold(environmentId)),
    [admission, environmentId],
  );
}

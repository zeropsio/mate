/**
 * What an environment setup's card on the projects page offers to start again: the stage or the
 * production this page asked for, once HQ's `environment` operation of it ended failed. A failed
 * deploy key, or an operation another device or person started, offers none here.
 */
import type { ZeropsEnvironmentRole } from "@t3tools/client-runtime/zerops";

export interface CreationAsked {
  readonly tier: "stage" | "production";
  /** The operation HQ took it as; absent until HQ answered its start. */
  readonly operationId?: string;
  /** Its operation ended failed. */
  readonly ended?: true;
}

export function creationStartAgain(
  creation: CreationAsked | null,
  operation: { readonly id: string; readonly kind: string },
): Extract<ZeropsEnvironmentRole, "stage" | "prod"> | undefined {
  if (creation === null || creation.ended !== true || creation.operationId !== operation.id)
    return undefined;
  if (operation.kind !== "environment") return undefined;
  return creation.tier === "stage" ? "stage" : "prod";
}

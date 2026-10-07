import type { OrganizationRef } from "@t3tools/client-runtime/zerops/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { invalidateZerops } from "~/zerops/accountInvalidations";

/**
 * Takes a project the platform failed to create off the account. The delete
 * comes first; only once the platform has accepted it is the project's birth
 * forgotten (nothing will ever connect to this project) and the list re-read.
 * A refused delete leaves both as they were, so the row keeps offering the
 * verb and says why it did not work.
 */
export async function removeFailedZeropsProject(input: {
  readonly projectId: string;
  /** The organization the project was in, whose inventory is read again. */
  readonly organization: OrganizationRef;
  readonly deleteProject: (projectId: string) => Promise<unknown>;
  readonly forgetCreation: (projectId: string) => void;
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  try {
    await input.deleteProject(input.projectId);
  } catch (cause) {
    return { ok: false, error: zeropsErrorMessage(cause) };
  }
  input.forgetCreation(input.projectId);
  invalidateZerops({ topic: "inventory", organization: input.organization });
  return { ok: true };
}

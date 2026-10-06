/**
 * A Zerops write a surface asks for, as one of the account's operations: submitted in the open
 * organization, resolved once Zerops took it, rejected with what to tell the person. Nothing here
 * waits for the write's end; a surface that follows it reads the operation's progress.
 */
import type { OperationProgress } from "@t3tools/client-runtime/data";

import type { AccountOperations } from "./accountOperations";

type Intent = Parameters<AccountOperations["submit"]>[0];

/** An intent of the open organization: its `orgId` is the account's to add. */
export type ZeropsWrite = Intent extends infer Each
  ? Each extends { readonly orgId: string }
    ? Omit<Each, "orgId">
    : never
  : never;

/** The client's own text for a write whose answer was lost: the same words, whoever lost it. */
const MAY_HAVE_LANDED =
  "Zerops may have accepted this operation, but its response was lost. Check the project and its services before starting another operation.";

/** What already landed of a write of several steps whose next one is the person's. */
const LANDED: Partial<Record<ZeropsWrite["kind"], string>> = {
  "enable-zerops-mate": "Zerops Mate is turned on, but its container was not restarted. ",
};

/** What the person is told of a write Zerops did not take, or ended failed; `null` otherwise. */
export function writeTrouble(
  progress: OperationProgress,
  evidence: string | null,
  /** What landed before the step the person must take next, where it is said. */
  landed = "",
): string | null {
  switch (progress.stage) {
    case "refused":
      return progress.reason;
    case "unsent":
      return progress.reason ?? "Zerops did not take the change. Try again.";
    case "uncertain":
      return MAY_HAVE_LANDED;
    case "unresolved":
      return `${landed}${progress.nextAction ?? "Check it in Zerops"}.`;
    case "done":
      return progress.outcome === "succeeded"
        ? null
        : (progress.reason ?? evidence ?? "Zerops could not do it.");
    default:
      return null;
  }
}

export async function submitZeropsWrite(
  operations: AccountOperations,
  orgId: string | null,
  write: ZeropsWrite,
): Promise<{ readonly requestId: string; readonly progress: OperationProgress }> {
  if (orgId === null) throw new Error("No organization is open.");
  const { requestId, progress, evidence } = await operations.submit({
    ...write,
    orgId,
  } as Intent);
  const trouble = writeTrouble(progress, evidence, LANDED[write.kind]);
  if (trouble !== null) throw new Error(trouble);
  return { requestId, progress };
}

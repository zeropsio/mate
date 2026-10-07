/** A dialog waits for HQ's answer to one application verb, preserving its refusal. */
import type { AccountOperations } from "./accountOperations";

type AppWrite = Extract<
  Parameters<AccountOperations["submit"]>[0],
  { readonly kind: "rename-app" | "delete-app" }
>;

export async function submitHqAppWrite(
  operations: AccountOperations,
  intent: AppWrite,
): Promise<void> {
  const { progress, evidence } = await operations.submit(intent);
  switch (progress.stage) {
    case "refused":
      throw new Error(progress.reason);
    case "unsent":
      throw new Error(progress.reason ?? "HQ is not answering right now.");
    case "uncertain":
      throw new Error(
        "HQ may have accepted this change, but its answer was lost. Check the project before trying again.",
      );
    case "unresolved":
      throw new Error(progress.reason ?? progress.nextAction ?? "Check the project in HQ.");
    case "done":
      if (progress.outcome !== "succeeded")
        throw new Error(progress.reason ?? evidence ?? "HQ could not do it.");
      return;
    default:
      throw new Error("HQ has not answered the write yet.");
  }
}

/** A dialog waits for HQ's answer to one application verb, preserving its refusal. */
import { KEPT_GIT_UNCONFIRMED } from "@t3tools/client-runtime/data";
import type { AccountOperations } from "./accountOperations";

type AppWrite = Extract<
  Parameters<AccountOperations["submit"]>[0],
  { readonly kind: "answer-kept-git" }
>;

export async function submitHqAppWrite(
  operations: AccountOperations,
  intent: AppWrite,
  requestId?: string,
): Promise<void> {
  const { progress, evidence } = await operations.submit(intent, requestId);
  switch (progress.stage) {
    case "refused":
      throw new Error(progress.reason);
    case "unsent":
      throw new Error(progress.reason ?? "HQ is not answering right now.");
    case "uncertain":
      throw new Error(KEPT_GIT_UNCONFIRMED);
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

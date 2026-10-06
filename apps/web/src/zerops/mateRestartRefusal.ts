/** What the person is told of a Mate's restart Zerops did not take, wherever it was asked. */
import type { OperationProgress } from "@t3tools/client-runtime/data";

/** What the person is told of a restart its owner did not take; `null` once Zerops took it. */
export function restartRefusal(progress: OperationProgress): string | null {
  switch (progress.stage) {
    case "refused":
      return progress.reason;
    case "unsent":
      return progress.reason ?? "Zerops did not take the restart. Try again.";
    case "uncertain":
      return "Zerops did not answer whether it took the restart. Check the Mate before trying again.";
    case "unresolved":
      return `The Mate was stopped, but it was not started again here. ${progress.nextAction ?? "Start the Mate"}.`;
    default:
      return null;
  }
}

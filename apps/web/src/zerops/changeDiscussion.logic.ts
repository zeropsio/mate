/**
 * What the person is told of a comment HQ did not take, as the comment box says it under itself;
 * `null` once HQ took it — the words are then on the change.
 */
import type { OperationProgress } from "@t3tools/client-runtime/data";

export function commentRefusal(progress: OperationProgress): string | null {
  switch (progress.stage) {
    case "refused":
      return progress.reason;
    case "unsent":
      return progress.reason ?? "HQ did not take the comment. Try again.";
    case "uncertain":
      return "HQ did not answer whether it took the comment. It shows here once HQ has it.";
    default:
      return null;
  }
}

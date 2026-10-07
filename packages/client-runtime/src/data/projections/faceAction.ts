import type { Projection } from "../store.ts";
import { operationProgress } from "./operation.ts";
import { sameValue } from "./equal.ts";

export interface FaceAction {
  readonly pending: boolean;
  readonly error: string | null;
}
export const NO_FACE_ACTION: FaceAction = { pending: false, error: null };
export const faceAction: Projection<string, FaceAction> = {
  name: "faceAction",
  keyOf: (id) => id,
  equals: sameValue,
  derive: (read, id) => {
    const progress = operationProgress.derive(read, id);
    switch (progress.stage) {
      case "submitting":
      case "accepted":
      case "reflected":
        return { pending: true, error: null };
      case "refused":
        return { pending: false, error: progress.reason };
      case "uncertain":
        return {
          pending: false,
          error: "HQ may have saved the face. Ask HQ again before changing it.",
        };
      case "unresolved":
        return {
          pending: false,
          error: progress.nextAction ?? progress.reason ?? "Ask HQ to confirm this face.",
        };
      case "unsent":
        return {
          pending: false,
          error: progress.reason ?? "HQ did not receive this face. Try again.",
        };
      case "done":
        return {
          pending: false,
          error:
            progress.outcome === "failed"
              ? (progress.reason ?? "HQ could not save this face.")
              : null,
        };
      default:
        return NO_FACE_ACTION;
    }
  },
};

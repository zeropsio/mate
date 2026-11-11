import { ZeropsApiError } from "../../zerops/api.ts";
import { OperationStopped, type RunToEnd } from "./runToEnd.ts";

/** An answered HQ claim is the only authority to send a birth's non-idempotent write. */
export function birthAttempt(
  run: RunToEnd,
  orgId: string,
  birthId: string,
  isCurrent: () => boolean,
): <T>(step: "create" | "import", send: () => Promise<T>) => Promise<T> {
  const hq = { orgId, unobserved: "HQ did not confirm the birth attempt." };
  return async (step, send) => {
    const { claim } = await run({ kind: "claim-birth-attempt", orgId, birthId, step }, hq);
    if (!isCurrent())
      throw new ZeropsApiError("The account session ended after the claim.", "uncertain");
    try {
      return await send();
    } catch (cause) {
      if (
        cause instanceof OperationStopped &&
        (cause.synchronousRefusal || cause.writeNotSent) &&
        isCurrent()
      ) {
        try {
          await run(
            {
              kind: "end-birth-attempt",
              orgId,
              birthId,
              step,
              outcome: cause.writeNotSent ? "unsent" : "refused",
              at: claim.at,
              reason: cause.message,
            },
            hq,
          );
        } catch {
          throw new ZeropsApiError("HQ did not confirm the attempt's outcome.", "uncertain");
        }
      }
      throw cause;
    }
  };
}

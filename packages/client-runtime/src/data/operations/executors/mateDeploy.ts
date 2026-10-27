/** The account's Zerops adapter restores a missing deployment without reaching an absent Mate. */
import * as Effect from "effect/Effect";
import type { IntentOf } from "../kind.ts";
import { processReceipt } from "./serviceWrites.ts";
import { verb } from "./write.ts";

export function mateDeployExecutor(platform: {
  readonly deployMate: (serviceId: string) => Promise<{ readonly processId: string }>;
}) {
  return (requestId: string, intent: IntentOf<"mate-deploy">) =>
    Effect.map(
      verb(() => platform.deployMate(intent.serviceId)),
      ({ processId }) =>
        processReceipt(requestId, { family: "service", id: intent.serviceId }, processId),
    );
}

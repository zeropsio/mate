/** One explicit draft-open request through the Mate connection. */
import {
  WS_METHODS,
  type EnvironmentId,
  type ZeropsDraftCopy,
  type ZeropsDraftPreview,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { request } from "../../rpc/client.ts";

export function makeDraftPreviewWire(registry: EnvironmentRegistry["Service"]) {
  return (environmentId: EnvironmentId, copy: ZeropsDraftCopy): Promise<ZeropsDraftPreview> =>
    openDraft(registry, environmentId, copy);
}

async function openDraft(
  registry: EnvironmentRegistry["Service"],
  environmentId: EnvironmentId,
  copy: ZeropsDraftCopy,
): Promise<ZeropsDraftPreview> {
  const result = await Effect.runPromise(
    Effect.result(
      registry.run(environmentId, request(WS_METHODS.zeropsDraftPreview, copy)).pipe(
        Effect.catchCause((cause) => {
          const error = Cause.squash(cause);
          const message = error instanceof Error ? error.message : String(error);
          return Effect.fail(
            message.includes("Unknown request tag")
              ? "This Mate does not support opening drafts yet."
              : message.includes("not connected") || message.includes("not registered")
                ? "The Mate's socket is not connected."
                : "The draft could not be opened.",
          );
        }),
      ),
    ),
  );
  if (Result.isFailure(result)) throw new Error(result.failure);
  return result.success;
}

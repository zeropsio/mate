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

type Pending = { readonly copy: ZeropsDraftCopy; readonly answer: ZeropsDraftPreview };
const pendingByRegistry = new WeakMap<
  EnvironmentRegistry["Service"],
  Map<string, Promise<Pending>>
>();

export function makeDraftPreviewWire(registry: EnvironmentRegistry["Service"]) {
  return (
    environmentId: EnvironmentId,
    paneId: string,
    copy: ZeropsDraftCopy,
  ): Promise<Pending> => {
    let pending = pendingByRegistry.get(registry);
    if (pending === undefined) {
      pending = new Map();
      pendingByRegistry.set(registry, pending);
    }
    const key = `${environmentId}:${paneId}`;
    const current = pending.get(key);
    if (current !== undefined) return current;
    const calls = pending;
    const call = openDraft(registry, environmentId, copy).finally(() => calls.delete(key));
    calls.set(key, call);
    return call;
  };
}

async function openDraft(
  registry: EnvironmentRegistry["Service"],
  environmentId: EnvironmentId,
  copy: ZeropsDraftCopy,
): Promise<Pending> {
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
  return { copy, answer: result.success };
}

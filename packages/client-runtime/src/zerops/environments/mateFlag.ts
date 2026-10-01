/**
 * `ZCP_MATE_ENABLED` for a Mate's service: the Mate flag port of the container store and the
 * birth worker, on web and mobile alike. The organization's variables, streamed, answer it; a flag
 * they say is off is confirmed by the service's own lag-free read once, since a service the stream
 * has not caught up with yet reads as off too, and off is a fact a row offers Enable on (H9). A
 * read that did not succeed is `"unknown"`, never `false`.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/unstable/reactivity";

import { settledValue } from "../data/resourceSelectors.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import { readMateFlagFromStore } from "../data/storeReads.ts";
import type { ServiceRef } from "../data/types.ts";
import type { MateFlag } from "./containerMachine.ts";

export async function readServiceMateFlag(
  data: ManagedZeropsDataRuntime,
  atoms: AtomRegistry.AtomRegistry,
  service: ServiceRef,
  services: Context.Context<never> = Context.empty(),
): Promise<MateFlag> {
  const stated = await readMateFlagFromStore(data, atoms, service, services).catch(
    (): MateFlag => "unknown",
  );
  if (stated !== false) return stated;
  return Effect.runPromiseWith(services)(
    Effect.scoped(
      data.resources
        .acquire({ kind: "service-mate-flag", account: data.resources.scope, service })
        .pipe(Effect.flatMap((lease) => lease.awaitSettled)),
    ),
  ).then(
    (shown): MateFlag => {
      const answer = settledValue(shown);
      return answer === null ? "unknown" : answer.value.enabled;
    },
    (): MateFlag => "unknown",
  );
}

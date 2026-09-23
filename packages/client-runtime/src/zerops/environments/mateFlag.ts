/**
 * `ZCP_MATE_ENABLED` for a Mate's service, read once through the account's resource broker: the
 * Mate flag port of the container store and the birth worker, on web and mobile alike. A read
 * that did not succeed — it failed, or the account's access withheld it — is `"unknown"`, never
 * `false`, which is a fact a row offers Enable on (H9). The account runtime reads it with the
 * account's services; a surface outside it, with none.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { settledValue } from "../data/resourceSelectors.ts";
import type { ZeropsResourceBroker } from "../data/resources.ts";
import type { ServiceRef } from "../data/types.ts";
import type { MateFlag } from "./containerMachine.ts";

export function readServiceMateFlag(
  resources: ZeropsResourceBroker,
  service: ServiceRef,
  services: Context.Context<never> = Context.empty(),
): Promise<MateFlag> {
  return Effect.runPromiseWith(services)(
    Effect.scoped(
      resources
        .acquire({ kind: "service-mate-flag", account: resources.scope, service })
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

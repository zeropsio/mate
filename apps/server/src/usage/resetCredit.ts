import { type ProviderConsumeResetCreditInput, ProviderSetupError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import type { UsageLimitSources } from "./UsageLimitSources.ts";

interface ConsumeResetCreditDeps {
  readonly usageLimitSources: UsageLimitSources["Service"];
  readonly providerInstances: ProviderInstanceRegistry["Service"];
}

export const consumeResetCredit =
  ({ usageLimitSources, providerInstances }: ConsumeResetCreditDeps) =>
  (input: ProviderConsumeResetCreditInput) =>
    Effect.gen(function* () {
      if ("sourceId" in input) return yield* usageLimitSources.consumeResetCredit(input);
      const instance = yield* providerInstances.getInstance(input.instanceId);
      // A disabled instance must not spend anything on its account.
      if (instance === undefined || !instance.enabled) {
        return yield* new ProviderSetupError({
          instanceId: input.instanceId,
          operation: "consume-reset-credit",
          detail: instance ? "This provider is disabled." : "Provider instance not found.",
        });
      }
      if (instance.consumeResetCredit === undefined) {
        return yield* new ProviderSetupError({
          instanceId: input.instanceId,
          operation: "consume-reset-credit",
          detail: "This provider does not bank reset credits.",
        });
      }
      const outcome = yield* instance.consumeResetCredit().pipe(
        Effect.mapError(
          (error) =>
            new ProviderSetupError({
              instanceId: input.instanceId,
              operation: "consume-reset-credit",
              detail: error.detail,
              cause: error,
            }),
        ),
      );
      return { outcome };
    });

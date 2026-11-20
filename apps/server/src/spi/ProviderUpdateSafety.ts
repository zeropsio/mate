import type { ProviderSession } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import type { UpdateIdleFacts } from "../update/MateUpdateDrain.ts";

export function providerUpdateBlockers(input: {
  readonly sessions: ReadonlyArray<ProviderSession>;
}): ReadonlyArray<string> {
  const blockers: string[] = [];
  for (const session of input.sessions)
    if (session.activeTurnId != null || !["ready", "closed"].includes(session.status))
      blockers.push(`provider:${session.threadId}`);
  return blockers;
}

/** Product code joins live provider process facts through this boundary. */
export class ProviderUpdateSafety extends Context.Service<
  ProviderUpdateSafety,
  {
    readonly facts: Effect.Effect<UpdateIdleFacts>;
    readonly subscribeChanges: Effect.Effect<
      { readonly changes: Stream.Stream<void> },
      never,
      Scope.Scope
    >;
  }
>()("t3/spi/ProviderUpdateSafety") {}

export const providerUpdateSafetyLayer = Layer.effect(
  ProviderUpdateSafety,
  Effect.gen(function* () {
    const provider = yield* ProviderService;
    const registry = yield* ProviderInstanceRegistry;
    return ProviderUpdateSafety.of({
      facts: Effect.gen(function* () {
        const blockers = providerUpdateBlockers({ sessions: yield* provider.listSessions() });
        return { idle: blockers.length === 0, blockers };
      }).pipe(
        Effect.catchCause(() =>
          Effect.succeed({ idle: false, blockers: ["provider state unreadable"] }),
        ),
      ),
      subscribeChanges: Effect.gen(function* () {
        const registrySubscription = yield* registry.subscribeChanges;
        const native = yield* (
          provider.eventBarrier?.subscribeChanges ?? Effect.succeed({ changes: Stream.empty })
        );
        return {
          changes: Stream.mergeAll(
            [
              Stream.fromSubscription(registrySubscription).pipe(
                Stream.as(void 0),
                Stream.prepend([void 0]),
              ),
              native.changes,
            ],
            { concurrency: "unbounded" },
          ),
        };
      }),
    });
  }),
);

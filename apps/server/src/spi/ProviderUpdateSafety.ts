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
  /** Threads whose open turn the engine leaves to the restart (`EngineIdleFacts`). */
  readonly leftToRestart: ReadonlySet<string>;
}): ReadonlyArray<string> {
  const blockers: string[] = [];
  for (const session of input.sessions) {
    if (input.leftToRestart.has(session.threadId)) continue;
    // A session that failed with no turn open holds no work, and a restart is what clears it.
    if (session.activeTurnId != null || !["ready", "closed", "error"].includes(session.status))
      blockers.push(`provider:${session.threadId}`);
  }
  return blockers;
}

/** Product code joins live provider process facts through this boundary. */
export class ProviderUpdateSafety extends Context.Service<
  ProviderUpdateSafety,
  {
    /** Live provider processes, but for the threads whose open turn the engine leaves to the restart. */
    readonly facts: (leftToRestart: ReadonlySet<string>) => Effect.Effect<UpdateIdleFacts>;
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
      facts: (leftToRestart) =>
        Effect.gen(function* () {
          const sessions = yield* provider.listSessions();
          const blockers = providerUpdateBlockers({ sessions, leftToRestart });
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

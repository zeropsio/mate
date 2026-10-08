import type { ProviderSession, ProviderInstallState } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { AntigravityInstallation } from "../provider/AntigravityInstallation.ts";
import type { UpdateIdleFacts } from "../update/MateUpdateDrain.ts";

export function providerUpdateBlockers(input: {
  readonly sessions: ReadonlyArray<ProviderSession>;
  readonly credentialChanges: ReadonlyArray<boolean | undefined>;
  readonly installPhase: ProviderInstallState["phase"];
}): ReadonlyArray<string> {
  const blockers: string[] = [];
  for (const session of input.sessions)
    if (session.activeTurnId != null || !["ready", "closed"].includes(session.status))
      blockers.push(`provider:${session.threadId}`);
  if (input.credentialChanges.some((changing) => changing !== false))
    blockers.push("provider authentication is active or unknown");
  if (["downloading", "extracting", "verifying"].includes(input.installPhase))
    blockers.push("provider installation");
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
    const installation = yield* AntigravityInstallation;
    const authChanges = Effect.gen(function* () {
      const instances = yield* registry.listInstances;
      const sources = yield* Effect.all(
        instances.flatMap((instance) =>
          instance.auth?.subscribeUpdateChanges === undefined
            ? []
            : [instance.auth.subscribeUpdateChanges],
        ),
      );
      return Stream.mergeAll([Stream.make(void 0), ...sources.map((source) => source.changes)], {
        concurrency: "unbounded",
      });
    });
    return ProviderUpdateSafety.of({
      facts: Effect.gen(function* () {
        const instances = yield* registry.listInstances;
        const credentialChanges = yield* Effect.all(
          instances.flatMap((instance) =>
            instance.auth === undefined
              ? []
              : [
                  instance.auth.subscribeUpdateChanges === undefined
                    ? Effect.succeed(undefined)
                    : (instance.auth.isChangingCredentials ?? Effect.succeed(undefined)),
                ],
          ),
        );
        const blockers = providerUpdateBlockers({
          sessions: yield* provider.listSessions(),
          credentialChanges,
          installPhase: (yield* installation.state).phase,
        });
        return { idle: blockers.length === 0, blockers };
      }).pipe(
        Effect.catchCause(() =>
          Effect.succeed({ idle: false, blockers: ["provider state unreadable"] }),
        ),
      ),
      subscribeChanges: Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const registrySubscription = yield* registry.subscribeChanges;
        const auth = yield* authChanges;
        const native = yield* (
          provider.eventBarrier?.subscribeChanges ?? Effect.succeed({ changes: Stream.empty })
        );
        return {
          changes: Stream.mergeAll(
            [
              Stream.fromSubscription(registrySubscription).pipe(
                Stream.mapEffect(() => authChanges.pipe(Scope.provide(scope))),
                Stream.prepend([auth]),
                Stream.switchMap((stream) => stream),
              ),
              installation.changes.pipe(Stream.map(() => void 0)),
              native.changes,
            ],
            { concurrency: "unbounded" },
          ),
        };
      }),
    });
  }),
);

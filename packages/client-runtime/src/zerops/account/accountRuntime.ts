/** The verified account's Mate adapter and presentation demand; platform facts belong to its store. */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { AtomRegistry } from "effect/reactivity";
import { makeMateAdapter } from "../../data/adapters/mate.ts";
import type { AccountStore } from "../../data/store.ts";
import type { AccountScope } from "../data/types.ts";
import {
  makeInvalidationBus,
  type InvalidationBus,
  type InvalidationSignal,
} from "../knowledge/invalidation.ts";
import type { PlatformSignals } from "../knowledge/signals.ts";
import {
  makeEnvironmentWiring,
  type AccountEnvironmentPorts,
  type AccountEnvironments,
} from "./environments.ts";
import { makeStops, type Stops } from "./stops.ts";
export type { Stops } from "./stops.ts";
export type {
  AccountEnvironmentPorts,
  AccountEnvironments,
  CatalogListener,
  CloseOffHold,
  DoorCredential,
  DoorRequest,
  RegisteredEnvironment,
} from "./environments.ts";
export interface AccountRuntimePorts {
  readonly account: AccountScope;
  readonly signals: PlatformSignals;
  readonly atomRegistry: AtomRegistry.AtomRegistry;
  readonly environments: AccountEnvironmentPorts;
  readonly store: AccountStore;
}
export interface AccountStage {
  readonly environments: AccountEnvironments;
  readonly stops: Stops;
}
export interface AccountRuntime extends AccountStage {
  readonly invalidations: InvalidationBus;
  readonly close: (
    reason: "logout" | "account-replaced" | "application-close",
  ) => Effect.Effect<void>;
}
export const makeAccountRuntime = Effect.fnUntraced(function* (
  ports: AccountRuntimePorts,
): Effect.fn.Return<AccountRuntime> {
  const scope = yield* Scope.make();
  const signals = yield* PubSub.unbounded<InvalidationSignal>();
  const invalidations = yield* makeInvalidationBus({
    signals: Stream.concat(
      Stream.make({ type: ports.signals.hidden() ? "hidden" : "visible" } as InvalidationSignal),
      Stream.fromPubSub(signals),
    ),
    shown: () => true,
  }).pipe(Scope.provide(scope));
  const wiring = makeEnvironmentWiring({
    ports: ports.environments,
    account: ports.account.account,
    store: ports.store,
    atomRegistry: ports.atomRegistry,
    invalidations,
    hidden: ports.signals.hidden(),
  });
  const built = wiring.start(makeMateAdapter(wiring.adapterPorts));
  const stops = makeStops(ports.atomRegistry);
  const unlisten = ports.signals.listen((signal) => {
    built.hear(signal);
    if (signal.type === "visibility")
      Effect.runSync(
        PubSub.publish(signals, {
          type: signal.hidden ? "hidden" : "visible",
        } as InvalidationSignal),
      );
    if (signal.type === "wake" && signal.visible)
      Effect.runSync(PubSub.publish(signals, { type: "visible-wake" } as InvalidationSignal));
  });
  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      unlisten();
      stops.dispose();
      built.dispose();
    }),
  );
  const subscription = yield* invalidations.subscribe.pipe(Scope.provide(scope));
  yield* PubSub.take(subscription).pipe(
    Effect.tap((invalidation) =>
      Effect.sync(() => {
        if (invalidation.topic === "container") built.request(invalidation.target);
      }),
    ),
    Effect.forever,
    Effect.forkIn(scope),
  );
  return {
    environments: built.environments,
    stops,
    invalidations,
    close: () => Scope.close(scope, Exit.void),
  };
});

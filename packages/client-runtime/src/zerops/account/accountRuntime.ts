/**
 * The account runtime (DESIGN §1.1, §1.2, §5): the composition root of one account epoch.
 *
 * - **Pre-grant stage**, built when the session verified its principal: the data runtime the host
 *   built for the epoch, its access grant, started here with the session's verifier, and the
 *   account's one invalidation bus (§6.2) with the account's `shown()`. The bus carries the
 *   grant's own invalidations and the intents surfaces send; it stands before the first grant
 *   because the grant and the data runtime subscribe to it and hear `access` and `inventory` from
 *   the start — a person's "Try again" on a first round that failed is one.
 * - **Post-grant stage**, started on the epoch's first `granted` and kept for the epoch — a later
 *   lapse never tears it down (G11). Nothing in it runs before the platform confirmed the
 *   account's organizations, projects and roles (AL-01, AL-04, MC-10).
 *
 * It hands the tab's signals (§6.4, the PlatformSignals port) to the grant and the bus: the page's
 * visibility, its network and the coalesced wake become the grant's events and the bus's signals.
 *
 * Modules of the post-grant stage are constructed here and nowhere else (§7.2 rule 6). The
 * environment store and exchange driver, and the Gitea sessions, are still constructed in the
 * web's React tree until 3.4 moves them.
 */
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { AtomRegistry } from "effect/unstable/reactivity";

import type { AccessGrantView } from "../data/access/grantDriver.ts";
import type { AccessVerifier } from "../data/access/verifier.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import { organizationKeyOf, projectKeyOf, type RuntimeInterestDescriptor } from "../data/types.ts";
import {
  makeInvalidationBus,
  type Invalidation,
  type InvalidationBus,
  type InvalidationSignal,
} from "../knowledge/invalidation.ts";
import type { PlatformSignal, PlatformSignals } from "../knowledge/signals.ts";

export interface AccountRuntimePorts {
  /** The epoch's data runtime, which the host built for the verified principal. */
  readonly data: ManagedZeropsDataRuntime;
  readonly verifier: AccessVerifier;
  /** The tab, as every consumer of the account hears it. */
  readonly signals: PlatformSignals;
  /** The registry the data runtime publishes to: what is shown is read from it. */
  readonly atomRegistry: AtomRegistry.AtomRegistry;
}

export interface AccountRuntime {
  readonly data: ManagedZeropsDataRuntime;
  /** The account's invalidation bus: every owner of pull-based facts hears it, every surface sends to it. */
  readonly invalidations: InvalidationBus;
  /** Waits for the epoch's first grant; the post-grant stage starts on it. */
  readonly postGrant: Effect.Effect<void>;
  /** Ends the epoch: the bus first, then the data runtime (§5 L9). */
  readonly close: (
    reason: "logout" | "account-replaced" | "application-close",
  ) => Effect.Effect<void>;
}

const HIDDEN: InvalidationSignal = { type: "hidden" };
const VISIBLE: InvalidationSignal = { type: "visible" };
const VISIBLE_WAKE: InvalidationSignal = { type: "visible-wake" };

const organizationOf = (descriptor: RuntimeInterestDescriptor) =>
  descriptor.kind === "organization-inventory"
    ? descriptor.organization
    : descriptor.project.organization;

export const makeAccountRuntime = Effect.fnUntraced(function* (
  ports: AccountRuntimePorts,
): Effect.fn.Return<AccountRuntime> {
  const { data, signals } = ports;
  const epoch = yield* Scope.make();
  /** The bus's own scope: it closes first, so nothing still coalescing reaches a subscriber. */
  const busScope = yield* Scope.make();
  const postGrant = yield* Deferred.make<void>();
  const busSignals = yield* PubSub.unbounded<InvalidationSignal>();

  /** Whether a view holds demand on facts under this invalidation's key. */
  const shown = (invalidation: Invalidation): boolean => {
    const held = (matches: (descriptor: RuntimeInterestDescriptor) => boolean) =>
      [...ports.atomRegistry.get(data.stateAtom).interests.values()].some(
        ({ leases, descriptor }) => leases > 0 && matches(descriptor),
      );
    switch (invalidation.topic) {
      case "access":
        return true;
      case "inventory":
        return held(
          (descriptor) =>
            organizationKeyOf(organizationOf(descriptor)) ===
            organizationKeyOf(invalidation.organization),
        );
      case "project":
        return held(
          (descriptor) =>
            descriptor.kind !== "organization-inventory" &&
            projectKeyOf(descriptor.project) === projectKeyOf(invalidation.project),
        );
      default:
        // No store of this account shows the other topics yet.
        return false;
    }
  };

  const invalidations = yield* makeInvalidationBus({
    // The page as it is when the bus starts hearing it, then every change.
    signals: Stream.concat(
      Stream.suspend(() => Stream.make(signals.hidden() ? HIDDEN : VISIBLE)),
      Stream.fromPubSub(busSignals),
    ),
    shown,
  }).pipe(Scope.provide(busScope));

  const follow = (view: AccessGrantView): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (view.machine.phase.phase === "granted") {
        yield* Deferred.succeed(postGrant, undefined);
      }
    });

  const hear = (signal: PlatformSignal): Effect.Effect<void> => {
    switch (signal.type) {
      case "visibility":
        return data.access
          .signal({ type: "VISIBILITY", hidden: signal.hidden })
          .pipe(Effect.andThen(PubSub.publish(busSignals, signal.hidden ? HIDDEN : VISIBLE)));
      case "network":
        return data.access.signal({ type: signal.online ? "ONLINE" : "OFFLINE" });
      case "wake":
        return data.access
          .signal({ type: "WAKE", visible: signal.visible })
          .pipe(
            Effect.andThen(signal.visible ? PubSub.publish(busSignals, VISIBLE_WAKE) : Effect.void),
          );
    }
  };

  yield* Effect.gen(function* () {
    // The tab is heard from the moment its state is read, one signal at a time.
    const heard = yield* Queue.unbounded<PlatformSignal>();
    const unlisten = signals.listen((signal) => Queue.offerUnsafe(heard, signal));
    yield* Scope.addFinalizer(epoch, Effect.sync(unlisten));
    yield* data.access.invalidations.pipe(
      Stream.runForEach(invalidations.invalidate),
      Effect.forkIn(busScope),
    );
    yield* data.access.listen(invalidations).pipe(Scope.provide(busScope));
    yield* data.listen(invalidations).pipe(Scope.provide(busScope));
    yield* Queue.take(heard).pipe(Effect.flatMap(hear), Effect.forever, Effect.forkIn(epoch));
    // The views stream replays the latest, so it misses nothing the start publishes.
    yield* data.access.changes.pipe(Stream.runForEach(follow), Effect.forkIn(epoch));
    yield* data.access.start({
      verifier: ports.verifier,
      hidden: signals.hidden(),
      online: signals.online(),
    });
    // An epoch that cannot start leaves nothing of its own running; its host closes the data.
  }).pipe(
    Effect.onError(() =>
      Scope.close(busScope, Exit.void).pipe(Effect.andThen(Scope.close(epoch, Exit.void))),
    ),
  );

  return {
    data,
    invalidations,
    postGrant: Deferred.await(postGrant),
    close: (reason) =>
      Scope.close(busScope, Exit.void).pipe(
        Effect.andThen(data.shutdown(reason)),
        Effect.andThen(Scope.close(epoch, Exit.void)),
      ),
  };
});

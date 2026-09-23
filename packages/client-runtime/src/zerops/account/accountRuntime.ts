/**
 * The account runtime (DESIGN §1.1, §1.2, §5): the composition root of one account epoch.
 *
 * - **Pre-grant stage**, built when the session verified its principal: the data runtime the host
 *   built for the epoch, and its access grant, started here with the session's verifier.
 * - **Post-grant stage**, built on the epoch's first `granted` and kept for the epoch — a later
 *   lapse never tears it down (G11): the invalidation bus with the account's `shown()`, carrying
 *   the grant's own invalidations. Nothing in it runs before the platform confirmed the
 *   account's organizations, projects and roles (AL-01, AL-04, MC-10).
 *
 * It owns the tab's signals as the account's machines hear them (§6.4): the page's visibility,
 * its network and its lifecycle become the grant's events and the bus's signals, with a visible
 * wake only after the tab was hidden for a while.
 *
 * Modules of the post-grant stage are constructed here and nowhere else (§7.2 rule 6). The
 * environment store and exchange driver, and the Gitea sessions, are still constructed in the
 * web's React tree until 3.4 moves them.
 */
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { AtomRegistry } from "effect/unstable/reactivity";

import type { AccessGrantView } from "../data/access/grantDriver.ts";
import type { Instant } from "../data/access/grant.ts";
import type { AccessVerifier } from "../data/access/verifier.ts";
import { DEFAULT_ZEROPS_GRANT_POLICY } from "../data/policy.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import { organizationKeyOf, projectKeyOf, type RuntimeInterestDescriptor } from "../data/types.ts";
import {
  makeInvalidationBus,
  type Invalidation,
  type InvalidationBus,
  type InvalidationSignal,
} from "../knowledge/invalidation.ts";

/** A visible wake needs the tab hidden at least this long (§6.4). */
export const WAKE_AFTER_HIDDEN_MS = 30_000;
/** Wakes are coalesced to at most one per this long (§6.4). */
export const WAKE_COALESCE_MS = 10_000;

/** What the page tells the account: its visibility, its network, a return from the bfcache or a freeze. */
export type PageSignal =
  | { readonly type: "visibility"; readonly hidden: boolean }
  | { readonly type: "resume" }
  | { readonly type: "online" }
  | { readonly type: "offline" };

export interface PagePort {
  readonly hidden: () => boolean;
  readonly online: () => boolean;
  /** Tells `hear` every signal from now on, until the returned function stops it. */
  readonly listen: (hear: (signal: PageSignal) => void) => () => void;
}

/** Where the account's actions and project writes are admitted, until 2.2's `WriteAdmission`. */
export interface WriteWindowPort {
  /** Admits them for `forMs` from now. */
  readonly open: (forMs: number) => void;
  readonly close: () => void;
}

export interface AccountRuntimePorts {
  /** The epoch's data runtime, which the host built for the verified principal. */
  readonly data: ManagedZeropsDataRuntime;
  readonly verifier: AccessVerifier;
  readonly page: PagePort;
  readonly writes: WriteWindowPort;
  /** The registry the data runtime publishes to: what is shown is read from it. */
  readonly atomRegistry: AtomRegistry.AtomRegistry;
}

/** The stage built on the epoch's first grant. */
export interface PostGrantStage {
  readonly invalidations: InvalidationBus;
}

export interface AccountRuntime {
  readonly data: ManagedZeropsDataRuntime;
  /** The post-grant stage: waits for the epoch's first grant, then the same stage for the epoch. */
  readonly postGrant: Effect.Effect<PostGrantStage>;
  /** Ends the epoch: the post-grant stage first, then the data runtime (§5 L9). */
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
  const { data, page } = ports;
  const policy = DEFAULT_ZEROPS_GRANT_POLICY;
  const clock = yield* Clock.Clock;
  const now = (): Instant => ({
    wall: clock.currentTimeMillisUnsafe(),
    mono: Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000,
  });
  const epoch = yield* Scope.make();
  const postGrantScope = yield* Scope.make();
  const postGrant = yield* Deferred.make<PostGrantStage>();
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

  const buildPostGrant = Effect.gen(function* () {
    const invalidations = yield* makeInvalidationBus({
      // The page as it is when the bus starts hearing it, then every change.
      signals: Stream.concat(
        Stream.suspend(() => Stream.make(page.hidden() ? HIDDEN : VISIBLE)),
        Stream.fromPubSub(busSignals),
      ),
      shown,
    }).pipe(Scope.provide(postGrantScope));
    yield* data.access.invalidations.pipe(
      Stream.runForEach(invalidations.invalidate),
      Effect.forkIn(postGrantScope),
    );
    yield* Deferred.succeed(postGrant, { invalidations });
  });

  /** The admitted round the write window was last opened for. */
  let openRound: number | null = null;
  const follow = (view: AccessGrantView): Effect.Effect<void> =>
    Effect.gen(function* () {
      const phase = view.machine.phase;
      if (phase.phase === "granted") {
        if (!(yield* Deferred.isDone(postGrant))) yield* buildPostGrant;
        const account = phase.evidence.account;
        if (account.round === openRound) return;
        openRound = account.round;
        const at = now();
        ports.writes.open(
          Math.min(
            account.startedAt.wall + policy.windowMs - at.wall,
            account.startedAt.mono + policy.windowMs - at.mono,
          ),
        );
      } else if (openRound !== null) {
        openRound = null;
        ports.writes.close();
      }
    });

  let hiddenAtMs: number | null = page.hidden() ? now().mono : null;
  let lastWakeMs = Number.NEGATIVE_INFINITY;
  const wake = Effect.suspend(() => {
    const at = now().mono;
    if (at - lastWakeMs < WAKE_COALESCE_MS) return Effect.void;
    lastWakeMs = at;
    const visible = hiddenAtMs === null;
    return data.access
      .signal({ type: "WAKE", visible })
      .pipe(Effect.andThen(visible ? PubSub.publish(busSignals, VISIBLE_WAKE) : Effect.void));
  });
  const hear = (signal: PageSignal): Effect.Effect<void> =>
    Effect.gen(function* () {
      switch (signal.type) {
        case "visibility": {
          yield* data.access.signal({ type: "VISIBILITY", hidden: signal.hidden });
          if (signal.hidden) {
            hiddenAtMs ??= now().mono;
            yield* PubSub.publish(busSignals, HIDDEN);
            return;
          }
          const away = hiddenAtMs === null ? 0 : now().mono - hiddenAtMs;
          hiddenAtMs = null;
          yield* PubSub.publish(busSignals, VISIBLE);
          if (away >= WAKE_AFTER_HIDDEN_MS) yield* wake;
          return;
        }
        case "resume":
          return yield* wake;
        case "online":
          return yield* data.access.signal({ type: "ONLINE" });
        case "offline":
          return yield* data.access.signal({ type: "OFFLINE" });
      }
    });

  // The page is heard from the moment its state is read, one signal at a time.
  const signals = yield* Queue.unbounded<PageSignal>();
  const unlisten = page.listen((signal) => Queue.offerUnsafe(signals, signal));
  yield* Scope.addFinalizer(epoch, Effect.sync(unlisten));
  yield* Queue.take(signals).pipe(Effect.flatMap(hear), Effect.forever, Effect.forkIn(epoch));
  // The views stream replays the latest, so it misses nothing the start publishes.
  yield* data.access.changes.pipe(Stream.runForEach(follow), Effect.forkIn(epoch));
  yield* data.access.start({
    verifier: ports.verifier,
    hidden: page.hidden(),
    online: page.online(),
  });

  return {
    data,
    postGrant: Deferred.await(postGrant),
    close: (reason) =>
      Scope.close(postGrantScope, Exit.void).pipe(
        Effect.andThen(data.shutdown(reason)),
        Effect.andThen(Scope.close(epoch, Exit.void)),
      ),
  };
});

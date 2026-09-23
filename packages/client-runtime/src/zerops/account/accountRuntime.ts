/**
 * The account runtime (DESIGN §1.1, §1.2, §5): the composition root of one account epoch.
 *
 * - **Pre-grant stage**, built when the session verified its principal: the data runtime the host
 *   built for the epoch, its access grant, started here with the session's verifier, and the
 *   account's one invalidation bus (§6.2) with the account's `shown()`. The bus carries the
 *   grant's own invalidations and the intents surfaces send; it stands before the first grant
 *   because the grant and the data runtime subscribe to it and hear `access` and `inventory` from
 *   the start — a person's "Try again" on a first round that failed is one. The account's
 *   inventory demand stands here too (§5 L7): the runtime, not a view, holds its organizations'
 *   and projects' inventories, from the first round's listing on (`inventoryDemand.ts`).
 * - **Post-grant stage**, built on the epoch's first `granted` and kept for the epoch — a later
 *   lapse never tears it down (G11). Nothing in it runs before the platform confirmed the
 *   account's organizations, projects and roles (AL-01, AL-04, MC-10): the Mate environments —
 *   the registration records, the container store with its probe store, and the exchange driver,
 *   joined and fed by `environments.ts` — and the project flow's stores: the deployment store,
 *   and on a host that gives the forge its ports the person's Gitea sessions, the forge store and
 *   the flow's command attempts, fed by `flow.ts`.
 *
 * It hands the tab's signals (§6.4, the PlatformSignals port) to the grant, the bus and the
 * post-grant stage: the page's visibility, its network and the coalesced wake become the grant's
 * events, the bus's signals and the stores' own.
 *
 * Modules of the post-grant stage are constructed here and nowhere else (§7.2 rule 6).
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
import { makeContainerStore } from "../environments/containerStore.ts";
import { makeExchangeDriver } from "../environments/exchangeDriver.ts";
import { makeRegistrationRecords } from "../environments/records.ts";
import { makeDeploymentStore, type DeploymentStore } from "../flow/deploymentStore.ts";
import type { EnvelopeServices } from "../flow/envelopeInvalidations.ts";
import { makeFlowCommands } from "../flow/flowCommands.ts";
import { makeForgeStore } from "../forge/forgeStore.ts";
import { makeGiteaSessions } from "../forge/giteaSession.ts";
import {
  deploymentStorePorts,
  envelopeServices,
  makeForgeWiring,
  type AccountForge,
  type AccountForgePorts,
  type ForgeStage,
} from "./flow.ts";
import { holdInventoryDemand } from "./inventoryDemand.ts";
import {
  makeEnvironmentWiring,
  type AccountEnvironmentPorts,
  type AccountEnvironments,
  type EnvironmentStage,
} from "./environments.ts";

export type {
  AccountEnvironmentPorts,
  AccountEnvironments,
  CatalogListener,
  DoorCredential,
  DoorRequest,
  RegisteredEnvironment,
} from "./environments.ts";
export type { AccountForge, AccountForgePorts } from "./flow.ts";
export {
  evidenceProjectRefs,
  heldEvidence,
  inventoryProjectRefs,
  pendingDenials,
} from "./inventoryDemand.ts";

export interface AccountRuntimePorts {
  /** The epoch's data runtime, which the host built for the verified principal. */
  readonly data: ManagedZeropsDataRuntime;
  readonly verifier: AccessVerifier;
  /** The tab, as every consumer of the account hears it. */
  readonly signals: PlatformSignals;
  /** The registry the data runtime publishes to: what is shown is read from it. */
  readonly atomRegistry: AtomRegistry.AtomRegistry;
  /** What the post-grant stage's Mate environments reach their sources through. */
  readonly environments: AccountEnvironmentPorts;
  /** What the person's Gitea is reached through; a host without Gitea surfaces gives none. */
  readonly forge?: AccountForgePorts;
}

/** The epoch's post-grant stage, as surfaces read it. */
export interface PostGrantStage {
  readonly environments: AccountEnvironments;
  /** What each stop's services run (D6). */
  readonly deployments: DeploymentStore;
  /** The person's Gitea; `null` on a host that gave the forge no ports. */
  readonly forge: AccountForge | null;
  /** The services a Mate's envelope names by hostname, as the account holds them (§6.1). */
  readonly services: EnvelopeServices;
}

export interface AccountRuntime {
  readonly data: ManagedZeropsDataRuntime;
  /** The account's invalidation bus: every owner of pull-based facts hears it, every surface sends to it. */
  readonly invalidations: InvalidationBus;
  /**
   * Waits for the epoch's first grant, and answers with the post-grant stage it started; an epoch
   * that closes before its first grant interrupts it.
   */
  readonly postGrant: Effect.Effect<PostGrantStage>;
  /**
   * Ends the epoch: the bus first, then the post-grant stage and the inventory demand, then the
   * data runtime (§5 L9).
   */
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
  /** The post-grant stage's scope: it closes before the data runtime shuts down. */
  const postGrantScope = yield* Scope.make();
  /** The inventory demand's scope: its leases are released before the data runtime shuts down. */
  const demandScope = yield* Scope.make();
  const postGrant = yield* Deferred.make<PostGrantStage>();
  const services = yield* Effect.context<never>();
  let stage: {
    readonly environments: EnvironmentStage;
    readonly forge: ForgeStage | null;
    readonly deployments: DeploymentStore;
  } | null = null;
  let closed = false;
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
      case "forge-org":
      case "forge-repo":
      case "forge-pr":
        return stage?.forge?.shows(invalidation) ?? false;
      case "deployment":
        return stage?.deployments.shows(invalidation.service) ?? false;
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

  /** The post-grant stage: its stores built, joined, fed, and ended with its scope. */
  const buildPostGrant = Effect.gen(function* () {
    const wiring = makeEnvironmentWiring({
      ports: ports.environments,
      data,
      atomRegistry: ports.atomRegistry,
      invalidations,
      services,
      hidden: signals.hidden(),
    });
    const built = wiring.start({
      records: makeRegistrationRecords(ports.environments.records),
      containers: makeContainerStore(wiring.containerPorts),
      driver: makeExchangeDriver(wiring.driverPorts),
    });
    const deployments = makeDeploymentStore(deploymentStorePorts(data, ports.atomRegistry));
    const forge =
      ports.forge === undefined
        ? null
        : (() => {
            const forgeWiring = makeForgeWiring({
              ports: ports.forge,
              signals,
              invalidations,
              services,
            });
            const sessions = makeGiteaSessions(forgeWiring.sessionPorts);
            return forgeWiring.start({
              sessions,
              store: makeForgeStore(forgeWiring.storePorts(sessions)),
              commands: makeFlowCommands(forgeWiring.commandPorts(sessions)),
            });
          })();
    // Finalizers run in reverse: the Gitea tokens are forgotten first, then the stores end.
    yield* Scope.addFinalizer(postGrantScope, Effect.sync(built.dispose));
    yield* Scope.addFinalizer(postGrantScope, Effect.sync(deployments.dispose));
    if (forge !== null) yield* Scope.addFinalizer(postGrantScope, Effect.sync(forge.dispose));
    // Each owner of pull-based facts reads again what an invalidation names (§6.2).
    const subscription = yield* invalidations.subscribe.pipe(Scope.provide(postGrantScope));
    yield* PubSub.take(subscription).pipe(
      Effect.flatMap((invalidation) =>
        Effect.sync(() => {
          switch (invalidation.topic) {
            case "container":
              built.request(invalidation.target);
              return;
            case "deployment":
              deployments.invalidate(invalidation);
              return;
            case "forge-org":
            case "forge-repo":
            case "forge-pr":
              forge?.invalidate(invalidation);
              return;
            default:
              return;
          }
        }),
      ),
      Effect.forever,
      Effect.forkIn(postGrantScope),
    );
    return { environments: built, forge, deployments };
  });

  const follow = (view: AccessGrantView): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (closed) return;
      if (stage === null) {
        if (view.machine.phase.phase !== "granted") return;
        stage = yield* buildPostGrant;
        yield* Deferred.succeed(postGrant, {
          environments: stage.environments.environments,
          deployments: stage.deployments,
          forge: stage.forge?.forge ?? null,
          services: envelopeServices(data, ports.atomRegistry),
        });
      }
      stage.environments.grant(view);
    });

  const hear = (signal: PlatformSignal): Effect.Effect<void> =>
    Effect.sync(() => {
      stage?.environments.hear(signal);
      stage?.forge?.hear(signal);
    }).pipe(Effect.andThen(heardByAccount(signal)));

  const heardByAccount = (signal: PlatformSignal): Effect.Effect<void> => {
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
      case "restored":
        // The account hears a restore through the visible wake that comes with it.
        return Effect.void;
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
    yield* holdInventoryDemand({ data, atomRegistry: ports.atomRegistry }).pipe(
      Scope.provide(demandScope),
    );
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
      Scope.close(busScope, Exit.void).pipe(
        Effect.andThen(Scope.close(postGrantScope, Exit.void)),
        Effect.andThen(Scope.close(demandScope, Exit.void)),
        Effect.andThen(Scope.close(epoch, Exit.void)),
      ),
    ),
  );

  return {
    data,
    invalidations,
    postGrant: Deferred.await(postGrant),
    close: (reason) =>
      Effect.sync(() => {
        closed = true;
      }).pipe(
        // An epoch that closes before its first grant never builds its post-grant stage.
        Effect.andThen(Deferred.interrupt(postGrant)),
        Effect.andThen(Scope.close(busScope, Exit.void)),
        Effect.andThen(Scope.close(postGrantScope, Exit.void)),
        Effect.andThen(Scope.close(demandScope, Exit.void)),
        Effect.andThen(data.shutdown(reason)),
        Effect.andThen(Scope.close(epoch, Exit.void)),
      ),
  };
});

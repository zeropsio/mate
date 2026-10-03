/**
 * The Mate environments of the post-grant stage (DESIGN §4.4, §4.5, §4.8, §5): how the account
 * runtime feeds the stores it built — the registration records, the container store and the
 * exchange driver — and what surfaces read and ask of them.
 *
 * - Every target's presence comes from the account's listings, the data runtime's projects and
 *   services of every organization the grant names (B4, `candidateListingsAtom`), and from the
 *   records (C1). A remembered Mate is looked for where its record kept it until its project's
 *   services are read (A16); one they were read without has that organization's inventory read
 *   again, and is gone only once that direct read lacks it too (§9 C19). A listing change that
 *   changes no row and settles no absence feeds nothing. No React holds a fact here: the web and
 *   mobile hand over ports and send intents — the route, the active organization, a Connect.
 * - The account's guards come from its grant, the tab from the account's signals, a container's
 *   re-read from the account's bus.
 * - A Mate is connected while it holds a lease (krok-a-hub §3): the route's and the screen's, the
 *   one left last for `RECENT_MS`, an action's, a Connect's. The route's target is found through
 *   its record or the descriptor index, which a route nothing names sweeps once (§4.8). A
 *   remembered Mate with no lease is parked: its registration, kept session and cached data stay,
 *   its socket closes.
 * - A registration nothing remembers — and that no install is writing — is released.
 *
 * The stores are constructed by the account runtime alone (§7.2 rule 6); this module only wires
 * them. Plain callbacks and promises, like the stores: the one Effect it runs is the data
 * runtime's, with the account's services.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import type { ConnectionAdmission } from "../../connection/admission.ts";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { AtomRegistry } from "effect/unstable/reactivity";

import { normalizeOrigin } from "../candidates.ts";
import { identityMint } from "../data/access/capabilities.ts";
import type { Instant } from "../data/access/grant.ts";
import type { AccessGrantView } from "../data/access/grantDriver.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import {
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  type OrganizationRef,
  type ProjectActivityRead,
  type ProjectRef,
} from "../data/types.ts";
import type { IdentityExchangeReason } from "../diagnostics.ts";
import {
  platformSaysDown,
  type ContainerMachine,
  type MateFlag,
} from "../environments/containerMachine.ts";
import {
  bindContainerStore,
  type ContainerStore,
  type ContainerStorePorts,
  type IntentRequest,
  type IntentStorage,
} from "../environments/containerStore.ts";
import {
  indexDescriptors,
  resolveEnvironment,
  sweepRead,
  type DescriptorIndex,
} from "../environments/descriptorIndex.ts";
import { candidateListingsAtom, type OrganizationListing } from "../environments/listings.ts";
import { readServiceMateFlag } from "../environments/mateFlag.ts";
import type {
  DescriptorFacts,
  EnvironmentMachine,
  LinkPhase,
} from "../environments/environmentMachine.ts";
import type {
  ConnectOutcome,
  ExchangeClock,
  ExchangeDriver,
  ExchangeDriverPorts,
  ExchangeRequest,
  InstallOutcome,
  TargetKey,
} from "../environments/exchangeDriver.ts";
import type { ProbeReading } from "../environments/probeStore.ts";
import type {
  RecordsStorage,
  RegistrationRecord,
  RegistrationRecords,
} from "../environments/records.ts";
import {
  containerTargetsOf,
  listTargets,
  targetProject,
  type Absence,
} from "../environments/targets.ts";
import type { ExchangeAnswer } from "../identityExchange.ts";
import type { InvalidationBus } from "../knowledge/invalidation.ts";
import type { PlatformSignal } from "../knowledge/signals.ts";
import { heldCandidates, type CandidateRow } from "../projections/candidates.ts";

// ── Ports ────────────────────────────────────────────────────────────────────────────────────

/** An exchange at a Mate's door, for the project and organization the listings name. */
export interface DoorRequest extends ExchangeRequest {
  readonly projectId: string;
  /** The organization that lists the project: the throwaway is minted there. */
  readonly organizationId: string;
}

/** An accepted credential: the port that exchanged it installs it in the connection registry. */
export interface DoorCredential {
  /** Registers the environment, or rotates the credential of one already registered. */
  readonly install: () => Promise<InstallOutcome>;
}

/** An environment the connection catalog holds. */
export interface RegisteredEnvironment {
  readonly environmentId: EnvironmentId;
  /** The origin it is served at, normalized; null when the catalog names none. */
  readonly origin: string | null;
}

export interface CatalogListener {
  /** Every environment registered now; again on each change. */
  readonly environments: (registered: ReadonlyArray<RegisteredEnvironment>) => void;
  /** Each publication of an environment's link (region L): every one is an observation. */
  readonly link: (environmentId: EnvironmentId, phase: LinkPhase) => void;
}

export interface AccountEnvironmentPorts {
  readonly clock: ExchangeClock;
  readonly door: {
    /** The descriptor, the mint, the door and the token exchange; installs nothing. */
    readonly exchange: (request: DoorRequest) => Promise<ExchangeAnswer<DoorCredential>>;
    readonly readDescriptor: (origin: string, signal: AbortSignal) => Promise<DescriptorFacts>;
    /**
     * Whether the target's exchange presents a session kept from an earlier load first
     * (`keptSessions.ts`): it starts past the mint pace and spends none of it. Absent: none is.
     */
    readonly kept?: (key: TargetKey) => boolean;
    /**
     * Each Mate's backoff cap as loads keep it (`doorCaps.ts`). Absent: every load starts each
     * ladder over.
     */
    readonly capped?: ExchangeDriverPorts<DoorCredential>["capped"];
    /** The supervisor's `retryNow` for a link in backoff. */
    readonly retryLink: (environmentId: EnvironmentId) => void;
    /** `catalog.remove`: the registration is released; drafts keep their keys (AL-13). */
    readonly remove: (environmentId: EnvironmentId) => void;
    /**
     * Drops the session kept for the target (`keptSessions.ts`) where it is, never ending it at a
     * Mate that is gone. Absent: none is kept.
     */
    readonly forgetKept?: (key: TargetKey) => void;
    /** `registry.park`: the socket closes; the registration, its session and its data stay. */
    readonly park: (environmentId: EnvironmentId) => void;
    /** `registry.unpark`: the socket opens on the credential the registration holds, no door. */
    readonly unpark: (environmentId: EnvironmentId) => void;
  };
  /** Reads a Mate origin's descriptor and `/healthz`; rejects when the signal aborts it. */
  readonly probe: ContainerStorePorts["probe"];
  /** Reads a Mate origin's `/healthz` `initAt` alone, before a restart verb is sent. */
  readonly readInitAt: ContainerStorePorts["readInitAt"];
  /** This tab's container intents (C8). */
  readonly intents: IntentStorage;
  /** The account's storage of its records (C1), and another tab's write of them. */
  readonly records: RecordsStorage & { readonly listen: (changed: () => void) => () => void };
  /** The connection catalog: which environments are registered, and their links. */
  readonly catalog: { readonly listen: (listener: CatalogListener) => () => void };
  /**
   * The environment the tab's route names as the stage starts — the reload's address — so the
   * route's target is wanted from the first allocation; a surface's `setRoute` follows it.
   * Absent: the route is only what `setRoute` names.
   */
  readonly route?: () => EnvironmentId | null;
  /** The tab's socket admission (`connection/admission.ts`): the route's socket opens first. */
  readonly admission?: Pick<ConnectionAdmission, "prefer" | "down">;
  /**
   * HQ's index of the Mates the reader observes: the project whose Mate serves an environment
   * (krok-a-hub §3). A route or an action no record or descriptor names finds its target through
   * it, with no descriptor sweep. Absent: it names none.
   */
  readonly hqIndex?: {
    readonly projectOf: (environmentId: EnvironmentId) => string | null;
    readonly subscribe: (listener: () => void) => () => void;
  };
  /**
   * Whether a press is in flight in this browser, its project made or not: the background mints
   * no throwaway meanwhile (`holdBackground`), as the press reads the token list they are written
   * to. A surface with no press of its own leaves it out.
   */
  readonly pressInFlight?: {
    readonly read: () => boolean;
    readonly subscribe: (listener: () => void) => () => void;
  };
  /**
   * The projects whose Mate HQ holds online now: each proves its container up without a probe
   * (`ContainerStore.setOnline`). Null while HQ's word is not current: a Mate first listed
   * meanwhile waits for it, a bounded while. Without it, every container is read as before.
   */
  readonly online?: {
    readonly read: () => ReadonlySet<string> | null;
    readonly subscribe: (listener: () => void) => () => void;
  };
  /**
   * The organization whose official HQ's word on its Mates is current: a project it lists that HQ
   * does not hold online — no Mate of HQ's there, or one HQ holds offline — is read only once a
   * lease waits on it (`ContainerStore.setHqScope`). Null while no official HQ's word is; absent,
   * every listed container is read as the listing says.
   */
  readonly hqOrganization?: {
    readonly read: () => string | null;
    readonly subscribe: (listener: () => void) => () => void;
  };
}

// ── What surfaces read and ask ───────────────────────────────────────────────────────────────

export interface AccountEnvironments {
  /** Every target's environment machine (§4.4); the same map until the next publication. */
  readonly machines: () => ReadonlyMap<TargetKey, EnvironmentMachine>;
  /** Every target's container machine (§4.5); the same map until the next publication. */
  readonly containers: () => ReadonlyMap<TargetKey, ContainerMachine>;
  /** The registration records (C1); the same array until they change. */
  readonly records: () => ReadonlyArray<RegistrationRecord>;
  /** The descriptor index over both machines' maps; the same object until either changes. */
  readonly index: () => DescriptorIndex;
  /** Told after any of the above changed. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * The user's Connect, a user retry: the target is held until it answers, with the installed
   * environment — the Mate then stays as the one left last — or with the verdict the machine
   * settled on instead.
   */
  readonly connect: (key: TargetKey, reason: IdentityExchangeReason) => Promise<ConnectOutcome>;
  /**
   * An action from outside the Mate's own view — a send, a Stop, a rename — holds the Mate this
   * environment names connected until the answer is called; calling it again does nothing.
   */
  readonly hold: (environmentId: EnvironmentId) => () => void;
  /**
   * Our verb was accepted for this target: its container shows it until a read fact settles it.
   * False when no container took it — the store holds no such target, or the platform's facts
   * already overrule it — so nothing will say when it is over.
   */
  readonly intend: (key: TargetKey, intent: IntentRequest) => boolean;
  /**
   * The target's `/healthz` `initAt`, read now: a restart verb reads it just before it is sent and
   * hands it to `intend` as the restart's baseline. Null when it could not say.
   */
  readonly initAt: (key: TargetKey) => Promise<string | null>;
  /** The reading of a probe of this origin started from now on, through the account's pool. */
  readonly next: (origin: string) => Promise<ProbeReading>;
  /** The route's environment, whose target is exchanged first (§4.4); null off a thread route. */
  readonly setRoute: (environmentId: EnvironmentId | null) => void;
  /** The organization the tab has open: a target nothing names has its inventory read (§6.2). */
  readonly setActiveOrganization: (organizationId: string | null) => void;
  /**
   * The project whose Mate is on screen — its own view, its birth — or null: it holds the
   * screen's lease, asked for as the route's is but capped and held while hidden as no route is.
   */
  readonly setOnScreen: (projectId: string | null) => void;
}

/** What the account runtime drives the stage with, besides its stores. */
export interface EnvironmentStage {
  readonly environments: AccountEnvironments;
  /** The grant's views, each one the stage's account guards (§4.4 CAN). */
  readonly grant: (view: AccessGrantView) => void;
  /** The tab (§6.4): retries wait while hidden and fire on a visible wake. */
  readonly hear: (signal: PlatformSignal) => void;
  /** A container's facts may have changed at the source (§6.2): it is read again. */
  readonly request: (key: TargetKey) => void;
  /** The account closed: every machine, timer, probe, exchange and listener ends. */
  readonly dispose: () => void;
}

export interface EnvironmentStores {
  readonly records: RegistrationRecords;
  readonly containers: ContainerStore;
  readonly driver: ExchangeDriver;
}

export interface EnvironmentWiring {
  readonly containerPorts: ContainerStorePorts;
  readonly driverPorts: ExchangeDriverPorts<DoorCredential>;
  /** Joins the stores the runtime built from these ports and starts feeding them. */
  readonly start: (stores: EnvironmentStores) => EnvironmentStage;
}

export interface EnvironmentWiringOptions {
  readonly ports: AccountEnvironmentPorts;
  readonly data: ManagedZeropsDataRuntime;
  readonly atomRegistry: AtomRegistry.AtomRegistry;
  readonly invalidations: InvalidationBus;
  /** The account's services, which the data runtime's reads and the bus run with. */
  readonly services: Context.Context<never>;
  /** Whether the tab is hidden when the stage starts. */
  readonly hidden: boolean;
}

// ── The listings ─────────────────────────────────────────────────────────────────────────────

/**
 * What `listTargets` reads of a listing besides its rows: whether it can settle an absence, and
 * its direct reads.
 */
const settling = (listed: OrganizationListing) => ({
  state: listed.listing.state,
  coverage: listed.listing.state === "known" ? listed.listing.coverage : null,
  directReads: [...listed.directReads],
});

const sameItems = <T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>): boolean =>
  left.length === right.length && left.every((item, index) => item === right[index]);

/** Whether a process the activity feed reads as running runs on the row's container. */
const runningOn = (activity: ProjectActivityRead, row: CandidateRow): boolean =>
  activity.running.value.some((entry) => {
    if (entry.knowledge !== "observed") return false;
    const identity = entry.record.identity;
    if (identity.knowledge !== "observed") return false;
    return (
      row.service === undefined ||
      (identity.fields.serviceIds ?? []).includes(ZeropsServiceId.make(row.service.id))
    );
  });

const origin = (url: string | undefined | null): string | null =>
  url === undefined || url === null ? null : normalizeOrigin(url);

/** How long the Mate left last stays connected (krok-a-hub §3, the warm policy Q8). */
const RECENT_MS = 5 * 60_000;

// ── The wiring ───────────────────────────────────────────────────────────────────────────────

export function makeEnvironmentWiring(options: EnvironmentWiringOptions): EnvironmentWiring {
  const { ports, data, atomRegistry } = options;
  const run = Effect.runForkWith(options.services);
  let stores: EnvironmentStores | null = null;
  let closed = false;
  let listings: ReadonlyArray<OrganizationListing> = [];
  let rows: ReadonlyArray<CandidateRow> = [];
  /** The remembered targets their projects' services were read without (§9 C19). */
  let absences: ReadonlyMap<TargetKey, Absence> = new Map();
  let registered: ReadonlyArray<RegisteredEnvironment> = [];
  let route: EnvironmentId | null = null;
  /** The route's target, as `updateRoute` last found it; its container is read first. */
  let routeKey: TargetKey | null = null;
  let activeOrganization: string | null = null;
  let onScreen: string | null = null;
  /** The targets the route and the screen hold: one that leaves them is the Mate left last. */
  let viewed: ReadonlyArray<TargetKey> = [];
  /** The Mate left last, and what disarms the timer that lets it go. */
  let recent: { readonly key: TargetKey; readonly disarm: () => void } | null = null;
  /** Whether each registered environment was last parked, as the registry was told. */
  const parking = new Map<EnvironmentId, boolean>();
  /** Each action's lease: the target its environment named when last resolved, and its release. */
  interface ActionLease {
    readonly environmentId: EnvironmentId;
    key: TargetKey | null;
    letGo: (() => void) | null;
  }
  const actions = new Set<ActionLease>();
  /** Installs in flight, by the Mate origin they exchanged at. */
  const installing = new Map<string, number>();
  /** The origin each target's latest exchange ran at. */
  const exchangedAt = new Map<TargetKey, string>();
  /** The route a sweep read targets for, and when each target's read counts from (`sweepRead`). */
  let swept: {
    readonly route: EnvironmentId | null;
    readonly keys: ReadonlyMap<TargetKey, Instant>;
  } = { route: null, keys: new Map() };
  /**
   * The confirming read of each project an absence waits on (§9 C19): held until no absence in
   * the project waits, read again whenever one asks for it again.
   */
  const checks = new Map<string, () => void>();
  const confirmAbsence = (projectId: string) => {
    const project = projectRefOf(projectId);
    if (project === undefined || closed) return;
    checks.get(projectId)?.();
    const lease = run(
      Effect.scoped(
        data
          .acquire({ kind: "project-services-check", project })
          .pipe(Effect.andThen(Effect.never)),
      ).pipe(Effect.ignore),
    );
    checks.set(projectId, () => run(Fiber.interrupt(lease)));
  };
  /** The activity feed of each booting target's project: its lease and its subscription. */
  const activity = new Map<
    string,
    { readonly lease: Fiber.Fiber<void>; readonly stop: () => void }
  >();
  const listeners = new Set<() => void>();

  const rowOf = (key: TargetKey) => rows.find((row) => row.key === key);
  /** The target's project as a listing names it, whether or not its services are read. */
  const projectOf = (key: TargetKey) =>
    rows.find((row) => row.project.id === targetProject(key))?.project;
  const organizationRef = (organizationId: string): OrganizationRef => ({
    kind: "organization",
    account: data.scope.account,
    organizationId: ZeropsOrganizationId.make(organizationId),
  });
  /** The organization whose listing holds the project. */
  const listingOf = (projectId: string) =>
    listings.find(({ listing }) =>
      heldCandidates(listing).rows.some((row) => row.project.id === projectId),
    );
  const projectRefOf = (projectId: string): ProjectRef | undefined => {
    const listed = listingOf(projectId);
    return listed === undefined
      ? undefined
      : {
          kind: "project",
          organization: organizationRef(listed.organizationId),
          projectId: ZeropsProjectId.make(projectId),
        };
  };
  const notify = () => {
    for (const listener of listeners) listener();
  };

  // ── The container store's ports ────────────────────────────────────────────────────────────

  /** `ZCP_MATE_ENABLED` for a target's service, read with the account's services. */
  const readMateFlag = async (key: TargetKey): Promise<MateFlag> => {
    const [projectId, serviceId] = key.split(":");
    const project = projectId === undefined ? undefined : projectRefOf(projectId);
    if (project === undefined || serviceId === undefined) return "unknown";
    return readServiceMateFlag(
      data,
      atomRegistry,
      { kind: "service", project, serviceId: ZeropsServiceId.make(serviceId) },
      options.services,
    );
  };

  const containerPorts: ContainerStorePorts = {
    clock: ports.clock,
    probe: ports.probe,
    readInitAt: ports.readInitAt,
    readMateFlag,
    intents: ports.intents,
  };

  // ── The exchange driver's ports ────────────────────────────────────────────────────────────

  /** Whose organization lists the target's project: the listing's, else its record's. */
  const organizationOf = (key: TargetKey): string | null => {
    const listed = listingOf(targetProject(key));
    if (listed !== undefined) return listed.organizationId;
    return (
      stores?.records.list().find((record) => record.targetKey === key)?.projectRef?.orgId ?? null
    );
  };

  /**
   * A registration nothing remembers, that no install is writing and that no machine holds, is
   * released. A held one is the Mate's live link: a record write that did not land, or another
   * tab's records stored without it, says nothing about it — once its machine lets it go, it is
   * released like any other.
   */
  const release = () => {
    if (stores === null || closed) return;
    const remembered = new Set(stores.records.list().map((record) => record.environmentId));
    const held = new Set(
      [...stores.driver.machines().values()].flatMap(({ credential }) =>
        credential.kind === "held" ? [credential.environmentId] : [],
      ),
    );
    for (const environment of registered) {
      if (remembered.has(environment.environmentId) || held.has(environment.environmentId)) {
        continue;
      }
      if (environment.origin !== null && installing.has(environment.origin)) continue;
      ports.door.remove(environment.environmentId);
    }
  };

  /**
   * A registration whose Mate holds no lease is parked (krok-a-hub §3): its socket closes, and its
   * registration, kept session and cached data stay. A leased one is unparked: it connects on the
   * credential it holds, with no door. One nothing remembers or holds is left to `release`.
   */
  const updateParking = () => {
    if (stores === null || closed) return;
    const known = new Set(stores.records.list().map((record) => record.environmentId));
    const leased = new Set<EnvironmentId>();
    for (const machine of stores.driver.machines().values()) {
      const held = machine.credential.kind === "held" ? [machine.credential.environmentId] : [];
      for (const environmentId of [...held, ...(machine.record === null ? [] : [machine.record])]) {
        known.add(environmentId);
        if (machine.guards.want) leased.add(environmentId);
      }
    }
    const present = new Set(registered.map((environment) => environment.environmentId));
    for (const environmentId of parking.keys()) {
      if (!present.has(environmentId)) parking.delete(environmentId);
    }
    for (const environmentId of present) {
      if (!known.has(environmentId)) continue;
      const park = !leased.has(environmentId);
      if (parking.get(environmentId) === park) continue;
      parking.set(environmentId, park);
      if (park) ports.door.park(environmentId);
      else ports.door.unpark(environmentId);
    }
  };

  /** The listed Mate of the project HQ's index names for an environment, once its services are read. */
  const hintedTarget = (environmentId: EnvironmentId): TargetKey | null => {
    const projectId = ports.hqIndex?.projectOf(environmentId) ?? null;
    if (projectId === null) return null;
    return (
      rows.find((row) => row.project.id === projectId && row.service !== undefined)?.key ?? null
    );
  };

  /**
   * The target an environment names: the one its record remembers, else the one the descriptor
   * index finds, else the one HQ's index names.
   */
  const targetOf = (environmentId: EnvironmentId): TargetKey | null =>
    stores!.records.list().find((record) => record.environmentId === environmentId)?.targetKey ??
    resolveEnvironment(stores!.driver.machines(), indexOf(), environmentId)?.key ??
    hintedTarget(environmentId);

  /** Each action holds the target its environment names now; one nothing names yet waits. */
  const updateActions = () => {
    if (stores === null || closed) return;
    for (const action of actions) {
      const key = targetOf(action.environmentId);
      if (key === action.key) continue;
      action.letGo?.();
      action.key = key;
      action.letGo = key === null ? null : stores.driver.hold(key, "action");
    }
  };

  /** The records, or the installs that write them, changed. */
  const registrationsChanged = () => {
    updateRoute();
    updateActions();
    updateTargets();
    release();
    updateParking();
    notify();
  };

  const install: ExchangeDriverPorts<DoorCredential>["install"] = async ({
    key,
    environmentId,
    credential,
  }) => {
    const at = exchangedAt.get(key) ?? null;
    if (at !== null) installing.set(at, (installing.get(at) ?? 0) + 1);
    try {
      const outcome = await credential.install();
      if (!outcome.ok || closed || stores === null) return outcome;
      // The signer's tag, the review and the Git tab read the project off this record (H12):
      // every exchange that installs an environment writes it the same way.
      const project = projectOf(key);
      const organizationId = organizationOf(key);
      stores.records.remember({
        targetKey: key,
        environmentId,
        origin: at,
        projectRef:
          organizationId === null ? null : { projectId: targetProject(key), orgId: organizationId },
        name: project?.name ?? null,
      });
      return outcome;
    } finally {
      if (at !== null) {
        const remaining = (installing.get(at) ?? 1) - 1;
        if (remaining === 0) installing.delete(at);
        else installing.set(at, remaining);
      }
      if (!closed) registrationsChanged();
    }
  };

  const driverPorts: ExchangeDriverPorts<DoorCredential> = {
    clock: ports.clock,
    exchange: (request) => {
      const organizationId = organizationOf(request.key);
      // A target read at the origin its record kept is exchanged in the project its key names.
      const remembered = stores?.driver.machine(request.key)?.presence.kind === "remembered";
      // The inventory no longer names this target: its presence is read again.
      if ((!remembered && rowOf(request.key) === undefined) || organizationId === null) {
        return Promise.resolve({
          ok: false,
          failure: { class: "refusal", reason: { kind: "project-mismatch" } },
          descriptor: null,
        });
      }
      const at = origin(request.origin);
      if (at !== null) exchangedAt.set(request.key, at);
      return ports.door.exchange({
        ...request,
        projectId: targetProject(request.key),
        organizationId,
      });
    },
    install,
    readDescriptor: ports.door.readDescriptor,
    ...(ports.door.kept === undefined ? {} : { kept: ports.door.kept }),
    ...(ports.door.capped === undefined ? {} : { capped: ports.door.capped }),
    retryLink: ports.door.retryLink,
    refreshPresence: (key) => {
      const organizationId = organizationOf(key) ?? activeOrganization;
      if (organizationId === null) return;
      run(
        data.refreshPresence({
          kind: "project",
          organization: organizationRef(organizationId),
          projectId: ZeropsProjectId.make(targetProject(key)),
        }),
      );
    },
    // A Mate gone from where the platform lists it — or removed by its person — leaves the
    // catalog, and its record and kept session with it: no later load reads it again.
    retire: (key, environmentId) => {
      if (environmentId !== null) ports.door.remove(environmentId);
      stores?.records.forget(key);
      ports.door.forgetKept?.(key);
    },
  };

  // ── Feeding the stores ─────────────────────────────────────────────────────────────────────

  /**
   * Every target, its presence and its container. An absence that begins a wait has its project's services read on their own, lag-free (§9 C19): the
   * organization's search may trail a service it lacks.
   */
  const updateTargets = () => {
    if (stores === null || closed) return;
    const records = stores.records.list();
    const listed = listTargets({
      listings,
      records,
      directReads: new Map(listings.flatMap(({ directReads }) => [...directReads])),
      absences,
      lastPresence: (key) => stores!.driver.machine(key)?.presence ?? null,
    });
    absences = listed.absences;
    stores.containers.setTargets(containerTargetsOf(rows, listed.targets, routeKey));
    for (const key of listed.confirm) confirmAbsence(targetProject(key));
    const waiting = new Set(
      [...absences].flatMap(([key, absence]) =>
        absence.kind === "waiting" ? [targetProject(key)] : [],
      ),
    );
    for (const [projectId, release] of checks) {
      if (waiting.has(projectId)) continue;
      release();
      checks.delete(projectId);
    }
    stores.driver.setTargets(
      listed.targets.map((target) => ({
        ...target,
        container: stores!.containers.verdict(target.key),
      })),
    );
  };

  /** The Mate left last stays connected `RECENT_MS`, unless another is left after it. */
  const keepRecent = (key: TargetKey) => {
    if (stores === null || closed) return;
    recent?.disarm();
    const disarm = ports.clock.setTimer(RECENT_MS, () => {
      if (recent?.disarm !== disarm || stores === null || closed) return;
      recent = null;
      stores.driver.setDemand("recent", []);
    });
    recent = { key, disarm };
    stores.driver.setDemand("recent", [key]);
  };

  /** The route's and the screen's leases: a target that leaves both is the Mate left last. */
  const holdViewed = (onRoute: ReadonlyArray<TargetKey>, shown: ReadonlyArray<TargetKey>) => {
    const held = [...onRoute, ...shown];
    const left = viewed.find((key) => !held.includes(key));
    viewed = held;
    stores!.driver.setDemand("route", onRoute);
    stores!.driver.setDemand("screen", shown);
    if (left !== undefined) keepRecent(left);
  };

  /**
   * The route's target, wanted first: the one its record remembers, else the one the descriptor
   * index finds, else the one HQ's index names; and the on-screen project's. While neither index
   * names the route's environment, each present target read without an answer is read once more,
   * once per route (§4.8's sweep, `sweepRead`): on its poll when one reads it, a poll interval
   * after the failure the sweep saw, else at once. An unreachable one that fails that read too has
   * answered for the index.
   */
  const updateRoute = () => {
    if (stores === null || closed) return;
    if (swept.route !== route) swept = { route, keys: new Map() };
    const shown = rows.flatMap((row) => (row.project.id === onScreen ? [row.key] : []));
    if (route === null) {
      routeKey = null;
      holdViewed([], shown);
      return;
    }
    const machines = stores.driver.machines();
    const index = indexOf();
    const resolved = resolveEnvironment(machines, index, route);
    const hinted = hintedTarget(route);
    const key =
      stores.records.list().find((record) => record.environmentId === route)?.targetKey ??
      resolved?.key ??
      hinted ??
      undefined;
    routeKey = key ?? null;
    holdViewed(key === undefined ? [] : [key], shown);
    if (resolved !== undefined || hinted !== null) return;
    const unswept = index.failed.filter((failed) => !swept.keys.has(failed));
    if (unswept.length === 0) return;
    const { containers } = stores;
    const asked = ports.clock.now();
    const reads = unswept.map((key) => [key, sweepRead(containers.machine(key), asked)] as const);
    swept = {
      route,
      keys: new Map([...swept.keys, ...reads.map(([key, read]) => [key, read.from] as const)]),
    };
    for (const [key, read] of reads) if (read.request) containers.request(key);
  };

  /**
   * The platform's processes for every booting target's project: a boot's cap runs from the
   * moment the last process ends (§4.5), so a long restart or start is never overdue while it runs.
   */
  const updateProcesses = () => {
    if (stores === null || closed) return;
    const booting = new Map<string, ProjectRef>();
    for (const [key, machine] of stores.containers.machines()) {
      if (machine.state.level !== "booting") continue;
      const projectId = targetProject(key);
      const ref = projectRefOf(projectId);
      if (ref !== undefined) booting.set(projectId, ref);
    }
    for (const [projectId, followed] of activity) {
      if (booting.has(projectId)) continue;
      activity.delete(projectId);
      followed.stop();
    }
    for (const [projectId, project] of booting) {
      if (activity.has(projectId)) continue;
      const lease = run(
        Effect.scoped(
          data.acquire({ kind: "project-activity", project }).pipe(Effect.andThen(Effect.never)),
        ).pipe(Effect.ignore),
      );
      const report = (read: ProjectActivityRead) => {
        if (stores === null || closed) return;
        for (const row of rows) {
          if (row.project.id === projectId)
            stores.containers.process(row.key, runningOn(read, row));
        }
      };
      const unsubscribe = atomRegistry.subscribe(data.reads.activity(project), report, {
        immediate: true,
      });
      activity.set(projectId, {
        lease,
        stop: () => {
          unsubscribe();
          run(Fiber.interrupt(lease));
        },
      });
    }
  };

  // ── The index ──────────────────────────────────────────────────────────────────────────────

  let indexed: {
    readonly machines: ReadonlyMap<TargetKey, EnvironmentMachine>;
    readonly containers: ReadonlyMap<TargetKey, ContainerMachine>;
    readonly reread: ReadonlyMap<TargetKey, Instant>;
    readonly index: DescriptorIndex;
  } | null = null;
  const indexOf = (): DescriptorIndex => {
    const machines = stores!.driver.machines();
    const containers = stores!.containers.machines();
    const reread = swept.keys;
    if (
      indexed?.machines !== machines ||
      indexed.containers !== containers ||
      indexed.reread !== reread
    ) {
      indexed = {
        machines,
        containers,
        reread,
        index: indexDescriptors(machines, containers, reread),
      };
    }
    return indexed.index;
  };

  // ── The stage ──────────────────────────────────────────────────────────────────────────────

  /** What the socket admission was last told the route is. */
  let preferred: EnvironmentId | null = null;
  const preferRoute = () => {
    const next = closed ? null : route;
    if (next === preferred) return;
    preferred = next;
    ports.admission?.prefer(next);
  };

  /** The environments the socket admission holds as down, each with what lets it go. */
  const downs = new Map<EnvironmentId, () => void>();
  /**
   * A Mate the platform says is down attempts no socket (`ConnectionAdmission.down`): its server
   * is not there to answer, and the status push that says ACTIVE again lets it go.
   */
  const updateDowns = () => {
    const admission = ports.admission;
    if (admission === undefined) return;
    const next = new Set<EnvironmentId>();
    if (!closed && stores !== null) {
      const recorded = new Map(
        stores.records.list().map((record) => [record.targetKey, record.environmentId] as const),
      );
      for (const [key, machine] of stores.containers.machines()) {
        if (!platformSaysDown(machine)) continue;
        const credential = stores.driver.machine(key)?.credential;
        const environmentId =
          credential?.kind === "held" ? credential.environmentId : recorded.get(key);
        if (environmentId !== undefined) next.add(environmentId);
      }
    }
    for (const [environmentId, up] of downs) {
      if (next.has(environmentId)) continue;
      downs.delete(environmentId);
      up();
    }
    for (const environmentId of next) {
      if (!downs.has(environmentId)) downs.set(environmentId, admission.down(environmentId));
    }
  };

  const start = (built: EnvironmentStores): EnvironmentStage => {
    stores = built;
    const { records, containers, driver } = built;
    route = ports.route?.() ?? route;
    preferRoute();
    const stops: Array<() => void> = [];
    driver.setVisible(!options.hidden);
    containers.setVisible(!options.hidden);
    // HQ's word before the listing's first targets, so no Mate it holds online — nor a project it
    // speaks for and does not — is read on sight; what it speaks for before what it holds online,
    // as HQ's answer reads what waited for it.
    const updateHqScope = () => {
      const organizationId = ports.hqOrganization?.read() ?? null;
      const spoken = listings.find((entry) => entry.organizationId === organizationId);
      containers.setHqScope(
        spoken === undefined
          ? null
          : new Set(heldCandidates(spoken.listing).rows.map((row) => row.project.id)),
      );
    };
    const updateOnline = () => {
      updateHqScope();
      containers.setOnline(ports.online === undefined ? new Set() : ports.online.read());
    };
    updateOnline();
    const holdBackground = () => driver.holdBackground(ports.pressInFlight?.read() ?? false);
    holdBackground();
    stops.push(
      bindContainerStore(containers, driver),
      containers.subscribe(() => {
        updateRoute();
        updateActions();
        updateProcesses();
        updateDowns();
        notify();
      }),
      driver.subscribe(() => {
        updateRoute();
        updateActions();
        updateDowns();
        // A credential its machine let go — an install that failed, a retirement — is released.
        release();
        updateParking();
        notify();
      }),
      ports.records.listen(registrationsChanged),
      ports.pressInFlight?.subscribe(holdBackground) ?? (() => undefined),
      ports.hqIndex?.subscribe(() => {
        updateRoute();
        updateActions();
      }) ?? (() => undefined),
      ports.online?.subscribe(updateOnline) ?? (() => undefined),
      ports.hqOrganization?.subscribe(updateOnline) ?? (() => undefined),
      ports.catalog.listen({
        environments: (next) => {
          registered = next;
          release();
          updateParking();
        },
        link: (environmentId, phase) => driver.link(environmentId, phase),
      }),
      atomRegistry.subscribe(
        candidateListingsAtom(data),
        (next) => {
          const before = listings;
          listings = next;
          updateHqScope();
          const listedRows = next.flatMap(({ listing }) => heldCandidates(listing).rows);
          const moved = !sameItems(rows, listedRows);
          if (moved) rows = listedRows;
          // The route's target first, so its container is read before any other's.
          updateRoute();
          updateActions();
          if (moved || JSON.stringify(before.map(settling)) !== JSON.stringify(next.map(settling)))
            updateTargets();
        },
        { immediate: true },
      ),
    );
    updateTargets();
    release();
    updateParking();

    const environments: AccountEnvironments = {
      machines: driver.machines,
      containers: containers.machines,
      records: records.list,
      index: indexOf,
      subscribe: (listener) => {
        if (closed) return () => undefined;
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      // The person's Connect holds the Mate until it answers; one it connected off the route and
      // the screen stays as the Mate left last.
      connect: (key, reason) => {
        const letGo = driver.hold(key, "user");
        return driver.connect(key, reason).then((outcome) => {
          if (outcome._tag === "Connected" && !viewed.includes(key)) keepRecent(key);
          letGo();
          return outcome;
        });
      },
      hold: (environmentId) => {
        if (closed) return () => undefined;
        const action: ActionLease = { environmentId, key: null, letGo: null };
        actions.add(action);
        updateActions();
        return () => {
          if (actions.delete(action)) action.letGo?.();
        };
      },
      intend: (key, intent) => {
        if (closed) return false;
        containers.intend(key, intent);
        return (containers.machine(key)?.intent ?? null) !== null;
      },
      initAt: (key) => (closed ? Promise.resolve(null) : containers.initAt(key)),
      next: containers.next,
      setRoute: (environmentId) => {
        route = environmentId;
        preferRoute();
        updateRoute();
      },
      setActiveOrganization: (organizationId) => {
        activeOrganization = organizationId;
      },
      setOnScreen: (projectId) => {
        if (onScreen === projectId) return;
        onScreen = projectId;
        updateRoute();
      },
    };

    return {
      environments,
      grant: (view) => {
        if (closed) return;
        driver.setAccount({
          postGrant: true,
          identityMint: identityMint(view.machine),
          zeropsFailing: false,
          grantVerifiedAtMs: null,
        });
      },
      hear: (signal) => {
        if (closed) return;
        switch (signal.type) {
          case "visibility":
            driver.setVisible(!signal.hidden);
            containers.setVisible(!signal.hidden);
            return;
          case "network":
            if (signal.online) driver.online();
            return;
          case "wake":
            driver.wake(signal.visible);
            containers.wake(signal.visible);
            return;
          case "restored":
            // The account hears a restore through the visible wake that comes with it.
            return;
        }
      },
      request: (key) => {
        if (!closed) containers.request(key);
      },
      dispose: () => {
        if (closed) return;
        closed = true;
        listeners.clear();
        for (const stop of stops) stop();
        for (const followed of activity.values()) followed.stop();
        activity.clear();
        recent?.disarm();
        actions.clear();
        for (const release of checks.values()) release();
        checks.clear();
        driver.dispose();
        containers.dispose();
        preferRoute();
        updateDowns();
      },
    };
  };

  return { containerPorts, driverPorts, start };
}

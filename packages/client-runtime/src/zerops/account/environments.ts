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
 * - Restore is the records' demand, auto-connect the active organization's ready Mates (D13), and
 *   the route's target is found through its record or the descriptor index, which a route nothing
 *   names sweeps once (§4.8).
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

import { selectAutoConnectTargets } from "../autoConnect.ts";
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
import { containerSnapshotOf } from "../environments/containerRows.ts";
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
    /** The supervisor's `retryNow` for a link in backoff. */
    readonly retryLink: (environmentId: EnvironmentId) => void;
    /** `catalog.remove`: the registration is released; drafts keep their keys (AL-13). */
    readonly remove: (environmentId: EnvironmentId) => void;
  };
  /** Reads a Mate origin's descriptor and `/healthz`; rejects when the signal aborts it. */
  readonly probe: ContainerStorePorts["probe"];
  /** This tab's container intents (C8). */
  readonly intents: IntentStorage;
  /** The account's storage of its records (C1), and another tab's write of them. */
  readonly records: RecordsStorage & { readonly listen: (changed: () => void) => () => void };
  /** The connection catalog: which environments are registered, and their links. */
  readonly catalog: { readonly listen: (listener: CatalogListener) => () => void };
  /** The account's births (C9): whose Mate may not be wanted yet, and whose connect ends one. */
  readonly births: {
    /** Projects whose birth has not closed them off yet. */
    readonly unhardened: () => ReadonlySet<string>;
    readonly subscribe: (listener: () => void) => () => void;
    /** The connect named the environment: the birth is over. */
    readonly promote: (projectId: string) => void;
  };
  /**
   * The environment the tab's route names as the stage starts — the reload's address — so the
   * route's target is wanted before the records and auto-connect fill the exchange slots; a
   * surface's `setRoute` follows it. Absent: the route is only what `setRoute` names.
   */
  readonly route?: () => EnvironmentId | null;
  /** The tab's socket admission (`connection/admission.ts`): the route's socket opens first. */
  readonly admission?: Pick<ConnectionAdmission, "prefer" | "down">;
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
   * The user's Connect: the target is wanted from now on, and this is a user retry. Answers
   * with the installed environment, or with the verdict the machine settled on instead.
   */
  readonly connect: (key: TargetKey, reason: IdentityExchangeReason) => Promise<ConnectOutcome>;
  /**
   * Our verb was accepted for this target: its container shows it until a read fact settles it.
   * False when no container took it — the store holds no such target, or the platform's facts
   * already overrule it — so nothing will say when it is over.
   */
  readonly intend: (key: TargetKey, intent: IntentRequest) => boolean;
  /** The reading of a probe of this origin started from now on, through the account's pool. */
  readonly next: (origin: string) => Promise<ProbeReading>;
  /** The route's environment, whose target is exchanged first (§4.4); null off a thread route. */
  readonly setRoute: (environmentId: EnvironmentId | null) => void;
  /** The organization the tab has open: auto-connect wants its ready Mates (D13). */
  readonly setActiveOrganization: (organizationId: string | null) => void;
  /**
   * The project whose Mate is on screen — its own view, its conversation — or null: it is
   * connected past auto-connect's ceiling, which is for Mates not on screen.
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
      data.resources,
      { kind: "service", project, serviceId: ZeropsServiceId.make(serviceId) },
      options.services,
    );
  };

  const containerPorts: ContainerStorePorts = {
    clock: ports.clock,
    probe: ports.probe,
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
   * The births the records end: a record is the exchange's word that it named the Mate's
   * environment, so a birth this browser still holds for its project is over — however it was
   * left behind. Each project once per stage.
   */
  const ended = new Set<string>();
  const endBirth = (projectId: string) => {
    if (ended.has(projectId)) return;
    ended.add(projectId);
    ports.births.promote(projectId);
  };
  const endRecordedBirths = () => {
    if (stores === null || closed) return;
    for (const record of stores.records.list()) {
      if (record.projectRef !== null) endBirth(record.projectRef.projectId);
    }
  };

  /** The records, or the installs that write them, changed. */
  const registrationsChanged = () => {
    endRecordedBirths();
    updateRoute();
    updateTargets();
    release();
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
      // The birth is over: the exchange named its environment.
      if (project !== undefined) endBirth(project.id);
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
    retryLink: ports.door.retryLink,
    // The inventory of the organization that lists the target's project, or of the active one
    // when nothing names it (§6.2).
    refreshPresence: (key) => {
      const organizationId = organizationOf(key) ?? activeOrganization;
      if (organizationId === null) return;
      run(
        options.invalidations.invalidate({
          topic: "inventory",
          organization: organizationRef(organizationId),
        }),
      );
    },
    retire: (_key, environmentId) => {
      if (environmentId !== null) ports.door.remove(environmentId);
    },
  };

  // ── Feeding the stores ─────────────────────────────────────────────────────────────────────

  /**
   * Every target, its presence and its container, and the records' demand. An absence that
   * begins a wait has its project's services read on their own, lag-free (§9 C19): the
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
    stores.driver.setDemand(
      "record",
      records.map((record) => record.targetKey),
    );
  };

  /** The active organization's ready Mates, capped, none a birth still holds (D13). */
  const updateAutoConnect = () => {
    if (stores === null || closed) return;
    const listed = listings.find(({ organizationId }) => organizationId === activeOrganization);
    const byOrigin = new Map(
      registered.flatMap((environment) =>
        environment.origin === null
          ? []
          : [[environment.origin, environment.environmentId] as const],
      ),
    );
    const active = listed === undefined ? [] : heldCandidates(listed.listing).rows;
    // The Mate on screen, from whichever organization lists it.
    const shown =
      onScreen === null || active.some((row) => row.project.id === onScreen)
        ? []
        : listings
            .flatMap(({ listing }) => heldCandidates(listing).rows)
            .filter((row) => row.project.id === onScreen);
    const candidates = [...active, ...shown].map((row) => {
      const environmentId = byOrigin.get(origin(row.containerOrigin) ?? "");
      return environmentId === undefined ? row : { ...row, environmentId };
    });
    stores.driver.setDemand(
      "auto-connect",
      selectAutoConnectTargets({
        candidates,
        health: containerSnapshotOf(stores.containers.machines()).health,
        birthProjectIds: ports.births.unhardened(),
        onScreenProjectId: onScreen,
      }),
    );
  };

  /**
   * The route's target, wanted first: the one its record remembers, else the one the descriptor
   * index finds. While nothing names the route's environment, each present target read without
   * an answer is read once more, once per route (§4.8's sweep, `sweepRead`): on its poll when one
   * reads it, a poll interval after the failure the sweep saw, else at once. An unreachable one
   * that fails that read too has answered for the index.
   */
  const updateRoute = () => {
    if (stores === null || closed) return;
    if (swept.route !== route) swept = { route, keys: new Map() };
    if (route === null) {
      routeKey = null;
      stores.driver.setDemand("route", []);
      return;
    }
    const machines = stores.driver.machines();
    const index = indexOf();
    const resolved = resolveEnvironment(machines, index, route);
    const key =
      stores.records.list().find((record) => record.environmentId === route)?.targetKey ??
      resolved?.key;
    routeKey = key ?? null;
    stores.driver.setDemand("route", key === undefined ? [] : [key]);
    if (resolved !== undefined) return;
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
    endRecordedBirths();
    route = ports.route?.() ?? route;
    preferRoute();
    const stops: Array<() => void> = [];
    driver.setVisible(!options.hidden);
    containers.setVisible(!options.hidden);
    stops.push(
      bindContainerStore(containers, driver),
      containers.subscribe(() => {
        updateAutoConnect();
        updateRoute();
        updateProcesses();
        updateDowns();
        notify();
      }),
      driver.subscribe(() => {
        updateRoute();
        updateDowns();
        // A credential its machine let go — an install that failed, a retirement — is released.
        release();
        notify();
      }),
      ports.records.listen(registrationsChanged),
      ports.births.subscribe(updateAutoConnect),
      ports.catalog.listen({
        environments: (next) => {
          registered = next;
          release();
          updateAutoConnect();
        },
        link: (environmentId, phase) => driver.link(environmentId, phase),
      }),
      atomRegistry.subscribe(
        candidateListingsAtom(data),
        (next) => {
          const before = listings;
          listings = next;
          const listedRows = next.flatMap(({ listing }) => heldCandidates(listing).rows);
          const moved = !sameItems(rows, listedRows);
          if (moved) rows = listedRows;
          // The route's target first, so its container is read before any other's.
          updateRoute();
          if (moved || JSON.stringify(before.map(settling)) !== JSON.stringify(next.map(settling)))
            updateTargets();
          if (moved) updateAutoConnect();
        },
        { immediate: true },
      ),
    );
    updateTargets();
    release();

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
      connect: driver.connect,
      intend: (key, intent) => {
        if (closed) return false;
        containers.intend(key, intent);
        return (containers.machine(key)?.intent ?? null) !== null;
      },
      next: containers.next,
      setRoute: (environmentId) => {
        route = environmentId;
        preferRoute();
        updateRoute();
      },
      setActiveOrganization: (organizationId) => {
        activeOrganization = organizationId;
        updateAutoConnect();
      },
      setOnScreen: (projectId) => {
        if (onScreen === projectId) return;
        onScreen = projectId;
        updateAutoConnect();
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

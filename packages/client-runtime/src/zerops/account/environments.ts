/**
 * The Mate environments of the post-grant stage (DESIGN §4.4, §4.5, §4.8, §5): how the account
 * runtime feeds the Mate adapter it built (`data/adapters/mate.ts`), and what surfaces ask of it.
 *
 * - Every target's presence comes from the account's listing — the projects of the organization
 *   the account observes, as its store lists them, and their services as the account's store reads
 *   them (B4, `mateListingsAtom`) — and from the sessions kept for its Mates (C1). A remembered
 *   Mate is looked for where its kept session opened until its project's services are read (A16);
 *   one they were read without is gone only once a direct read lacks it too (§9 C19). A listing
 *   change that changes no row and settles no absence feeds nothing. No React holds a fact here:
 *   the web and mobile hand over ports and send intents — the route, the active organization, a
 *   Connect.
 * - The account's guards come from its grant, the tab from the account's signals, a container's
 *   re-read from the account's bus.
 * - A Mate is connected while it holds a lease (krok-a-hub §3): the route's and the screen's, the
 *   one left last for `RECENT_MS`, an action's, a Connect's, a page's that draws every Mate
 *   (Usage). Only those Mates are read; the rest read their containers from the platform's
 *   statuses. The route's target is found through its kept session, the Mates already read, the
 *   catalog's address or HQ — never by reading other projects. A remembered Mate with no lease is
 *   parked: its registration, kept session and cached data stay, its socket closes.
 * - A registration no Mate holds — and that no install is writing — is released.
 * - Nobody is let into a Mate before its project is closed off (`closeOff.ts`): a Mate whose
 *   container carries the press's marker, and whose project HQ does not say is closed off, holds
 *   no lease's connection until it is; *Finish setup* closes it off.
 *
 * The adapter is constructed by the account runtime alone (§7.2 rule 6); this module only wires
 * it. Plain callbacks and promises, like the adapter: the one Effect it runs is the data
 * runtime's, with the account's services.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import type { ConnectionAdmission } from "../../connection/admission.ts";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { AtomRegistry } from "effect/unstable/reactivity";

import type { MateAdapter, MateAdapterPorts, MateTarget } from "../../data/adapters/mate.ts";
import type { ProjectProcesses } from "../../data/projections/processes.ts";
import {
  holdMateVariables,
  holdProjectHistory,
  holdServiceRead,
  mateVariablesAtom,
  projectProcessesAtom,
  readMateFlag,
} from "../../data/reads.ts";

import { normalizeOrigin } from "../candidates.ts";
import { identityMint } from "../data/access/capabilities.ts";
import type { AccessGrantView } from "../data/access/grantDriver.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import {
  ZeropsOrganizationId,
  ZeropsProjectId,
  type OrganizationRef,
  type ProjectRef,
  type LeaseAdmissionError,
} from "../data/types.ts";
import type { IdentityExchangeReason } from "../diagnostics.ts";
import {
  platformSaysDown,
  type ContainerMachine,
  type MateFlag,
} from "../environments/containerMachine.ts";
import type { AccountStore } from "../../data/store.ts";
import { type IntentRequest, type IntentStorage } from "../environments/exchange.ts";
import {
  indexDescriptors,
  resolveEnvironment,
  type DescriptorIndex,
} from "../environments/descriptorIndex.ts";
import {
  closedOffOf,
  closeOffGate,
  type CloseOffHold,
  type CloseOffWord,
} from "../environments/closeOff.ts";
import { mateListingsAtom, type OrganizationListing } from "../environments/listings.ts";
import type {
  DescriptorFacts,
  EnvironmentMachine,
  LinkPhase,
} from "../environments/environmentMachine.ts";
import type {
  ConnectOutcome,
  ExchangeClock,
  ExchangeRequest,
  InstallOutcome,
  TargetKey,
} from "../environments/exchange.ts";
import type { ProbeReading } from "../environments/probe.ts";
import {
  containerTargetsOf,
  listTargets,
  targetProject,
  type RememberedTarget,
} from "../environments/targets.ts";
import type { ExchangeAnswer } from "../identityExchange.ts";
import type { InvalidationBus } from "../knowledge/invalidation.ts";
import type { PlatformSignal } from "../knowledge/signals.ts";
import { finishedEnableAt, heldCandidates, type CandidateRow } from "../projections/candidates.ts";

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
  /**
   * Reads a Mate origin's descriptor and `/healthz` (`mateContainerReads`); rejects when the signal
   * aborts it.
   */
  readonly probe: MateAdapterPorts<DoorCredential>["probe"];
  /** Reads a Mate origin's `/healthz` `initAt` alone, before a restart verb is sent. */
  readonly readInitAt: MateAdapterPorts<DoorCredential>["readInitAt"];
  /** This tab's container intents (C8). */
  readonly intents: IntentStorage;
  /**
   * The Mates whose session an earlier load kept (C1): where each was reached, and the environment
   * it serves. A route to one is found with no read. Absent: none is kept.
   */
  readonly remembered?: () => ReadonlyArray<RememberedTarget>;
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
   * it, with no descriptor sweep. Null where HQ names none, or is not read.
   */
  readonly hqIndex: {
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
   * HQ's word on which Mates' projects are closed off (`closeOff.ts`); null while none is known,
   * and always on a surface no HQ answers: then only `closeOffPending` holds a Mate.
   */
  readonly closeOff: {
    readonly read: () => CloseOffWord | null;
    readonly subscribe: (listener: () => void) => () => void;
  };
  /**
   * The projects this browser knows are not closed off yet — a press here that runs, or stopped
   * before its close-off: where HQ says nothing, only these are held (`closeOffGate`).
   */
  readonly closeOffPending: {
    readonly read: () => ReadonlySet<string>;
    readonly subscribe: (listener: () => void) => () => void;
  };
}

export type { CloseOffHold };

// ── What surfaces read and ask ───────────────────────────────────────────────────────────────

export interface AccountEnvironments {
  /** Projects whose detail is currently held by a route, screen, or action. */
  readonly detailProjects: () => ReadonlySet<string>;
  /** Why the route or screen's project inventory demand ended before it was admitted. */
  readonly detailFailure: (projectId: string) => LeaseAdmissionError | null;
  /** One explicit new attempt at a refused project inventory demand. */
  readonly retryDetail: (projectId: string) => void;
  /**
   * Told after the detail, the close-off holds or a Mate moved. Each Mate itself is read from the
   * account's store (`mateLinks`).
   */
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
  /** Suppress all connection leases during project deletion; false restores them on failure. */
  readonly setDeleting: (projectId: string, deleting: boolean) => void;
  /**
   * The projects whose Mate is held for its close-off, and why: none of their leases connects it
   * until HQ says its project is closed off. The same map until it changes.
   */
  readonly closeOffHolds: () => ReadonlyMap<string, CloseOffHold>;
  /** The route's environment, whose target is exchanged first (§4.4); null off a thread route. */
  readonly setRoute: (environmentId: EnvironmentId | null) => void;
  /** The organization the tab has open: a target nothing names has its inventory read (§6.2). */
  readonly setActiveOrganization: (organizationId: string | null) => void;
  /**
   * The project whose Mate is on screen — its own view, its birth — or null: it holds the
   * screen's lease, asked for as the route's is but capped and held while hidden as no route is.
   */
  readonly setOnScreen: (projectId: string | null) => void;
  /**
   * The environments of every Mate a page draws — Usage — or none: each is wanted in the background
   * while named, its project holding the project inventory a route's holds; replaced whole.
   */
  readonly setDrawn: (environmentIds: ReadonlyArray<EnvironmentId>) => void;
}

/** What the account runtime drives the stage with, besides its adapter. */
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

export interface EnvironmentWiring {
  readonly adapterPorts: MateAdapterPorts<DoorCredential>;
  /** Starts feeding the Mate adapter the runtime built from these ports. */
  readonly start: (adapter: MateAdapter) => EnvironmentStage;
}

export interface EnvironmentWiringOptions {
  readonly ports: AccountEnvironmentPorts;
  /** The account's store: the Mate adapter writes what it reads of each Mate there. */
  readonly store: AccountStore;
  readonly data: ManagedZeropsDataRuntime;
  readonly atomRegistry: AtomRegistry.AtomRegistry;
  readonly invalidations: InvalidationBus;
  /** The account's services, which the data runtime's reads and the bus run with. */
  readonly services: Context.Context<never>;
  /** Whether the tab is hidden when the stage starts. */
  readonly hidden: boolean;
}

// ── The listings ─────────────────────────────────────────────────────────────────────────────

/** What `listTargets` reads of a listing besides its rows: whether it can settle an absence. */
const settling = (listed: OrganizationListing) => ({
  state: listed.listing.state,
  coverage: listed.listing.state === "known" ? listed.listing.coverage : null,
});

const sameItems = <T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>): boolean =>
  left.length === right.length && left.every((item, index) => item === right[index]);

/** Whether a process the activity feed reads as running runs on the row's container. */
const runningOn = (activity: ProjectProcesses, row: CandidateRow): boolean =>
  activity.running.some(
    (process) => row.service === undefined || process.serviceStackIds.includes(row.service.id),
  );

const origin = (url: string | undefined | null): string | null =>
  url === undefined || url === null ? null : normalizeOrigin(url);

/** How long the Mate left last stays connected (krok-a-hub §3, the warm policy Q8). */
const RECENT_MS = 5 * 60_000;

// ── The wiring ───────────────────────────────────────────────────────────────────────────────

export function makeEnvironmentWiring(options: EnvironmentWiringOptions): EnvironmentWiring {
  const { ports, data, atomRegistry } = options;
  const run = Effect.runForkWith(options.services);
  let adapter: MateAdapter | null = null;
  let closed = false;
  let listings: ReadonlyArray<OrganizationListing> = [];
  let rows: ReadonlyArray<CandidateRow> = [];
  let registered: ReadonlyArray<RegisteredEnvironment> = [];
  /** The environments the catalog held when it first spoke: registered by an earlier load. */
  let inherited: ReadonlySet<EnvironmentId> | null = null;
  let route: EnvironmentId | null = null;
  /** The route's target, as `updateRoute` last found it; its container is read first. */
  let routeKey: TargetKey | null = null;
  let activeOrganization: string | null = null;
  let onScreen: string | null = null;
  /** The environments a page that draws every Mate names (`setDrawn`). */
  let drawn: ReadonlyArray<EnvironmentId> = [];
  /** The targets `drawn` resolved to, as the driver was last told. */
  let drawnKeys: ReadonlyArray<TargetKey> = [];
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
  /** What runs in each booting target's project, as the account's store holds it: followed. */
  const activity = new Map<string, { readonly stop: () => void }>();
  const listeners = new Set<() => void>();
  const detailLeases = new Map<string, Fiber.Fiber<void>>();
  /**
   * The processes each project of the active organization is read for while a container of it is
   * ACTIVE without its address — the listing reads from them whether the platform is turning its
   * address on (`subdomainEnableIn`) — and, once its enable finished, a direct read of its services
   * after that, which says whether the record caught up: what lets each go.
   */
  const addressWatch = new Map<string, () => void>();
  /** The project lease each drawn Mate's project holds, so its Mate is listed (`updateDrawn`). */
  const drawnLeases = new Map<string, Fiber.Fiber<void>>();
  const detailFailures = new Map<string, LeaseAdmissionError>();
  let detailProjects: ReadonlySet<string> = new Set();
  /**
   * The press's marker on each listed Mate's container whose project HQ says is not closed off,
   * by service id, as its own variables' read says it: followed only while such a Mate is listed.
   */
  const markers = new Map<
    string,
    { marker: boolean | "unknown" | "unread"; readonly stop: () => void }
  >();
  let closeOffHolds: ReadonlyMap<string, CloseOffHold> = new Map();
  /** The read of each followed Mate's container's variables its undecided marker holds. */
  const markerReads = new Map<string, () => void>();
  let markerSyncQueued = false;
  /**
   * A followed Mate's container's variables are read while its marker is undecided, one read per
   * container. Run after the gate's pass, never inside it: holding a read may answer at once, and
   * the answer runs the gate again.
   */
  const syncMarkerReads = () => {
    markerSyncQueued = false;
    if (closed) return;
    for (const [serviceId, release] of markerReads) {
      const followed = markers.get(serviceId);
      // Still followed and undecided: the read stays.
      if (followed !== undefined && typeof followed.marker !== "boolean") continue;
      markerReads.delete(serviceId);
      release();
    }
    for (const [serviceId, { marker }] of markers)
      if (typeof marker !== "boolean" && !markerReads.has(serviceId))
        markerReads.set(serviceId, holdMateVariables(atomRegistry, serviceId));
  };

  const rowOf = (key: TargetKey) => rows.find((row) => row.key === key);
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
    const organizationId = listed?.organizationId ?? activeOrganization;
    return organizationId === null || organizationId === undefined
      ? undefined
      : {
          kind: "project",
          organization: organizationRef(organizationId),
          projectId: ZeropsProjectId.make(projectId),
        };
  };
  const notify = () => {
    for (const listener of listeners) listener();
  };

  // ── The adapter's ports ────────────────────────────────────────────────────────────────────

  /** `ZCP_MATE_ENABLED` for a target's service, read by key with the organization's Mate variables. */
  const readTargetMateFlag = async (key: TargetKey): Promise<MateFlag> => {
    const serviceId = key.split(":")[1];
    return serviceId === undefined ? "unknown" : readMateFlag(atomRegistry, serviceId);
  };

  /** Whose organization lists the target's project: the listing's, else the one shown. */
  const organizationOf = (key: TargetKey): string | null =>
    listingOf(targetProject(key))?.organizationId ?? activeOrganization;

  /**
   * The Mates this account reached before (C1): each a session kept from an earlier load names,
   * and each the catalog held as the stage started at a listed Mate's address — a device's catalog
   * outlives its app — unless a kept session already names its target.
   */
  const remembered = (): ReadonlyArray<RememberedTarget> => {
    const kept = ports.remembered?.() ?? [];
    const served = registered.flatMap((entry): ReadonlyArray<RememberedTarget> => {
      if (entry.origin === null || inherited?.has(entry.environmentId) !== true) return [];
      const row = rows.find((candidate) => origin(candidate.containerOrigin) === entry.origin);
      if (row === undefined || kept.some(({ targetKey }) => targetKey === row.key)) return [];
      return [
        {
          targetKey: row.key,
          environmentId: entry.environmentId,
          origin: entry.origin,
          orgId: null,
        },
      ];
    });
    return [...kept, ...served];
  };

  /** Each Mate's machines as the adapter holds them now. */
  const machinesNow = () => adapter?.environments() ?? new Map<TargetKey, EnvironmentMachine>();

  /**
   * A registration nothing remembers, that no install is writing and that no machine holds, is
   * released — once every listing is whole, so a registration at a Mate not listed yet is not
   * taken for one at no Mate. A held one is the Mate's live link; once its machine lets it go, it
   * is released like any other.
   */
  const release = () => {
    if (adapter === null || closed) return;
    const whole =
      listings.length > 0 &&
      listings.every(({ listing }) => listing.state === "known" && listing.coverage === "complete");
    const held = new Set([
      ...remembered().map((entry) => entry.environmentId),
      ...[...machinesNow().values()].flatMap((machine) =>
        machine.credential.kind === "held" ? [machine.credential.environmentId] : [],
      ),
    ]);
    for (const environment of registered) {
      if (held.has(environment.environmentId)) continue;
      if (!whole) continue;
      if (environment.origin !== null && installing.has(environment.origin)) continue;
      ports.door.remove(environment.environmentId);
    }
  };

  /**
   * A registration whose Mate holds no lease is parked (krok-a-hub §3): its socket closes, and its
   * registration, kept session and cached data stay. A leased one is unparked: it connects on the
   * credential it holds, with no door. One no machine holds is left to `release`.
   */
  const updateParking = () => {
    if (adapter === null || closed) return;
    const known = new Set<EnvironmentId>();
    const leased = new Set<EnvironmentId>();
    for (const machine of machinesNow().values()) {
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
    const projectId = ports.hqIndex.projectOf(environmentId);
    if (projectId === null) return null;
    return (
      rows.find((row) => row.project.id === projectId && row.service !== undefined)?.key ?? null
    );
  };

  /** The listed Mate served at the address the catalog registered an environment at. */
  const servedTarget = (environmentId: EnvironmentId): TargetKey | null => {
    const at = registered.find((entry) => entry.environmentId === environmentId)?.origin ?? null;
    if (at === null) return null;
    return rows.find((row) => origin(row.containerOrigin) === at)?.key ?? null;
  };

  /**
   * The target an environment names: the one its kept session names, else the one the descriptor
   * index finds, else the listed Mate at the address the catalog holds it at, else the one HQ's
   * index names.
   */
  const targetOf = (environmentId: EnvironmentId): TargetKey | null =>
    remembered().find((entry) => entry.environmentId === environmentId)?.targetKey ??
    resolveEnvironment(machinesNow(), indexOf(), environmentId)?.key ??
    servedTarget(environmentId) ??
    hintedTarget(environmentId);

  /** The project an environment's Mate serves, before its target is listed: HQ's word at least. */
  const projectOfEnvironment = (environmentId: EnvironmentId): string | null => {
    const key = targetOf(environmentId);
    return key === null ? ports.hqIndex.projectOf(environmentId) : targetProject(key);
  };

  /** Each action holds the target its environment names now; one nothing names yet waits. */
  const updateActions = () => {
    if (adapter === null || closed) return;
    for (const action of actions) {
      const key = targetOf(action.environmentId);
      if (key === action.key) continue;
      action.letGo?.();
      action.key = key;
      action.letGo = key === null ? null : adapter.hold(key, "action");
    }
  };

  /**
   * A page that draws every Mate wants the targets its environments name now, in the background,
   * and none of them becomes the Mate left last. On a cold load no project is opened, so — as the
   * route's is — each environment's project is found through its kept session or HQ, and holds a
   * project lease that admits it and lists its Mate. One nothing names yet waits.
   */
  const updateDrawn = () => {
    if (adapter === null || closed) return;
    const projects = new Set(
      drawn.flatMap((environmentId) => {
        const projectId = projectOfEnvironment(environmentId);
        return projectId !== null &&
          projectRefOf(projectId)?.organization.organizationId === activeOrganization
          ? [projectId]
          : [];
      }),
    );
    for (const [id, fiber] of drawnLeases) {
      if (projects.has(id)) continue;
      drawnLeases.delete(id);
      run(Fiber.interrupt(fiber));
    }
    for (const id of projects) {
      const project = projectRefOf(id);
      if (drawnLeases.has(id) || project === undefined) continue;
      // A refused lease is not held as taken: the page's next demand asks for it again.
      let refused = false;
      const fiber = run(
        Effect.scoped(
          data.acquire({ kind: "project-inventory", project }).pipe(Effect.andThen(Effect.never)),
        ).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              refused = true;
              if (drawnLeases.get(id) === fiber) drawnLeases.delete(id);
            }),
          ),
        ),
      );
      if (!refused) drawnLeases.set(id, fiber);
    }
    const keys = drawn.flatMap((environmentId) => targetOf(environmentId) ?? []);
    if (keys.length === drawnKeys.length && keys.every((key, at) => key === drawnKeys[at])) return;
    drawnKeys = keys;
    adapter.setDemand("drawn", keys);
    updateAddressWatch();
  };

  const install: MateAdapterPorts<DoorCredential>["install"] = async ({ key, credential }) => {
    const at = exchangedAt.get(key) ?? null;
    if (at !== null) installing.set(at, (installing.get(at) ?? 0) + 1);
    try {
      return await credential.install();
    } finally {
      if (at !== null) {
        const remaining = (installing.get(at) ?? 1) - 1;
        if (remaining === 0) installing.delete(at);
        else installing.set(at, remaining);
      }
      if (!closed) {
        release();
        updateParking();
      }
    }
  };

  const adapterPorts: MateAdapterPorts<DoorCredential> = {
    store: options.store,
    clock: ports.clock,
    exchange: (request) => {
      const organizationId = organizationOf(request.key);
      // A target read at the address its kept session opened at is exchanged in the project its
      // key names.
      const rememberedHere =
        adapter?.machines(request.key)?.environment.presence.kind === "remembered";
      // The listing no longer names this target: its presence is read again.
      if ((!rememberedHere && rowOf(request.key) === undefined) || organizationId === null) {
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
    retryLink: ports.door.retryLink,
    // A Mate gone from where the platform lists it — or removed by its person — leaves the
    // catalog, and its kept session with it: no later load reads it again.
    retire: (key, environmentId) => {
      if (environmentId !== null) ports.door.remove(environmentId);
      ports.door.forgetKept?.(key);
    },
    probe: ports.probe,
    readInitAt: ports.readInitAt,
    readMateFlag: readTargetMateFlag,
    intents: ports.intents,
  };

  // ── Feeding the adapter ────────────────────────────────────────────────────────────────────

  /** Every target, its presence and its container. */
  const updateTargets = () => {
    if (adapter === null || closed) return;
    const current = adapter;
    const kept = remembered();
    const listed = listTargets({
      listings,
      remembered: kept,
      lastPresence: (key) => current.machines(key)?.environment.presence ?? null,
    });
    const containers = new Map(
      containerTargetsOf(rows, listed.targets).map((target) => [target.key, target] as const),
    );
    current.setTargets(
      listed.targets.map((target): MateTarget => {
        const container = containers.get(target.key);
        const presence = target.presence;
        const orgId =
          listingOf(targetProject(target.key))?.organizationId ??
          kept.find((entry) => entry.targetKey === target.key)?.orgId ??
          null;
        return {
          key: target.key,
          orgId,
          presence,
          origin: container?.origin ?? (presence?.kind === "remembered" ? presence.origin : null),
          platform: container?.platform ?? null,
          record: target.record,
        };
      }),
    );
  };

  /** The Mate left last stays connected `RECENT_MS`, unless another is left after it. */
  const keepRecent = (key: TargetKey) => {
    if (adapter === null || closed) return;
    recent?.disarm();
    const disarm = ports.clock.setTimer(RECENT_MS, () => {
      if (recent?.disarm !== disarm || adapter === null || closed) return;
      recent = null;
      adapter.setDemand("recent", []);
    });
    recent = { key, disarm };
    adapter.setDemand("recent", [key]);
  };

  /** The route's and the screen's leases: a target that leaves both is the Mate left last. */
  const holdViewed = (onRoute: ReadonlyArray<TargetKey>, shown: ReadonlyArray<TargetKey>) => {
    const held = [...onRoute, ...shown];
    const left = viewed.find((key) => !held.includes(key));
    viewed = held;
    adapter!.setDemand("route", onRoute);
    adapter!.setDemand("screen", shown);
    updateAddressWatch();
    if (left !== undefined) keepRecent(left);
  };

  /** Hold detail only for the route, the project on screen, or an explicit action. */
  const updateRoute = () => {
    if (adapter === null || closed) return;
    const routedProject = route === null ? null : projectOfEnvironment(route);
    const actionProjects = [...actions].map(({ environmentId }) =>
      projectOfEnvironment(environmentId),
    );
    const wanted = new Set(
      [onScreen, routedProject, ...actionProjects].filter(
        (id): id is string =>
          id !== null && projectRefOf(id)?.organization.organizationId === activeOrganization,
      ),
    );
    const detailMoved =
      wanted.size !== detailProjects.size || [...wanted].some((id) => !detailProjects.has(id));
    if (detailMoved) {
      detailProjects = wanted;
      updateAddressWatch();
    }
    for (const [id, fiber] of detailLeases) {
      if (wanted.has(id)) continue;
      detailLeases.delete(id);
      detailFailures.delete(id);
      run(Fiber.interrupt(fiber));
    }
    for (const id of wanted) {
      if (detailLeases.has(id)) continue;
      const project = projectRefOf(id);
      if (project === undefined || project.organization.organizationId !== activeOrganization)
        continue;
      detailLeases.set(
        id,
        run(
          Effect.scoped(
            data.acquire({ kind: "project-inventory", project }).pipe(Effect.andThen(Effect.never)),
          ).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                detailFailures.set(id, error);
                notify();
              }),
            ),
          ),
        ),
      );
    }
    const shown = rows.flatMap((row) => (row.project.id === onScreen ? [row.key] : []));
    if (route === null) {
      routeKey = null;
      holdViewed([], shown);
      if (detailMoved) notify();
      return;
    }
    const key = targetOf(route);
    routeKey = key;
    holdViewed(key === null ? [] : [key], shown);
    if (detailMoved) notify();
  };

  /**
   * The platform's processes for every booting target's project: a boot's cap runs from the
   * moment the last process ends (§4.5), so a long restart or start is never overdue while it runs.
   */
  const updateProcesses = () => {
    if (adapter === null || closed) return;
    const booting = new Map<string, ProjectRef>();
    for (const [key, machine] of adapter.containers()) {
      if (machine.state.level !== "booting") continue;
      const projectId = targetProject(key);
      if (!detailLeases.has(projectId)) continue;
      const ref = projectRefOf(projectId);
      if (ref !== undefined) booting.set(projectId, ref);
    }
    for (const [projectId, followed] of activity) {
      if (booting.has(projectId)) continue;
      activity.delete(projectId);
      followed.stop();
    }
    for (const projectId of booting.keys()) {
      if (activity.has(projectId)) continue;
      const report = (read: ProjectProcesses) => {
        if (adapter === null || closed) return;
        for (const row of rows) {
          if (row.project.id === projectId) adapter.process(row.key, runningOn(read, row));
        }
      };
      const unsubscribe = atomRegistry.subscribe(projectProcessesAtom(projectId), report, {
        immediate: true,
      });
      activity.set(projectId, { stop: unsubscribe });
    }
  };

  /** One Mate's container's marker, followed from now until the gate lets it go. */
  const followMarker = (serviceId: string) => {
    const known = markers.get(serviceId);
    if (known !== undefined) return known;
    let ready = false;
    const held: { marker: boolean | "unknown" | "unread"; stop: () => void } = {
      marker: "unread",
      stop: () => undefined,
    };
    held.stop = atomRegistry.subscribe(
      mateVariablesAtom(serviceId),
      ({ marker }) => {
        if (held.marker === marker) return;
        held.marker = marker;
        if (ready) updateCloseOff();
      },
      { immediate: true },
    );
    ready = true;
    markers.set(serviceId, held);
    return held;
  };

  /**
   * The close-off gate over every listed Mate (`closeOffGate`): the held ones take no lease's
   * demand (`ExchangeDriver.setCloseOffHeld`).
   */
  const updateCloseOff = () => {
    if (adapter === null || closed) return;
    const word = ports.closeOff.read();
    const pending = ports.closeOffPending.read();
    const followed = new Set<string>();
    const holds = new Map<string, CloseOffHold>();
    for (const row of rows) {
      if (row.service === undefined) continue;
      const project = projectRefOf(row.project.id);
      if (project === undefined) continue;
      const closedOff = closedOffOf(word, project.organization.organizationId, row.project.id);
      if (closedOff === true) continue;
      // The marker decides only where HQ says the project is not closed off (`closeOffGate`); one
      // followed stays while HQ's word lapses, so HQ's return finds it decided.
      const entry =
        closedOff === false || markers.has(row.service.id) ? followMarker(row.service.id) : null;
      if (entry !== null) followed.add(row.service.id);
      const gate = closeOffGate({
        marker: entry?.marker ?? "unread",
        closedOff,
        pendingHere: pending.has(row.project.id),
      });
      if (gate === "connect") continue;
      if (holds.get(row.project.id) !== "open") holds.set(row.project.id, gate);
    }
    for (const [serviceId, entry] of markers) {
      if (followed.has(serviceId)) continue;
      entry.stop();
      markers.delete(serviceId);
    }
    if (!markerSyncQueued) {
      markerSyncQueued = true;
      queueMicrotask(syncMarkerReads);
    }
    const moved =
      holds.size !== closeOffHolds.size ||
      [...holds].some(([projectId, hold]) => closeOffHolds.get(projectId) !== hold);
    if (!moved) return;
    closeOffHolds = holds;
    adapter.setCloseOffHeld(holds.keys());
    notify();
  };

  /**
   * Reads the processes — running, and the newest history — of every project a surface shows (the
   * route's, the drawn, the viewed, the detailed) of the active organization with a container
   * ACTIVE without its address, for as long as it lacks one: its address landing, the project
   * leaving view or the organization leaving view lets the read go. Navigation alone reads no
   * history. Each time an enable of such a container is read as finished, its service's own row is
   * read once after it: no push is promised to bring the record that caught up (8c076ec029).
   */
  const updateAddressWatch = () => {
    if (closed) return;
    const shown = new Set([
      ...[...drawnKeys, ...viewed, ...(routeKey === null ? [] : [routeKey])].map(targetProject),
      ...detailProjects,
    ]);
    const lacking = new Set<string>();
    for (const row of rows) {
      if (row.presence !== "known" || row.service?.status !== "ACTIVE") continue;
      if (row.containerOrigin !== undefined || !shown.has(row.project.id)) continue;
      const ref = projectRefOf(row.project.id);
      if (ref !== undefined && ref.organization.organizationId === activeOrganization)
        lacking.add(row.project.id);
    }
    for (const [projectId, stop] of addressWatch) {
      if (lacking.has(projectId)) continue;
      addressWatch.delete(projectId);
      stop();
    }
    for (const projectId of lacking) {
      if (addressWatch.has(projectId)) continue;
      const releaseHistory = holdProjectHistory(atomRegistry, projectId);
      // One read of its service's own row after each enable read as finished.
      let readAfter: string | null = null;
      let releaseRead: (() => void) | null = null;
      const recheck = (read: ProjectProcesses) => {
        if (closed) return;
        for (const row of rows) {
          if (row.project.id !== projectId || row.service === undefined) continue;
          if (row.containerOrigin !== undefined) continue;
          const at = finishedEnableAt(read, row.service.id);
          if (at === null || (readAfter !== null && at <= readAfter)) continue;
          readAfter = at;
          releaseRead?.();
          releaseRead = holdServiceRead(atomRegistry, row.service.id);
        }
      };
      const unsubscribe = atomRegistry.subscribe(projectProcessesAtom(projectId), recheck, {
        immediate: true,
      });
      addressWatch.set(projectId, () => {
        unsubscribe();
        releaseHistory();
        releaseRead?.();
      });
    }
  };

  // ── The index ──────────────────────────────────────────────────────────────────────────────

  let indexed: {
    readonly machines: ReadonlyMap<TargetKey, EnvironmentMachine>;
    readonly containers: ReadonlyMap<TargetKey, ContainerMachine>;
    readonly index: DescriptorIndex;
  } | null = null;
  const indexOf = (): DescriptorIndex => {
    const machines = adapter!.environments();
    const containers = adapter!.containers();
    if (indexed?.machines !== machines || indexed.containers !== containers) {
      indexed = {
        machines,
        containers,
        index: indexDescriptors(machines, containers),
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
    if (!closed && adapter !== null) {
      for (const [key, container] of adapter.containers()) {
        if (!platformSaysDown(container)) continue;
        const environment = adapter.environments().get(key);
        const environmentId =
          environment?.credential.kind === "held"
            ? environment.credential.environmentId
            : (environment?.record ?? null);
        if (environmentId !== null) next.add(environmentId);
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

  const start = (built: MateAdapter): EnvironmentStage => {
    adapter = built;
    route = ports.route?.() ?? route;
    preferRoute();
    const stops: Array<() => void> = [];
    built.setVisible(!options.hidden);
    const holdBackground = () => built.holdBackground(ports.pressInFlight?.read() ?? false);
    holdBackground();
    stops.push(
      built.subscribe(() => {
        updateRoute();
        updateActions();
        updateDrawn();
        updateProcesses();
        updateDowns();
        // A credential its machine let go — an install that failed, a retirement — is released.
        release();
        updateParking();
        notify();
      }),
      ports.pressInFlight?.subscribe(holdBackground) ?? (() => undefined),
      ports.hqIndex.subscribe(() => {
        updateRoute();
        updateActions();
        updateDrawn();
      }),
      ports.closeOff.subscribe(updateCloseOff),
      ports.closeOffPending.subscribe(updateCloseOff),
      ports.catalog.listen({
        environments: (next) => {
          registered = next;
          inherited ??= new Set(next.map(({ environmentId }) => environmentId));
          // An environment the catalog holds names its Mate by its address.
          updateRoute();
          updateActions();
          updateDrawn();
          release();
          updateParking();
        },
        link: (environmentId, phase) => built.link(environmentId, phase),
      }),
      atomRegistry.subscribe(
        mateListingsAtom(data),
        (next) => {
          const before = listings;
          listings = next;
          const listedRows = next.flatMap(({ listing }) => heldCandidates(listing).rows);
          const moved = !sameItems(rows, listedRows);
          if (moved) rows = listedRows;
          updateAddressWatch();
          updateRoute();
          updateActions();
          updateDrawn();
          if (moved || JSON.stringify(before.map(settling)) !== JSON.stringify(next.map(settling)))
            updateTargets();
          if (moved) updateCloseOff();
        },
        { immediate: true },
      ),
    );
    updateCloseOff();
    updateTargets();
    release();
    updateParking();

    const environments: AccountEnvironments = {
      detailProjects: () => detailProjects,
      detailFailure: (projectId) => detailFailures.get(projectId) ?? null,
      retryDetail: (projectId) => {
        if (closed || !detailFailures.delete(projectId)) return;
        detailLeases.delete(projectId);
        updateRoute();
        notify();
      },
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
        const letGo = built.hold(key, "user");
        return built.connect(key, reason).then((outcome) => {
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
        updateDrawn();
        updateRoute();
        return () => {
          if (actions.delete(action)) action.letGo?.();
          updateRoute();
        };
      },
      intend: (key, intent) => !closed && built.intend(key, intent),
      initAt: (key) => (closed ? Promise.resolve(null) : built.initAt(key)),
      next: built.next,
      setDeleting: built.setDeleting,
      closeOffHolds: () => closeOffHolds,
      setRoute: (environmentId) => {
        route = environmentId;
        preferRoute();
        updateRoute();
      },
      setActiveOrganization: (organizationId) => {
        activeOrganization = organizationId;
        updateRoute();
        updateDrawn();
        updateAddressWatch();
      },
      setOnScreen: (projectId) => {
        if (onScreen === projectId) return;
        onScreen = projectId;
        updateRoute();
      },
      setDrawn: (environmentIds) => {
        drawn = environmentIds;
        updateDrawn();
      },
    };

    return {
      environments,
      grant: (view) => {
        if (closed) return;
        built.setAccount({
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
            built.setVisible(!signal.hidden);
            return;
          case "network":
            if (signal.online) built.online();
            return;
          case "wake":
            built.wake(signal.visible);
            return;
          case "restored":
            // The account hears a restore through the visible wake that comes with it.
            return;
        }
      },
      request: (key) => {
        if (!closed) built.request(key);
      },
      dispose: () => {
        if (closed) return;
        closed = true;
        listeners.clear();
        for (const stop of stops) stop();
        for (const followed of activity.values()) followed.stop();
        activity.clear();
        for (const entry of markers.values()) entry.stop();
        markers.clear();
        for (const release of markerReads.values()) release();
        markerReads.clear();
        recent?.disarm();
        actions.clear();
        for (const fiber of detailLeases.values()) run(Fiber.interrupt(fiber));
        detailLeases.clear();
        for (const stop of addressWatch.values()) stop();
        addressWatch.clear();
        for (const fiber of drawnLeases.values()) run(Fiber.interrupt(fiber));
        drawnLeases.clear();
        detailFailures.clear();
        detailProjects = new Set();
        built.dispose();
        preferRoute();
        updateDowns();
      },
    };
  };

  return { adapterPorts, start };
}

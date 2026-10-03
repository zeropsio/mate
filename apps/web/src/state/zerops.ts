import {
  connectionCatalogDisplayUrl,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import {
  grantListing,
  projectGrantsOf,
  type ZeropsService,
  type ZeropsStatHistoryItem,
} from "@t3tools/client-runtime/zerops";
import { heldEvidence } from "@t3tools/client-runtime/zerops/account/runtime";
import {
  processRecordToActivityProcess,
  projectKeyOf,
  projectRecordToZeropsProject,
  serviceRecordToZeropsService,
  ZeropsProjectId,
  type HistoryReadView,
  type ManagedZeropsDataRuntime,
  type MetricWindow,
  type OrganizationRef,
  type ProjectRef,
  type ProjectTopologyRead,
  type ServiceRef,
  type UsageRead,
} from "@t3tools/client-runtime/zerops/data";
import {
  candidateListingsAtom,
  type RegistrationRecord,
} from "@t3tools/client-runtime/zerops/environments";
import {
  placeListing,
  placementsOf,
  type HqChanges,
  type HqEnvironment,
  type HqMates,
  type HqPlacement,
  type HqStructure,
} from "@t3tools/client-runtime/zerops/hq";
import type { Known, Shown } from "@t3tools/client-runtime/zerops/knowledge";
import {
  admittedOnly,
  takenBotNames,
  type TakenBotNames,
  heldCandidates,
  type CandidateRow,
} from "@t3tools/client-runtime/zerops/projections";
import { projectTopology, type ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
import type { EnvironmentId } from "@t3tools/contracts";
import type { HqPeople } from "@t3tools/shared/hqMates";
import type { OverviewLogins } from "@t3tools/shared/mateLink";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { registeredZeropsOrigins, rowEnvironment } from "../zerops/environmentOrigins";
import { createZeropsFeedAtoms } from "../zerops/feeds";
import { findInventoryProjectRef, type InventoryProjection } from "../zerops/inventoryContext";
import type {
  ZeropsOrganizationStatus,
  ZeropsSessionStatus,
} from "../zerops/ZeropsSessionProvider";
import { environmentPresentations } from "./presentation";

export const zeropsFeeds = createZeropsFeedAtoms(connectionAtomRuntime);

/**
 * `deriveZeropsThreadModel`, re-exported from thread state alongside the
 * other Zerops derivations this module owns. Not an Effect `Atom` in its
 * own right — the model has no subscription to hold: it is a pure
 * projection of activities (already local component state) and the
 * lifecycle feed (`useZeropsLifecycle`), so the caller memoizes it on
 * reference identity the same way it memoizes every other thread
 * derivation (`useMemo`), rather than this module owning a second copy of
 * that state behind an atom.
 */
export { deriveZeropsThreadModel } from "@t3tools/client-runtime/zerops/model";

/**
 * The account's platform-data runtime, published by `ZeropsInventoryProvider` into the account's
 * atom registry, which starts over when the account closes: null before this account's runtime
 * stands. The three published atoms are kept alive: what is published holds until the account's
 * registry is disposed, whether or not anything reads it meanwhile. Every derivation below reads the platform through it, so none holds a value of its own
 * that could outlive the account.
 */
export const zeropsDataRuntimeAtom = Atom.make<ManagedZeropsDataRuntime | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:data-runtime"),
);

/** The Zerops session as the account's product last saw it, and the organization it shows. */
export interface ZeropsSessionView {
  readonly status: ZeropsSessionStatus;
  readonly organizationStatus: ZeropsOrganizationStatus;
  readonly activeOrganization: OrganizationRef | null;
}

/** Published beside the runtime; null before the account's product is mounted. */
export const zeropsSessionAtom = Atom.make<ZeropsSessionView | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:session"),
);

/**
 * The organization's structure as HQ last told this tab (`ZeropsHqStructure`, ADR 0002): its
 * applications and the projects HQ places in them.
 */
export interface HqStructureView {
  readonly organizationId: string;
  /** Null while nothing is known: never read here, nothing remembered from before. */
  readonly structure: HqStructure | null;
  /**
   * Each application's changes, as this stream last told them; null until its snapshot carried
   * them. Never remembered across loads: a change's state is HQ's to say again.
   */
  readonly changes: HqChanges | null;
  /** When `structure` was HQ's answer, wall ms. */
  readonly readAt: number | null;
  /** `structure` is HQ's answer now. */
  readonly current: boolean;
  /** When HQ stopped answering, wall ms, while it does not; the last known structure stands. */
  readonly unavailableSince: number | null;
}

export const hqStructureAtom = Atom.make<HqStructureView | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:hq-structure"),
);

/**
 * Where HQ places each project of the organization in view, as last known; null while nothing
 * is known of its structure — its projects are then placed nowhere.
 */
export const hqPlacementsAtom = Atom.make((get): ReadonlyMap<string, HqPlacement> | null => {
  const view = get(hqStructureAtom);
  const organizationId = get(zeropsSessionAtom)?.activeOrganization?.organizationId;
  return view === null || view.organizationId !== organizationId || view.structure === null
    ? null
    : placementsOf(view.structure, get(hqLoginsAtom));
}).pipe(Atom.withLabel("zerops:hq-placements"));

/**
 * Each application's stage and production as HQ last said them, with their deploys, by its id
 * (SPEC §3.2b); an application HQ sent none this build can read for is missing. Null while nothing
 * is known of the organization's structure.
 */
export const hqEnvironmentsAtom = Atom.make(
  (get): ReadonlyMap<string, ReadonlyArray<HqEnvironment>> | null => {
    const view = get(hqStructureAtom);
    const organizationId = get(zeropsSessionAtom)?.activeOrganization?.organizationId;
    return view === null || view.organizationId !== organizationId || view.structure === null
      ? null
      : new Map(
          view.structure.apps.flatMap((app) =>
            app.environments === undefined ? [] : [[app.id, app.environments] as const],
          ),
        );
  },
).pipe(Atom.withLabel("zerops:hq-environments"));

/**
 * Each application's changes in the organization in view, as HQ last said them (SPEC §3.2a); null
 * while nothing is known of them.
 */
export const hqChangesAtom = Atom.make((get): HqChanges | null => {
  const view = get(hqStructureAtom);
  const organizationId = get(zeropsSessionAtom)?.activeOrganization?.organizationId;
  return view === null || view.organizationId !== organizationId ? null : view.changes;
}).pipe(Atom.withLabel("zerops:hq-changes"));

/**
 * The Mates the reader may observe, as HQ last told this tab beside the structure (`hq/mates.ts`):
 * each by its project, its presence and its overview's sections.
 */
export interface HqMatesView {
  readonly organizationId: string;
  /** Null while nothing is known: HQ sent none — one from before the overviews — or not yet. */
  readonly mates: HqMates | null;
  /** `mates` is HQ's answer now; else what was last known of them, and none of them is live. */
  readonly current: boolean;
}

export const hqMatesViewAtom = Atom.make<HqMatesView | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:hq-mates-view"),
);

/** The people HQ last named for the reader's view, by their Zerops user id. */
export interface HqPeopleView {
  readonly organizationId: string;
  /** Null while nothing is known: HQ named none — one from before the overviews — or not yet. */
  readonly people: HqPeople | null;
}

export const hqPeopleViewAtom = Atom.make<HqPeopleView | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:hq-people-view"),
);

/** The Mates of the organization in view, as HQ last told them; null while none is known. */
export const hqMatesAtom = Atom.make((get): HqMatesView | null => {
  const view = get(hqMatesViewAtom);
  const organizationId = get(zeropsSessionAtom)?.activeOrganization?.organizationId;
  return view === null || view.organizationId !== organizationId ? null : view;
}).pipe(Atom.withLabel("zerops:hq-mates"));

/** The people HQ named for the organization in view, by Zerops user id; null while none are. */
export const hqPeopleAtom = Atom.make((get): HqPeople | null => {
  const view = get(hqPeopleViewAtom);
  const organizationId = get(zeropsSessionAtom)?.activeOrganization?.organizationId;
  return view === null || view.organizationId !== organizationId ? null : view.people;
}).pipe(Atom.withLabel("zerops:hq-people"));

const sameLogins = (
  left: ReadonlyMap<string, OverviewLogins>,
  right: ReadonlyMap<string, OverviewLogins>,
) => JSON.stringify([...left]) === JSON.stringify([...right]);

/**
 * Each Mate's logins, as HQ's overview of it says them, by project (`placementsOf` joins them onto
 * its record): the same map while none of them moves, so a Mate at work redraws no listing.
 */
export const hqLoginsAtom = Atom.make(
  (get): ReadonlyMap<string, OverviewLogins> =>
    new Map(
      [...(get(hqMatesAtom)?.mates ?? new Map())].flatMap(([projectId, mate]) =>
        mate.logins === undefined ? [] : [[projectId, mate.logins] as const],
      ),
    ),
).pipe(Atom.withEquality(sameLogins), Atom.withLabel("zerops:hq-logins"));

const NO_PLACEMENTS: ReadonlyMap<string, HqPlacement> = new Map();

/** The account's inventory as `ZeropsInventoryProvider` projects it; null before its first grant. */
export const zeropsInventoryAtom = Atom.make<InventoryProjection | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:inventory"),
);

/** One environment this renderer registered, as the connection catalog presents it. */
export interface ZeropsEnvironmentEntry {
  readonly environmentId: EnvironmentId;
  readonly displayUrl: string | null;
  readonly connection: EnvironmentConnectionPresentation;
  /**
   * The Zerops project its own descriptor states (`zerops.projectId`): null for a server that runs
   * outside Zerops, undefined while its server has not answered.
   */
  readonly zeropsProjectId: string | null | undefined;
}

/** Every registered environment: the environments atom the listing, names and Mates join. */
export const zeropsEnvironmentsAtom = Atom.make((get): ReadonlyArray<ZeropsEnvironmentEntry> =>
  [...get(environmentPresentations.presentationsAtom)].map(([environmentId, presentation]) => ({
    environmentId,
    displayUrl: connectionCatalogDisplayUrl(presentation.entry),
    connection: presentation.connection,
    zeropsProjectId:
      presentation.serverConfig === null
        ? undefined
        : (presentation.serverConfig.environment.zerops?.projectId ?? null),
  })),
).pipe(Atom.withLabel("zerops:environments"));

const UNREAD: Known<never> = { state: "unread", waitingFor: null };

/**
 * The active organization's listing as the account runtime reads it (`candidateListingsAtom`),
 * before any project's admission, with the test a row's project must pass to be shown: unread
 * until the account's product has published a signed-in session with an organization chosen, its
 * runtime and its inventory, and withheld whole while the account's access lapses (§3.1). The
 * rows and the names each read it their own way.
 */
const organizationListingAtom = Atom.make(
  (
    get,
  ): {
    readonly listing: Shown<ReadonlyArray<CandidateRow>>;
    readonly admits: (row: CandidateRow) => boolean;
    /** Its project list held a member this account may not read: a name on it, unread. */
    readonly withheldMembers: boolean;
  } => {
    const session = get(zeropsSessionAtom);
    const runtime = get(zeropsDataRuntimeAtom);
    const inventory = get(zeropsInventoryAtom);
    if (
      session === null ||
      runtime === null ||
      inventory === null ||
      session.status !== "signed-in" ||
      session.organizationStatus !== "selected" ||
      session.activeOrganization === null
    ) {
      return { listing: UNREAD, admits: NONE, withheldMembers: false };
    }
    if (inventory.account.kind === "withheld") {
      const { reason, cause } = inventory.account;
      return {
        listing: { state: "withheld", reason, cause },
        admits: NONE,
        withheldMembers: false,
      };
    }
    const organization = session.activeOrganization;
    const listed = get(candidateListingsAtom(runtime)).find(
      ({ organizationId }) => organizationId === organization.organizationId,
    );
    const placements = get(hqPlacementsAtom) ?? NO_PLACEMENTS;
    const listing = listed?.listing ?? UNREAD;
    // Each project's own grants, as the access grant's last round read them: the records carry
    // none, and a Mate's owner is its `OWNER` grant (F11).
    const grants = projectGrantsOf(heldEvidence(get(runtime.access.view).machine));
    return {
      // Each project where HQ places it (ADR 0002): its group, its kind, its Mate's name and face.
      listing: grantListing(placeListing(listing, placements), grants),
      withheldMembers: get(runtime.reads.projectsOf(organization)).value.some(
        (member) => member.knowledge === "unavailable" && member.reason === "forbidden",
      ),
      admits: (row) => {
        const key = projectKeyOf({
          kind: "project",
          organization,
          projectId: ZeropsProjectId.make(row.project.id),
        });
        return inventory.projectRefs.has(key) && inventory.authority.get(key)?.kind !== "withheld";
      },
    };
  },
).pipe(Atom.withLabel("zerops:organization-listing"));

const NONE = (): boolean => false;

/**
 * The active organization's candidate rows (DESIGN §2.B B4): the account runtime's listing of it
 * (`candidateListingsAtom`), unread until the account's product has published a signed-in
 * session with an organization chosen, its runtime and its inventory. Only the rows of projects
 * the inventory admits are shown, and withholding is applied here, at the read (§3.1, §4.2 G12):
 * withheld whole while the account's access lapses, and without the rows of a project the grant
 * withholds alone, which leaves the listing partial. A listing nothing is left out of is the
 * account's own. Derived, so nothing it held outlives the account.
 */
export const candidateRowsAtom = Atom.make((get): Shown<ReadonlyArray<CandidateRow>> => {
  const { listing, admits } = get(organizationListingAtom);
  return listing.state === "known" ? admittedOnly(listing, admits) : listing;
}).pipe(Atom.withLabel("zerops:candidate-rows"));

/**
 * The names the active organization's Mates go by (`takenBotNames`), read off its project list
 * where HQ places each: a project the grant has not verified yet, or that this account may not
 * open, still holds its name, and no project's services need reading. Complete only as the list
 * is, with HQ's structure answered and no
 * member withheld (`takenBotNames`), so a name missing from it is never called free while it may
 * still be there; nothing while the account's access lapses.
 */
export const takenBotNamesAtom = Atom.make((get): TakenBotNames => {
  const { listing, withheldMembers } = get(organizationListingAtom);
  return takenBotNames(listing, {
    withheldMembers,
    structureKnown: get(hqPlacementsAtom) !== null && get(hqStructureAtom)?.current === true,
  });
}).pipe(Atom.withLabel("zerops:taken-bot-names"));

/**
 * The derived half of the environment → project index (DESIGN §2.C C3): the project each
 * registered environment's descriptor states, and the one each listing row that reaches an
 * environment belongs to. A registration record is the third source (`environmentProjectRef`).
 */
export interface EnvironmentProjects {
  readonly described: ReadonlyMap<EnvironmentId, string>;
  readonly listed: ReadonlyMap<EnvironmentId, string>;
}

export const environmentProjectsAtom = Atom.make((get): EnvironmentProjects => {
  const environments = get(zeropsEnvironmentsAtom);
  const described = new Map<EnvironmentId, string>();
  for (const environment of environments) {
    if (typeof environment.zeropsProjectId === "string")
      described.set(environment.environmentId, environment.zeropsProjectId);
  }
  const registered = registeredZeropsOrigins(environments);
  const listed = new Map<EnvironmentId, string>();
  for (const row of heldCandidates(get(candidateRowsAtom)).rows) {
    const environmentId = rowEnvironment(row, registered);
    if (environmentId !== undefined && !listed.has(environmentId))
      listed.set(environmentId, row.project.id);
  }
  return { described, listed };
}).pipe(Atom.withLabel("zerops:environment-projects"));

/**
 * The project an environment belongs to (C3): its descriptor's word first, then its registration
 * record, then a listing row that reaches it — each resolved to the inventory's one operable
 * reference. Null while none of them places it in a project the inventory holds.
 */
export function environmentProjectRef(input: {
  readonly environmentId: EnvironmentId;
  readonly record: RegistrationRecord | undefined;
  readonly located: EnvironmentProjects;
  readonly inventory: Pick<InventoryProjection, "projectRefs">;
}): ProjectRef | null {
  const described = input.located.described.get(input.environmentId);
  const remembered = input.record?.projectRef ?? null;
  const listed = input.located.listed.get(input.environmentId);
  return (
    (described === undefined ? null : findInventoryProjectRef(input.inventory, described)) ??
    (remembered === null
      ? null
      : findInventoryProjectRef(input.inventory, remembered.projectId, remembered.orgId)) ??
    (listed === undefined ? null : findInventoryProjectRef(input.inventory, listed))
  );
}

export type ProjectTopologyLiveness = "live" | "recovering";

export interface ProjectTopologySnapshot {
  readonly view: ZeropsTopologyView | undefined;
  readonly liveness: ProjectTopologyLiveness | undefined;
  readonly lastReadAt: number | undefined;
  readonly error: string | undefined;
}

export const EMPTY_PROJECT_TOPOLOGY_SNAPSHOT: ProjectTopologySnapshot = {
  view: undefined,
  liveness: undefined,
  lastReadAt: undefined,
  error: undefined,
};

/** The window a project's metric history is read in: the last day, by the hour. */
export const PROJECT_HISTORY_WINDOW: MetricWindow = {
  timeGroupBy: "1h",
  limit: 24,
  timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
};

function latestObservedAt(topology: ProjectTopologyRead): number | undefined {
  const stamps: number[] = [];
  if (topology.project.value.knowledge === "observed") {
    const record = topology.project.value.record;
    if (record.identity.knowledge === "observed") stamps.push(record.identity.stamp.observedAtMs);
    if (record.lifecycle.knowledge === "observed") stamps.push(record.lifecycle.stamp.observedAtMs);
  }
  for (const knowledge of [...topology.services.value, ...topology.runningProcesses.value]) {
    if (knowledge.knowledge !== "observed") continue;
    if (knowledge.record.identity.knowledge === "observed")
      stamps.push(knowledge.record.identity.stamp.observedAtMs);
    if (knowledge.record.lifecycle.knowledge === "observed")
      stamps.push(knowledge.record.lifecycle.stamp.observedAtMs);
  }
  return stamps.length === 0 ? undefined : Math.max(...stamps);
}

const EMPTY_USAGE_READS: ReadonlyMap<string, UsageRead> = new Map();
const EMPTY_HISTORY_READS: ReadonlyMap<string, HistoryReadView> = new Map();

export function projectTopologySnapshotFromRead(
  topology: ProjectTopologyRead,
  usageByService: ReadonlyMap<string, UsageRead> = EMPTY_USAGE_READS,
  historyByService: ReadonlyMap<string, HistoryReadView> = EMPTY_HISTORY_READS,
): ProjectTopologySnapshot {
  const required = topology.observation.required;
  const failed = required.find((interest) => interest.status === "failed");
  const liveness: ProjectTopologyLiveness =
    required.length > 0 && required.every((interest) => interest.status === "observing")
      ? "live"
      : "recovering";
  if (topology.project.value.knowledge !== "observed") {
    return {
      view: undefined,
      liveness,
      lastReadAt: latestObservedAt(topology),
      error: failed?.reason,
    };
  }
  const projectDto = projectRecordToZeropsProject(topology.project.value.record);
  if (projectDto === null)
    return { view: undefined, liveness, lastReadAt: undefined, error: failed?.reason };
  const services: ZeropsService[] = [];
  for (const knowledge of topology.services.value) {
    if (knowledge.knowledge !== "observed") continue;
    const service = serviceRecordToZeropsService(knowledge.record);
    if (service !== null) services.push(service);
  }
  const processes = topology.runningProcesses.value.flatMap((knowledge) => {
    if (knowledge.knowledge !== "observed") return [];
    const process = processRecordToActivityProcess(knowledge.record);
    return process === null ? [] : [process];
  });
  const history: ZeropsStatHistoryItem[] = [...historyByService.values()].flatMap(({ series }) =>
    [...series.buckets.values()].map((bucket) => ({
      serviceStackId: bucket.key.series.service.serviceId,
      from: bucket.key.from,
      till: bucket.key.till,
      containerCount: bucket.containers ?? 0,
      cpuUsed: bucket.cpu?.used ?? 0,
      cpuLimit: bucket.cpu?.limit ?? 0,
      vCpuUsed: bucket.virtualCpu?.used ?? 0,
      vCpuLimit: bucket.virtualCpu?.limit ?? 0,
      ramUsed: bucket.memoryGb?.used ?? 0,
      ramLimit: bucket.memoryGb?.limit ?? 0,
      diskUsed: bucket.diskGb?.used ?? 0,
      diskLimit: bucket.diskGb?.limit ?? 0,
    })),
  );
  // Native corrections can arrive out of order; chart points must remain chronological.
  history.sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  const base = projectTopology(projectDto, services, processes, undefined, history);
  let usageRead = false;
  const rows = base.services.map((row) => {
    const usage = usageByService.get(row.serviceId);
    if (usage === undefined) return row;
    if (usage.coverage.kind !== "none") usageRead = true;
    return usage.value === null
      ? row
      : {
          ...row,
          usage: {
            containers: usage.value.containers,
            cores: usage.value.cpu,
            memoryGb: usage.value.memoryGb,
            diskGb: usage.value.diskGb,
          },
        };
  });
  return {
    view: { ...base, services: rows, usageRead },
    liveness,
    lastReadAt: latestObservedAt(topology),
    error: failed?.reason,
  };
}

const topologyProjects = new Map<string, ProjectRef>();

const projectTopologyFamily = Atom.family((key: string) =>
  Atom.make((get): ProjectTopologySnapshot => {
    const runtime = get(zeropsDataRuntimeAtom);
    const inventory = get(zeropsInventoryAtom);
    const project = topologyProjects.get(key)!;
    // Withheld at the read while the grant withholds the project (§4.2 G12): nothing of it shows.
    if (
      runtime === null ||
      inventory === null ||
      inventory.account.kind === "withheld" ||
      inventory.authority.get(key)?.kind === "withheld"
    ) {
      return EMPTY_PROJECT_TOPOLOGY_SNAPSHOT;
    }
    const topology = get(runtime.reads.topology(project));
    const services = topology.services.value.flatMap((knowledge): ReadonlyArray<ServiceRef> =>
      knowledge.knowledge === "observed" ? [knowledge.record.ref] : [],
    );
    const usage = new Map(
      services.map((service) => [service.serviceId, get(runtime.reads.usage(service))] as const),
    );
    const history = new Map(
      services.map(
        (service) =>
          [
            service.serviceId,
            get(
              runtime.reads.history({
                service,
                groupBy: "serviceStackId",
                window: PROJECT_HISTORY_WINDOW,
                schemaVersion: 1,
              }),
            ),
          ] as const,
      ),
    );
    return projectTopologySnapshotFromRead(topology, usage, history);
  }).pipe(Atom.withLabel(`zerops:project-topology:${key}`)),
);

/**
 * A project's topology (DESIGN §2.C C11): derived from the runtime's topology, usage and history
 * reads, so a pushed facet reaches every reader with nobody copying it. Protected roots read it
 * through `useZeropsTopology`; `useProjectTopology` is where a host demands it.
 */
export function projectTopologyAtom(project: ProjectRef): Atom.Atom<ProjectTopologySnapshot> {
  const key = projectKeyOf(project);
  if (!topologyProjects.has(key)) topologyProjects.set(key, project);
  return projectTopologyFamily(key);
}

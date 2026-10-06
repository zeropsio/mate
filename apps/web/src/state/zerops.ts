import {
  connectionCatalogDisplayUrl,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { grantListing, projectGrantsOf, type ZeropsService } from "@t3tools/client-runtime/zerops";
import { projectsNeverSeen, heldEvidence } from "@t3tools/client-runtime/zerops/account/runtime";
import {
  projectKeyOf,
  serviceRecordToZeropsService,
  ZeropsProjectId,
  type ManagedZeropsDataRuntime,
  type OrganizationRef,
  type ProjectRef,
  type ProjectTopologyRead,
} from "@t3tools/client-runtime/zerops/data";
import {
  mateListingsAtom,
  type RegistrationRecord,
} from "@t3tools/client-runtime/zerops/environments";
import {
  placeListing,
  placementsOf,
  type HqChanges,
  type HqEnvironment,
  type HqMates,
  type HqPlacement,
  type HqAppReads,
  type HqPresses,
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
import {
  listedProjectAtom,
  NOT_READ_USAGE,
  projectProcessesAtom,
  projectUsageAtom,
  shownProjectsAtom,
  type ProjectUsage,
  type ProjectValue,
} from "@t3tools/client-runtime/data";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";

import { connectionAtomRuntime } from "../connection/runtime";
import type { HqStanding } from "../zerops/accountHq";
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
  /** A definitive refusal, or an outage whose reconnect backoff has reached its cap. */
  readonly failure?: string | null;
  /** Connection recovery, kept visible while the last known data stands. */
  readonly reconnecting?: { readonly delayMs: number; readonly capped: boolean } | null;
  readonly organizationId: string;
  /** Null while nothing is known: never read here, nothing remembered from before. */
  readonly structure: HqStructure | null;
  /**
   * Each application's changes, as this stream last told them; null until its snapshot carried
   * them. Never remembered across loads: a change's state is HQ's to say again.
   */
  readonly changes: HqChanges | null;
  /**
   * HQ-owned releases, repository heads and recipe tiers (Mate, stage, production) by app.
   * Null until the stream's first snapshot; never remembered across loads.
   */
  readonly appReads: HqAppReads | null;
  /**
   * Each Mate's press a browser holds at HQ, by project, its hold measured on this browser's clock
   * from when HQ said it (`applyPressesEvent`); none — unknown — until this stream's snapshot said
   * them. Never remembered across loads: a press is live or it is nothing.
   */
  readonly presses?: HqPresses | null;
  /** When `structure` was HQ's answer, wall ms. */
  readonly readAt: number | null;
  /** `structure` is HQ's answer now. */
  readonly current: boolean;
  /** When HQ stopped answering, wall ms, while it does not; the last known structure stands. */
  readonly unavailableSince: number | null;
  /**
   * Where HQ stands, as its stream says it — healthy while it serves — and, after the stream
   * failed, as HQ's health then said it (`driveHqStructure`). Absent: nothing known of it.
   */
  readonly standing?: HqStanding;
}

export const hqStructureAtom = Atom.make<HqStructureView | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:hq-structure"),
);

const HQ_STANDING_UNKNOWN: HqStanding = { kind: "unknown" };

/**
 * Where the organization in view's HQ stands, as its structure stream last said it (SPEC §4): no
 * read of its own, nothing on a timer.
 */
export const hqStandingAtom = Atom.make((get): HqStanding => {
  const view = get(hqStructureAtom);
  const organizationId = get(zeropsSessionAtom)?.activeOrganization?.organizationId;
  return view === null || view.organizationId !== organizationId
    ? HQ_STANDING_UNKNOWN
    : (view.standing ?? HQ_STANDING_UNKNOWN);
}).pipe(Atom.withLabel("zerops:hq-standing"));

/**
 * Where HQ places each project of the organization in view, as last known; null while nothing
 * is known of its structure — its projects are then placed nowhere. A stage's or a production's
 * project HQ holds nowhere is placed by its press's record, unregistered (`placementsOf`).
 */
export const hqPlacementsAtom = Atom.make((get): ReadonlyMap<string, HqPlacement> | null => {
  const view = get(hqStructureAtom);
  const organizationId = get(zeropsSessionAtom)?.activeOrganization?.organizationId;
  return view === null || view.organizationId !== organizationId || view.structure === null
    ? null
    : placementsOf(view.structure, get(hqLoginsAtom), get(hqReadyAgentsAtom), view.presses ?? null);
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
            // Refused the reader, they are not theirs to finish: as missing as unreadable ones.
            app.environments === undefined || "refused" in app.environments
              ? []
              : [[app.id, app.environments] as const],
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

/**
 * Whether the organization in view has an official HQ, as `useAccountHq` decided it — from the
 * verdict this browser keeps, or its member list. Null while neither has said.
 */
export const hqOfficialAtom = Atom.make<boolean | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:hq-official"),
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
  const session = get(zeropsSessionAtom);
  const organizationId =
    get(hqStructureAtom)?.organizationId ??
    (session?.status === "signed-in" && session.organizationStatus === "selected"
      ? (session.activeOrganization?.organizationId ?? null)
      : null);
  return view === null || view.organizationId !== organizationId ? null : view;
}).pipe(Atom.withLabel("zerops:hq-mates"));

/** The project whose Mate HQ says serves `environmentId`, in `view`; null where HQ names none. */
export function hqProjectOf(view: HqMatesView | null, environmentId: EnvironmentId): string | null {
  for (const [projectId, mate] of view?.mates ?? []) {
    if (mate.identity?.environmentId === environmentId) return projectId;
  }
  return null;
}

/** `hqProjectOf` for one environment: re-read only when HQ moves the project it names. */
export const hqProjectAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => hqProjectOf(get(hqMatesAtom), environmentId)).pipe(
    Atom.withLabel(`zerops:hq-project:${environmentId}`),
  ),
);

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

/** Whether each Mate runs on an agent that needs no sign-in, as HQ's overview of it says, by project. */
export const hqReadyAgentsAtom = Atom.make(
  (get): ReadonlyMap<string, boolean> =>
    new Map(
      [...(get(hqMatesAtom)?.mates ?? new Map())].flatMap(([id, mate]) =>
        mate.identity?.runsWithoutSignIn === undefined
          ? []
          : [[id, mate.identity.runsWithoutSignIn] as const],
      ),
    ),
).pipe(
  Atom.withEquality(
    (a: ReadonlyMap<string, boolean>, b: ReadonlyMap<string, boolean>) =>
      JSON.stringify([...a]) === JSON.stringify([...b]),
  ),
  Atom.withLabel("zerops:hq-ready-agents"),
);

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
 * The active organization's listing as the account reads it (`mateListingsAtom`: its projects as
 * the account's store lists them, their services as the runtime reads them), each project where HQ
 * places it, with the test a row's project must pass to be shown: unread until the account's
 * product has published a signed-in session with an organization chosen, its runtime and its
 * inventory, and withheld whole while the account's access lapses (§3.1). The rows and the names
 * each read it their own way.
 */
const shownListingAtom = Atom.make(
  (
    get,
  ): {
    readonly listing: Shown<ReadonlyArray<CandidateRow>>;
    readonly admits: (row: CandidateRow) => boolean;
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
      return { listing: UNREAD, admits: NONE };
    }
    if (inventory.account.kind === "withheld") {
      const { reason, cause } = inventory.account;
      return { listing: { state: "withheld", reason, cause }, admits: NONE };
    }
    const organization = session.activeOrganization;
    const listed = get(mateListingsAtom(runtime)).find(
      ({ organizationId }) => organizationId === organization.organizationId,
    );
    const placements = get(hqPlacementsAtom) ?? NO_PLACEMENTS;
    // Each project's own grants, as the access grant's last round read them: a Mate's owner is its
    // `OWNER` grant (F11).
    const grants = projectGrantsOf(heldEvidence(get(runtime.access.view).machine));
    return {
      // Each project where HQ places it (ADR 0002): its group, its kind, its Mate's face.
      listing: grantListing(placeListing(listed?.listing ?? UNREAD, placements), grants),
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
).pipe(Atom.withLabel("zerops:shown-listing"));

const NONE = (): boolean => false;

/**
 * The active organization's Mate rows (DESIGN §2.B B4): its listing with only the rows of projects
 * the inventory admits, and withholding applied here, at the read (§3.1, §4.2 G12): without the
 * rows of a project the grant withholds alone, which leaves the listing partial. Derived, so
 * nothing it held outlives the account.
 */
export const mateRowsAtom = Atom.make((get): Shown<ReadonlyArray<CandidateRow>> => {
  const { listing, admits } = get(shownListingAtom);
  return listing.state === "known" ? admittedOnly(listing, admits) : listing;
}).pipe(Atom.withLabel("zerops:mate-rows"));

/**
 * Whether the rows lack anything still on its way for this person: the roster is whole, and every
 * project it lists that has no row is one this person can never see (`projectsNeverSeen`: the
 * grant withholds it, NO_ACCESS, a denial confirmed).
 */
export const candidateListingWholeAtom = Atom.make((get): boolean => {
  const session = get(zeropsSessionAtom);
  const runtime = get(zeropsDataRuntimeAtom);
  const inventory = get(zeropsInventoryAtom);
  const organization = session?.activeOrganization ?? null;
  if (runtime === null || inventory === null || organization === null) return false;
  const rows = get(mateRowsAtom);
  const roster = get(shownProjectsAtom);
  if (rows.state !== "known" || roster.orgId !== organization.organizationId || !roster.complete)
    return false;
  const shown = new Set(heldCandidates(rows).rows.map((row) => row.project.id));
  const neverSeen = projectsNeverSeen({
    evidence: heldEvidence(get(runtime.access.view).machine),
    access: get(runtime.reads.access),
    withheld: (projectId) =>
      inventory.authority.get(
        projectKeyOf({ kind: "project", organization, projectId: ZeropsProjectId.make(projectId) }),
      )?.kind === "withheld",
  });
  return roster.projects.every((project) => shown.has(project.id) || neverSeen(project.id));
}).pipe(Atom.withLabel("zerops:candidate-listing-whole"));

/**
 * The names the active organization's Mates go by (`takenBotNames`), read off its project list
 * where HQ places each: a project the grant has not verified yet, or that this account may not
 * open, still holds its name, and no project's services need reading. Complete only as the list
 * is, with HQ's structure answered (`takenBotNames`), so a name missing from it is never called
 * free while it may still be there; nothing while the account's access lapses.
 */
export const takenBotNamesAtom = Atom.make((get): TakenBotNames =>
  takenBotNames(get(shownListingAtom).listing, {
    structureKnown: get(hqPlacementsAtom) !== null && get(hqStructureAtom)?.current === true,
  }),
).pipe(Atom.withLabel("zerops:taken-bot-names"));

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
  for (const row of heldCandidates(get(mateRowsAtom)).rows) {
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

function latestObservedAt(topology: ProjectTopologyRead): number | undefined {
  const stamps: number[] = [];
  for (const knowledge of topology.services.value) {
    if (knowledge.knowledge !== "observed") continue;
    if (knowledge.record.identity.knowledge === "observed")
      stamps.push(knowledge.record.identity.stamp.observedAtMs);
    if (knowledge.record.lifecycle.knowledge === "observed")
      stamps.push(knowledge.record.lifecycle.stamp.observedAtMs);
  }
  return stamps.length === 0 ? undefined : Math.max(...stamps);
}

export function projectTopologySnapshotFromRead(
  /** The project as the account's store lists it; `null` while it does not. */
  project: ProjectValue | null,
  topology: ProjectTopologyRead,
  /** What runs in the project now, as the account's store holds it (`projectProcesses`). */
  running: ReadonlyArray<ActivityProcess>,
  /** The project's resources, as the account's store holds them while the panel shows them. */
  usage: ProjectUsage = NOT_READ_USAGE,
): ProjectTopologySnapshot {
  const required = topology.observation.required;
  const failed = [...required, ...topology.observation.optional].find(
    (interest) => interest.status === "failed",
  );
  const error = failed?.reason ?? usage.failure;
  const liveness: ProjectTopologyLiveness =
    required.length > 0 && required.every((interest) => interest.status === "observing")
      ? "live"
      : "recovering";
  if (project === null) {
    return {
      view: undefined,
      liveness,
      lastReadAt: latestObservedAt(topology),
      error,
    };
  }
  const services: ZeropsService[] = [];
  for (const knowledge of topology.services.value) {
    if (knowledge.knowledge !== "observed") continue;
    const service = serviceRecordToZeropsService(knowledge.record);
    if (service !== null) services.push(service);
  }
  const processes = running;
  const base = projectTopology(project, services, processes, undefined, usage.history);
  const rows = base.services.map((row) => {
    const used = usage.byService[row.serviceId];
    return used === undefined ? row : { ...row, usage: used };
  });
  return {
    view: { ...base, services: rows, usageRead: usage.read },
    liveness,
    lastReadAt: latestObservedAt(topology),
    error,
  };
}

const topologyProjects = new Map<string, ProjectRef>();

const projectTopologies = Atom.family((key: string) =>
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
    // What runs in it is the account store's: the organization's running work, never the runtime's.
    const running = get(projectProcessesAtom(project.projectId)).running;
    return projectTopologySnapshotFromRead(
      get(listedProjectAtom(project.projectId)),
      topology,
      running,
      get(projectUsageAtom(project.projectId)),
    );
  }).pipe(Atom.withLabel(`zerops:project-topology:${key}`)),
);

/**
 * A project's topology (DESIGN §2.C C11): the project as the account's store lists it, its
 * services as the runtime reads them, and their usage and history as the account's store holds
 * them while the panel demands them, so a pushed facet reaches every reader
 * with nobody copying it. Protected roots read it
 * through `useZeropsTopology`; `useProjectTopology` is where a host demands it.
 */
export function projectTopologyAtom(project: ProjectRef): Atom.Atom<ProjectTopologySnapshot> {
  const key = projectKeyOf(project);
  if (!topologyProjects.has(key)) topologyProjects.set(key, project);
  return projectTopologies(key);
}

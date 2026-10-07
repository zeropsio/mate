/**
 * What a screen, and the account runtime's derivations outside React, may reach of the account's
 * data: the store's reads and the hold on a detail — never its writer. An app sets
 * {@link accountReadsAtom} in its registry while an account is mounted; atoms read through it.
 *
 * @module data/reads
 */
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { ZeropsOrganization } from "../zerops/api.ts";
import type { DetailDemand } from "./demand.ts";
import { linkKeys } from "./model.ts";
import { mateVariablesScope } from "./families/mateVariables.ts";
import { hqMateSetup, UNKNOWN_MATE_SETUP, type HqMateSetup } from "./projections/hqMateSetup.ts";
import { mateVariables } from "./projections/mateVariables.ts";
import { projectProcesses, type ProjectProcesses } from "./projections/processes.ts";
import type { ProjectValue } from "./families/project.ts";
import { projectServices, projectsServices, type ProjectServices } from "./projections/services.ts";
import { projectUsage, type ProjectUsage } from "./projections/usage.ts";
import {
  listedProject,
  organizationProjects,
  projectGone,
  projectStanding,
  type OrganizationProjects,
  type ProjectStanding,
} from "./projections/projects.ts";
import { hqMates, type HqMatesRead } from "./projections/hqMates.ts";
import { hqVerdict } from "./projections/hqVerdict.ts";
import type { HqVerdict } from "./families/hqVerdict.ts";
import type { MateLinkValue } from "./families/mateLink.ts";
import { mateLinks, mateOfEnvironment, type MateLinksRead } from "./projections/mateLinks.ts";
import {
  hqAppChanges,
  hqNavigation,
  hqPersonFacts,
  hqStatus,
  type HqNavigationRead,
} from "./projections/hqNavigation.ts";
import type { HqAppValue, HqPersonFacts, HqStatusValue } from "./families/hqNavigation.ts";
import type { AccountStore } from "./store.ts";

export interface AccountReads {
  readonly viewer?: ZeropsOrganization | undefined;
  readonly data: AccountStore["data"];
  /** The organization whose navigation is observed; `null` before one is chosen. */
  readonly orgId: string | null;
  /** A hold on a detail while it is wanted; the release lets it go. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  /** Renews each held own row no push keeps current (a project's, naming everybody's grants). */
  readonly renewHeld: () => void;
}

/** The mounted account's reads; `null` while no account is mounted. */
export const accountReadsAtom = Atom.make<AccountReads | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("data:account-reads"),
);

export const NOT_READ_PROCESSES: ProjectProcesses = {
  processes: undefined,
  running: [],
  live: false,
  reconnecting: false,
  history: "unread",
};

/** One project's processes as the mounted account holds them; not read without one. */
export const projectProcessesAtom = Atom.family((projectId: string) =>
  Atom.make((get): ProjectProcesses => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null) return NOT_READ_PROCESSES;
    return get(account.data.project(projectProcesses, { orgId: account.orgId, projectId }));
  }).pipe(Atom.withLabel(`data:project-processes:${projectId}`)),
);

export const NOT_READ_SERVICES: ProjectServices = {
  services: undefined,
  live: false,
  reconnecting: false,
};

/** One project's services as the mounted account holds them; not read without one. */
export const projectServicesAtom = Atom.family((projectId: string) =>
  Atom.make((get): ProjectServices => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null) return NOT_READ_SERVICES;
    return get(account.data.project(projectServices, { orgId: account.orgId, projectId }));
  }).pipe(Atom.withLabel(`data:project-services:${projectId}`)),
);

export const NOT_READ_USAGE: ProjectUsage = {
  read: false,
  byService: {},
  history: [],
  failure: undefined,
};

/**
 * One project's resources (`usageOwnerOf`) as the mounted account holds them; not read without
 * one. Read only while a screen demands the owner's `usage` and `usageHistory` details.
 */
export const projectUsageAtom = Atom.family((owner: string) =>
  Atom.make((get): ProjectUsage => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null) return NOT_READ_USAGE;
    return get(account.data.project(projectUsage, { orgId: account.orgId, owner }));
  }).pipe(Atom.withLabel(`data:project-usage:${owner}`)),
);

const NO_PROJECTS_SERVICES: Readonly<Record<string, ProjectServices>> = {};

/**
 * Several projects' services at once, as the mounted account holds them, by project id; nothing
 * without one. Keyed by the ids joined with `,`.
 */
export const projectsServicesAtom = Atom.family((projectIds: string) =>
  Atom.make((get): Readonly<Record<string, ProjectServices>> => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null || projectIds === "")
      return NO_PROJECTS_SERVICES;
    return get(
      account.data.project(projectsServices, {
        orgId: account.orgId,
        projectIds: projectIds.split(","),
      }),
    );
  }).pipe(Atom.withLabel(`data:projects-services:${projectIds}`)),
);

export const NOT_READ_PROJECTS: OrganizationProjects = {
  projects: [],
  read: "unread",
  complete: false,
  live: false,
  reconnecting: false,
};

/**
 * The organization's projects as the mounted account observes them — the organization it shows;
 * not read without one.
 */
export const shownProjectsAtom = Atom.make(
  (get): OrganizationProjects & { readonly orgId: string | null } => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null) return { ...NOT_READ_PROJECTS, orgId: null };
    return {
      ...get(account.data.project(organizationProjects, account.orgId)),
      orgId: account.orgId,
    };
  },
).pipe(Atom.withLabel("data:shown-projects"));

/** One project as the mounted account holds it; `null` without one, or while it holds none. */
export const listedProjectAtom = Atom.family((projectId: string) =>
  Atom.make((get): ProjectValue | null => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null) return null;
    return get(account.data.project(listedProject, { orgId: account.orgId, projectId }));
  }).pipe(Atom.withLabel(`data:listed-project:${projectId}`)),
);

/** Whether the mounted account's owner proved a project deleted; `false` without an account. */
export const projectGoneAtom = Atom.family((projectId: string) =>
  Atom.make((get): boolean => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null) return false;
    return get(account.data.project(projectGone, { orgId: account.orgId, projectId }));
  }).pipe(Atom.withLabel(`data:project-gone:${projectId}`)),
);

const NOT_KNOWN: ProjectStanding = { kind: "unknown" };

/** Where one project stands with the viewer as the mounted account holds it; not known without one. */
export const projectStandingAtom = Atom.family((projectId: string) =>
  Atom.make((get): ProjectStanding => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null) return NOT_KNOWN;
    return get(account.data.project(projectStanding, { orgId: account.orgId, projectId }));
  }).pipe(Atom.withLabel(`data:project-standing:${projectId}`)),
);

/**
 * Holds a project's newest process history from outside React, through whichever account is
 * mounted in `registry`: moved to a newly mounted one, let go on release.
 */
export function holdProjectHistory(
  registry: AtomRegistry.AtomRegistry,
  projectId: string,
): () => void {
  let release: (() => void) | null = null;
  const hold = (account: AccountReads | null) => {
    release?.();
    release =
      account?.demandDetail({ family: "process", listing: "history", ownerId: projectId }) ?? null;
  };
  const unsubscribe = registry.subscribe(accountReadsAtom, hold, { immediate: true });
  return () => {
    unsubscribe();
    release?.();
    release = null;
  };
}

export const NOT_READ_HQ: HqNavigationRead = {
  updateRequired: false,
  coreBuild: undefined,
  structure: null,
  organization: null,
  presses: {},
  people: {},
  read: "unread",
  refusal: null,
  capped: false,
  live: false,
  reconnecting: false,
};

/** HQ's navigation of the organization the mounted account shows; not read without one. */
export const shownHqNavigationAtom = Atom.make(
  (get): HqNavigationRead & { readonly orgId: string | null } => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null) return { ...NOT_READ_HQ, orgId: null };
    return { ...get(account.data.project(hqNavigation, account.orgId)), orgId: account.orgId };
  },
).pipe(Atom.withLabel("data:shown-hq-navigation"));

const NO_MATES: HqMatesRead = { mates: {}, live: false };

/** The Mates HQ relays for the organization the mounted account shows; none without one. */
export const shownHqMatesAtom = Atom.make((get): HqMatesRead => {
  const account = get(accountReadsAtom);
  if (account === null || account.orgId === null) return NO_MATES;
  return get(account.data.project(hqMates, account.orgId));
}).pipe(Atom.withLabel("data:shown-hq-mates"));

const NO_PERSON_FACTS: Readonly<Record<string, HqPersonFacts>> = {};

/** What HQ computed of the reader for each project it places, in the organization shown. */
export const shownHqPersonFactsAtom = Atom.make((get): Readonly<Record<string, HqPersonFacts>> => {
  const account = get(accountReadsAtom);
  if (account === null || account.orgId === null) return NO_PERSON_FACTS;
  return get(account.data.project(hqPersonFacts, account.orgId));
}).pipe(Atom.withLabel("data:shown-hq-person-facts"));

/**
 * Whether the organization shown has an official HQ, as the account decided it; pending without
 * one shown, or before it decided.
 */
export const shownHqVerdictAtom = Atom.make((get): HqVerdict => {
  const account = get(accountReadsAtom);
  if (account === null || account.orgId === null) return "pending";
  return get(account.data.project(hqVerdict, account.orgId));
}).pipe(Atom.withLabel("data:shown-hq-verdict"));

/** How the organization shown's HQ stands, as its navigation says it; `null` before it said. */
export const shownHqStatusAtom = Atom.make((get): HqStatusValue | null => {
  const account = get(accountReadsAtom);
  if (account === null || account.orgId === null) return null;
  return get(account.data.project(hqStatus, account.orgId));
}).pipe(Atom.withLabel("data:shown-hq-status"));
export const NO_MATE_LINKS: MateLinksRead = {
  targets: new Map(),
  machines: new Map(),
  containers: new Map(),
};

/** The Mates shown, as this tab read them from each Mate; none without an account. */
export const shownMateLinksAtom = Atom.make((get): MateLinksRead => {
  const account = get(accountReadsAtom);
  if (account === null) return NO_MATE_LINKS;
  return get(account.data.project(mateLinks, null));
}).pipe(Atom.withLabel("data:shown-mate-links"));

/** The Mate an environment is served by, as this tab read it; null while none read names it. */
export const mateOfEnvironmentAtom = Atom.family((environmentId: string) =>
  Atom.make((get): MateLinkValue | null => {
    const account = get(accountReadsAtom);
    if (account === null) return null;
    return get(account.data.project(mateOfEnvironment, environmentId));
  }).pipe(Atom.withLabel(`data:mate-of-environment:${environmentId}`)),
);

/**
 * Holds one service's own read from outside React, through whichever account is mounted in
 * `registry`: moved to a newly mounted one, let go on release.
 */
export function holdServiceRead(
  registry: AtomRegistry.AtomRegistry,
  serviceId: string,
): () => void {
  let release: (() => void) | null = null;
  const hold = (account: AccountReads | null) => {
    release?.();
    release =
      account?.demandDetail({ family: "service", listing: "service", ownerId: serviceId }) ?? null;
  };
  const unsubscribe = registry.subscribe(accountReadsAtom, hold, { immediate: true });
  return () => {
    unsubscribe();
    release?.();
    release = null;
  };
}

const NO_CHANGES: Readonly<Record<string, HqAppValue["changes"]>> = {};

/** Each application's open changes in the organization shown, as HQ's navigation says them. */
export const shownHqAppChangesAtom = Atom.make(
  (get): Readonly<Record<string, HqAppValue["changes"]>> => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null) return NO_CHANGES;
    return get(account.data.project(hqAppChanges, account.orgId));
  },
).pipe(Atom.withLabel("data:shown-hq-app-changes"));
/**
 * Holds one Mate's container's variables from outside React, through whichever account is mounted
 * in `registry`: read now, again each sampled interval while held, let go on release.
 */
export function holdMateVariables(
  registry: AtomRegistry.AtomRegistry,
  serviceId: string,
): () => void {
  let release: (() => void) | null = null;
  const hold = (account: AccountReads | null) => {
    release?.();
    release =
      account === null || account.orgId === null
        ? null
        : account.demandDetail({ family: "mateVariables", ownerId: serviceId });
  };
  const unsubscribe = registry.subscribe(accountReadsAtom, hold, { immediate: true });
  return () => {
    unsubscribe();
    release?.();
    release = null;
  };
}

/** Where a read of one of a Mate's container's variables stands for one that asks now. */
const variableNow = Atom.family((serviceId: string) =>
  Atom.make((get): boolean | "unknown" | "waiting" => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null) return "unknown";
    const stream = get(account.data.stream(mateVariablesScope(account.orgId, serviceId)));
    if (stream.phase === "live") {
      const read = get(account.data.project(mateVariables, { orgId: account.orgId, serviceId }));
      const value = read.flag;
      return typeof value === "boolean" ? value : "unknown";
    }
    // Waits only for a read the live link will make; a link down or refused is no answer.
    const link = get(account.data.stream(linkKeys.zerops(account.orgId)));
    if (link.phase !== "live") return "unknown";
    return stream.phase === "connecting" ||
      stream.phase === "baselining" ||
      stream.phase === "stale" ||
      stream.phase === "idle"
      ? "waiting"
      : "unknown";
  }),
);

/**
 * One of a Mate's container's variables as its read says it now: one read for the asking, or the
 * last within its freshness. A read that did not succeed or could not say is `"unknown"`, never
 * `false`. Each step of the read has its own deadline in the stream machine.
 */
export function readMateFlag(
  registry: AtomRegistry.AtomRegistry,
  serviceId: string,
): Promise<boolean | "unknown"> {
  const release = holdMateVariables(registry, serviceId);
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    let settled = false;
    const answer = (now: boolean | "unknown" | "waiting") => {
      if (settled || now === "waiting") return;
      settled = true;
      unsubscribe?.();
      release();
      resolve(now);
    };
    unsubscribe = registry.subscribe(variableNow(serviceId), answer, {
      immediate: true,
    });
    if (settled) unsubscribe();
  });
}

/** A Mate’s setup evidence, already delivered by the organization’s navigation. No detail demand. */
export const hqMateSetupAtom = Atom.family((projectId: string) =>
  Atom.make((get): HqMateSetup => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null) return UNKNOWN_MATE_SETUP;
    return get(account.data.project(hqMateSetup, { orgId: account.orgId, projectId }));
  }),
);

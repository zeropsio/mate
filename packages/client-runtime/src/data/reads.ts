/**
 * What a screen, and the account runtime's derivations outside React, may reach of the account's
 * data: the store's reads and the hold on a detail — never its writer. An app sets
 * {@link accountReadsAtom} in its registry while an account is mounted; atoms read through it.
 *
 * @module data/reads
 */
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { DetailDemand } from "./demand.ts";
import { projectProcesses, type ProjectProcesses } from "./projections/processes.ts";
import { organizationProjects, type OrganizationProjects } from "./projections/projects.ts";
import type { AccountStore } from "./store.ts";

export interface AccountReads {
  readonly data: AccountStore["data"];
  /** The organization whose navigation is observed; `null` before one is chosen. */
  readonly orgId: string | null;
  /** A hold on a detail while it is wanted; the release lets it go. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
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

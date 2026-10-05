/**
 * What a screen, and the account runtime's derivations outside React, may reach of the account's
 * data: the store's reads and the hold on a detail — never its writer. An app sets
 * {@link accountReadsAtom} in its registry while an account is mounted; atoms read through it.
 *
 * @module data/reads
 */
import { Atom } from "effect/unstable/reactivity";

import type { DetailDemand } from "./demand.ts";
import { projectProcesses, type ProjectProcesses } from "./projections/processes.ts";
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

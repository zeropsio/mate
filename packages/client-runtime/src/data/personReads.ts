/**
 * What HQ computed of the reader for the organization shown, as atoms a screen reads: who each
 * project's owner is, whether its Mate waits on the reader, and who signed its agents in
 * (`hqProjectPeople`).
 *
 * @module data/personReads
 */
import { Atom } from "effect/unstable/reactivity";

import {
  hqProjectPerson,
  hqProjectPeople,
  type HqProjectPeople,
} from "./projections/hqProjectPeople.ts";
import { accountReadsAtom } from "./reads.ts";

const NO_PEOPLE: Readonly<Record<string, HqProjectPeople>> = {};

/** Who each project HQ places is for the reader, in the organization shown; empty before HQ said. */
export const shownHqProjectPeopleAtom = Atom.make(
  (get): Readonly<Record<string, HqProjectPeople>> => {
    const account = get(accountReadsAtom);
    if (account === null || account.orgId === null) return NO_PEOPLE;
    return get(account.data.project(hqProjectPeople, account.orgId));
  },
).pipe(Atom.withLabel("data:shown-hq-project-people"));

export const hqProjectPersonAtom = Atom.family((projectId: string) =>
  Atom.make((get) => {
    const account = get(accountReadsAtom);
    return account?.orgId == null
      ? undefined
      : get(account.data.project(hqProjectPerson, { orgId: account.orgId, projectId }));
  }),
);

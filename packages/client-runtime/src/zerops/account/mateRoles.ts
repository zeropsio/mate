/**
 * The person's role on each Mate as the client's own live Zerops data gives it: the project row
 * Zerops pushes (`userRoles`) and their own membership, read again on a `client-user` frame
 * naming them, through the one role function (`placedMateVisibilities`). A verdict moving between
 * two readings is the receipt that their access changed, so a Mate refused to them is asked
 * again. A first reading, or one not read yet, changes nothing.
 *
 * @module zerops/account/mateRoles
 */
import { Atom, type AtomRegistry } from "effect/reactivity";

import { placedMateVisibilities } from "../../data/projections/mateVisibility.ts";
import { accountReadsAtom } from "../../data/reads.ts";
import type { RoleMateVisibility } from "../mateAccess.ts";

export interface MateRolesFrame {
  /** The organization shown; null without one. */
  readonly orgId: string | null;
  /** Each Mate HQ places there, by project, with the person's verdict on it. */
  readonly verdicts: Readonly<Record<string, RoleMateVisibility | "unknown">>;
}

/** The last verdict read for each Mate of one organization. */
export interface MateRolesRead {
  readonly orgId: string;
  readonly verdicts: Readonly<Record<string, RoleMateVisibility>>;
}

/**
 * One frame against the last reading of the same organization: the Mates whose verdict moved. A
 * Mate not read yet keeps its last verdict; another organization starts a new reading.
 */
export function mateRolesStep(
  last: MateRolesRead | null,
  frame: MateRolesFrame,
): { readonly last: MateRolesRead | null; readonly changed: ReadonlyArray<string> } {
  if (frame.orgId === null) return { last: null, changed: [] };
  const before = last?.orgId === frame.orgId ? last.verdicts : {};
  const verdicts: Record<string, RoleMateVisibility> = {};
  const changed: string[] = [];
  for (const [projectId, verdict] of Object.entries(frame.verdicts)) {
    const was = before[projectId];
    if (verdict === "unknown") {
      if (was !== undefined) verdicts[projectId] = was;
      continue;
    }
    verdicts[projectId] = verdict;
    if (was !== undefined && was !== verdict) changed.push(projectId);
  }
  return { last: { orgId: frame.orgId, verdicts }, changed };
}

const NO_FRAME: MateRolesFrame = { orgId: null, verdicts: {} };

/** The person's verdict on each Mate of the organization the mounted account shows. */
const shownMateRolesAtom = Atom.make((get): MateRolesFrame => {
  const account = get(accountReadsAtom);
  if (account === null || account.orgId === null) return NO_FRAME;
  return {
    orgId: account.orgId,
    verdicts: get(account.data.project(placedMateVisibilities, account.orgId)),
  };
}).pipe(Atom.withLabel("account:shown-mate-roles"));

/** Hears each Mate whose verdict for the person moved; the result stops hearing. */
export function followMateRoles(
  registry: AtomRegistry.AtomRegistry,
  onChange: (projectId: string) => void,
): () => void {
  let last: MateRolesRead | null = null;
  return registry.subscribe(
    shownMateRolesAtom,
    (frame) => {
      const step = mateRolesStep(last, frame);
      last = step.last;
      for (const projectId of step.changed) onChange(projectId);
    },
    { immediate: true },
  );
}

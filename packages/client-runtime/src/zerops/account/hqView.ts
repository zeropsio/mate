/**
 * HQ's view of the person in the organization shown: the projects whose Mate HQ places for them.
 * HQ follows a grant change within seconds; Zerops' project search the listing is read from does
 * not show it pushing one (`data/adapters/zerops.ts`). A project entering or leaving HQ's view is
 * the receipt that the person's Zerops access changed, so the account reads the organization's
 * listing again then. Only the edge counts, never a standing disagreement: a project Zerops lists
 * and HQ never placed ("Not in this HQ") changes nothing frame after frame.
 *
 * @module zerops/account/hqView
 */
import { Atom, type AtomRegistry } from "effect/reactivity";

import { hqPlacedMates } from "../../data/projections/hqMates.ts";
import { accountReadsAtom } from "../../data/reads.ts";

export interface HqViewFrame {
  /** The organization shown; null without one. */
  readonly orgId: string | null;
  /** HQ relays its view now: what it places is its current word. */
  readonly live: boolean;
  /** The projects whose Mate HQ places, in the organization shown. */
  readonly placed: ReadonlyArray<string>;
}

export interface HqViewChange {
  readonly orgId: string;
  readonly entered: ReadonlyArray<string>;
  readonly left: ReadonlyArray<string>;
}

/**
 * One frame against the last live one of the same organization: the projects it adds or drops.
 * A frame while HQ is not live keeps the last; the first live frame of an organization is its
 * baseline, never a change.
 */
export function hqViewStep(
  last: HqViewFrame | null,
  frame: HqViewFrame,
): { readonly last: HqViewFrame | null; readonly change: HqViewChange | null } {
  if (frame.orgId === null) return { last: null, change: null };
  if (!frame.live) return { last: last?.orgId === frame.orgId ? last : null, change: null };
  if (last === null || last.orgId !== frame.orgId) return { last: frame, change: null };
  const before = new Set(last.placed);
  const now = new Set(frame.placed);
  const entered = frame.placed.filter((id) => !before.has(id));
  const left = last.placed.filter((id) => !now.has(id));
  return {
    last: frame,
    change:
      entered.length === 0 && left.length === 0 ? null : { orgId: frame.orgId, entered, left },
  };
}

const NO_VIEW: HqViewFrame = { orgId: null, live: false, placed: [] };

/** HQ's view of the person in the organization the mounted account shows. */
const shownHqViewAtom = Atom.make((get): HqViewFrame => {
  const account = get(accountReadsAtom);
  if (account === null || account.orgId === null) return NO_VIEW;
  return { orgId: account.orgId, ...get(account.data.project(hqPlacedMates, account.orgId)) };
}).pipe(Atom.withLabel("account:shown-hq-view"));

/** Hears each change of HQ's view of the person; the result stops hearing. */
export function followHqView(
  registry: AtomRegistry.AtomRegistry,
  onChange: (change: HqViewChange) => void,
): () => void {
  let last: HqViewFrame | null = null;
  return registry.subscribe(
    shownHqViewAtom,
    (frame) => {
      const step = hqViewStep(last, frame);
      last = step.last;
      if (step.change !== null) onChange(step.change);
    },
    { immediate: true },
  );
}

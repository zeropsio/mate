/**
 * The organization's official HQ as this page found it (step A, open question 1), or that it has
 * none.
 *
 * The member list is the only source of HQ's anchor (`findOfficialHq`), on purpose: only an admin
 * can write one. It is also the slowest read Zerops has: KRLS's took tens of seconds. So a page
 * keeps the verdict per account and organization, and `useAccountHq` reads the list only where it
 * keeps none: on first use, after HQ refused as not official, and after this page's own birth
 * (`accountHq.ts`). Held in this page's memory only — source data never reaches browser storage —
 * and let go of when the account's lifetime closes.
 */
import type { HqEndpoint } from "@t3tools/client-runtime/zerops/hq";
import { useSyncExternalStore } from "react";

import { onAccountLifetimeClose } from "./accountLifetime";

/** Whose verdict: an account at its API, in one organization. */
export interface HqVerdictOwner {
  readonly account: { readonly apiOrigin: string; readonly accountId: string };
  readonly clientId: string;
}

/** What this page holds of an organization: its official HQ, or that it has none. */
export type HqVerdict = HqEndpoint | { readonly none: true };

type Held = HqVerdict & {
  readonly apiOrigin: string;
  readonly accountId: string;
  readonly clientId: string;
};

/** Whether the verdict is that the organization has no official HQ. */
export const noHq = (verdict: HqVerdict): verdict is { readonly none: true } => "none" in verdict;

let verdicts: ReadonlyArray<Held> = [];
const listeners = new Set<() => void>();

const write = (next: ReadonlyArray<Held>): void => {
  verdicts = next;
  for (const listener of listeners) listener();
};

onAccountLifetimeClose(() => write([]));

const owns = (held: Held, owner: HqVerdictOwner): boolean =>
  held.apiOrigin === owner.account.apiOrigin &&
  held.accountId === owner.account.accountId &&
  held.clientId === owner.clientId;

const names = (verdict: HqVerdict, hq: HqEndpoint): boolean =>
  !noHq(verdict) && verdict.projectId === hq.projectId && verdict.address === hq.address;

/** Holds `verdict` as `owner`'s, in place of any it held before. */
const hold = (owner: HqVerdictOwner, verdict: HqVerdict): void =>
  write([
    ...verdicts.filter((entry) => !owns(entry, owner)),
    {
      apiOrigin: owner.account.apiOrigin,
      accountId: owner.account.accountId,
      clientId: owner.clientId,
      ...verdict,
    },
  ]);

/** Holds `hq` as `owner`'s official HQ, in place of any verdict held before. */
export function keepHqVerdict(owner: HqVerdictOwner, hq: HqEndpoint): void {
  const current = verdicts.find((entry) => owns(entry, owner));
  if (current !== undefined && names(current, hq)) return;
  hold(owner, { projectId: hq.projectId, address: hq.address });
}

/** Holds that `owner`'s organization has no official HQ, as its member list said. */
export function keepNoHqVerdict(owner: HqVerdictOwner): void {
  const current = verdicts.find((entry) => owns(entry, owner));
  if (current !== undefined && noHq(current)) return;
  hold(owner, { none: true });
}

/** Forgets that `owner`'s organization has no official HQ: the member list is read again. */
export function forgetNoHqVerdict(owner: HqVerdictOwner): void {
  const kept = verdicts.filter((entry) => !(owns(entry, owner) && noHq(entry)));
  if (kept.length !== verdicts.length) write(kept);
}

/**
 * Forgets every verdict this page holds naming `hq` in the organization `clientId`: the member
 * list is read again for it.
 */
export function forgetHqVerdict(clientId: string, hq: HqEndpoint): void {
  const kept = verdicts.filter((entry) => !(entry.clientId === clientId && names(entry, hq)));
  if (kept.length !== verdicts.length) write(kept);
}

/** Hears every change of what this page holds; answers how to stop hearing. */
export function subscribeHqVerdicts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether this page holds a verdict for the organization `clientId`, and it names `hq`. */
export function verdictNames(clientId: string, hq: HqEndpoint): boolean | undefined {
  const held = verdicts.find((entry) => entry.clientId === clientId);
  return held === undefined ? undefined : names(held, hq);
}

/** The verdict this page holds for `owner`, as it changes; `undefined` while it holds none. */
export function useHqVerdict(owner: HqVerdictOwner | undefined): HqVerdict | undefined {
  const current = () =>
    owner === undefined ? undefined : verdicts.find((entry) => owns(entry, owner));
  return useSyncExternalStore(subscribeHqVerdicts, current, current);
}

/**
 * The organization's official HQ as this browser found it (step A, open question 1), or that it
 * has none.
 *
 * The member list is the only source of HQ's anchor (`findOfficialHq`), on purpose: only an admin
 * can write one. It is also the slowest read Zerops has: KRLS's took tens of seconds. So a browser
 * keeps the verdict per account and organization, and `useAccountHq` reads the list only where it
 * keeps none: on first use here, after HQ refused as not official, and after an outage of more than
 * ten minutes (`accountHq.ts`). That the list named no official HQ stands a day, or until this
 * browser's own birth. Kept in local storage: an HQ's project and address, or when the list named
 * none — nothing of anybody.
 */
import type { HqEndpoint } from "@t3tools/client-runtime/zerops/hq";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "zerops-mate.hq-verdict.v1";

/** How long a verdict of no official HQ stands before the member list is read again. */
export const NO_HQ_RECHECK_MS = 24 * 60 * 60_000;

/** Whose verdict: an account at its API, in one organization. */
export interface HqVerdictOwner {
  readonly account: { readonly apiOrigin: string; readonly accountId: string };
  readonly clientId: string;
}

/** What this browser keeps of an organization: its official HQ, or none since `noneAt`, wall ms. */
export type KeptHqVerdict = HqEndpoint | { readonly noneAt: number };

type Kept = KeptHqVerdict & {
  readonly apiOrigin: string;
  readonly accountId: string;
  readonly clientId: string;
};

/** Whether the verdict is that the organization has no official HQ. */
export const keptNoHq = (kept: KeptHqVerdict): kept is { readonly noneAt: number } =>
  "noneAt" in kept;

/** Whether `kept` says no official HQ since longer ago than a day, at `now`. */
const pastRecheck = (kept: KeptHqVerdict, now: number): boolean =>
  keptNoHq(kept) && now - kept.noneAt >= NO_HQ_RECHECK_MS;

const isKept = (value: unknown): value is Kept => {
  if (typeof value !== "object" || value === null) return false;
  const fields = value as Record<string, unknown>;
  const strings = (...names: ReadonlyArray<string>) =>
    names.every((field) => typeof fields[field] === "string");
  return (
    strings("apiOrigin", "accountId", "clientId") &&
    (strings("projectId", "address") || typeof fields["noneAt"] === "number")
  );
};

const readStored = (): ReadonlyArray<Kept> => {
  try {
    const held: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(held) ? held.filter(isKept) : [];
  } catch {
    return [];
  }
};

/** What this browser keeps, read from storage on first use. */
let verdicts: ReadonlyArray<Kept> | null = null;
const listeners = new Set<() => void>();
const held = (): ReadonlyArray<Kept> => (verdicts ??= readStored());

const write = (next: ReadonlyArray<Kept>): void => {
  verdicts = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: kept for this tab only, and read again on the next load.
  }
  for (const listener of listeners) listener();
};

const owns = (kept: Kept, owner: HqVerdictOwner): boolean =>
  kept.apiOrigin === owner.account.apiOrigin &&
  kept.accountId === owner.account.accountId &&
  kept.clientId === owner.clientId;

const names = (kept: KeptHqVerdict, hq: HqEndpoint): boolean =>
  !keptNoHq(kept) && kept.projectId === hq.projectId && kept.address === hq.address;

/** Keeps `verdict` as `owner`'s, in place of any it kept before. */
const keep = (owner: HqVerdictOwner, verdict: KeptHqVerdict): void =>
  write([
    ...held().filter((entry) => !owns(entry, owner)),
    {
      apiOrigin: owner.account.apiOrigin,
      accountId: owner.account.accountId,
      clientId: owner.clientId,
      ...verdict,
    },
  ]);

/** Keeps `hq` as `owner`'s official HQ, in place of any it kept before. */
export function keepHqVerdict(owner: HqVerdictOwner, hq: HqEndpoint): void {
  const current = held().find((entry) => owns(entry, owner));
  if (current !== undefined && names(current, hq)) return;
  keep(owner, { projectId: hq.projectId, address: hq.address });
}

/** Keeps that `owner`'s organization has no official HQ, as its member list said at `at`. */
export function keepNoHqVerdict(owner: HqVerdictOwner, at: number): void {
  const current = held().find((entry) => owns(entry, owner));
  if (current !== undefined && keptNoHq(current) && !pastRecheck(current, at)) return;
  keep(owner, { noneAt: at });
}

/** Forgets that `owner`'s organization has no official HQ: the member list is read again. */
export function forgetNoHqVerdict(owner: HqVerdictOwner): void {
  const kept = held().filter((entry) => !(owns(entry, owner) && keptNoHq(entry)));
  if (kept.length !== held().length) write(kept);
}

/**
 * Forgets every verdict this browser keeps naming `hq` in the organization `clientId`: the member
 * list is read again for it.
 */
export function forgetHqVerdict(clientId: string, hq: HqEndpoint): void {
  const kept = held().filter((entry) => !(entry.clientId === clientId && names(entry, hq)));
  if (kept.length !== held().length) write(kept);
}

/**
 * The verdict this browser keeps for `owner`, as it changes; `undefined` while it keeps none, or
 * only one of no official HQ past its day.
 */
export function useKeptHqVerdict(owner: HqVerdictOwner | undefined): KeptHqVerdict | undefined {
  const current = () =>
    owner === undefined
      ? undefined
      : held().find((entry) => owns(entry, owner) && !pastRecheck(entry, Date.now()));
  // A page rendered ahead of the browser reads what this module holds, as the browser then does.
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current,
    current,
  );
}

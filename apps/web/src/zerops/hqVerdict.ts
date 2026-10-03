/**
 * The organization's official HQ as this browser found it (step A, open question 1).
 *
 * The member list is the only source of HQ's anchor (`findOfficialHq`), on purpose: only an admin
 * can write one. It is also the slowest read Zerops has: KRLS's took tens of seconds. So a browser
 * keeps the verdict per account and organization, and `useAccountHq` reads the list only where it
 * keeps none: on first use here, after HQ refused as not official, and after an outage of more than
 * ten minutes (`accountHq.ts`). Kept in local storage: an HQ's project and address, nothing of
 * anybody.
 */
import type { HqEndpoint } from "@t3tools/client-runtime/zerops/hq";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "zerops-mate.hq-verdict.v1";

/** Whose verdict: an account at its API, in one organization. */
export interface HqVerdictOwner {
  readonly account: { readonly apiOrigin: string; readonly accountId: string };
  readonly clientId: string;
}

interface Kept extends HqEndpoint {
  readonly apiOrigin: string;
  readonly accountId: string;
  readonly clientId: string;
}

const isKept = (value: unknown): value is Kept => {
  if (typeof value !== "object" || value === null) return false;
  const fields = value as Record<string, unknown>;
  return ["apiOrigin", "accountId", "clientId", "projectId", "address"].every(
    (field) => typeof fields[field] === "string",
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

const names = (kept: HqEndpoint, hq: HqEndpoint): boolean =>
  kept.projectId === hq.projectId && kept.address === hq.address;

/** Keeps `hq` as `owner`'s official HQ, in place of any it kept before. */
export function keepHqVerdict(owner: HqVerdictOwner, hq: HqEndpoint): void {
  const current = held().find((entry) => owns(entry, owner));
  if (current !== undefined && names(current, hq)) return;
  write([
    ...held().filter((entry) => !owns(entry, owner)),
    {
      apiOrigin: owner.account.apiOrigin,
      accountId: owner.account.accountId,
      clientId: owner.clientId,
      projectId: hq.projectId,
      address: hq.address,
    },
  ]);
}

/**
 * Forgets every verdict this browser keeps naming `hq` in the organization `clientId`: the member
 * list is read again for it.
 */
export function forgetHqVerdict(clientId: string, hq: HqEndpoint): void {
  const kept = held().filter((entry) => !(entry.clientId === clientId && names(entry, hq)));
  if (kept.length !== held().length) write(kept);
}

/** The HQ this browser keeps for `owner`, as it changes; `undefined` while it keeps none. */
export function useKeptHqVerdict(owner: HqVerdictOwner | undefined): HqEndpoint | undefined {
  const current = () =>
    owner === undefined ? undefined : held().find((entry) => owns(entry, owner));
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

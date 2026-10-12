/**
 * The access a Chief's record answered — the credential its zcp reaches the organization with, and
 * the proxy — handed from the account's operations (`makeHqExecutor`'s `chiefAccess`) to the
 * set-up that asked for it. Held in this tab's memory until the set-up takes it, never written
 * anywhere, and dropped with the account.
 */
import { onAccountLifetimeClose } from "./accountLifetime";

export interface ChiefAccess {
  readonly credential: string;
  readonly proxyUrl: string;
}

const handed = new Map<string, ChiefAccess>();

onAccountLifetimeClose(() => handed.clear());

/** HQ answered a Chief's record for `projectId`: a later answer replaces an earlier one. */
export function handChiefAccess(projectId: string, access: ChiefAccess): void {
  handed.set(projectId, access);
}

/** The access HQ answered for `projectId`, once: taken, it is held here no longer. */
export function takeChiefAccess(projectId: string): ChiefAccess | undefined {
  const access = handed.get(projectId);
  handed.delete(projectId);
  return access;
}

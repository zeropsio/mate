/**
 * Where a creation's job waits between being decided and being said.
 *
 * Synchronous like `firstPromptStorage.ts` and for the same reason: the
 * compose that reads this runs inside a route effect, and the shared
 * `ZeropsStorageAdapter` is async.
 *
 * Losing a record costs the new Mate its opening job — it falls back to the
 * fixed onboarding line — so every access swallows its own failure rather
 * than taking a creation down with it.
 */

import {
  ZEROPS_CREATION_HANDOFF_STORAGE_KEY,
  parseCreationHandoffs,
  readCreationHandoff,
  withCreationHandoff,
  withCreationHandoffPromoted,
  withoutCreationHandoff,
  type ZeropsCreationHandoff,
  type ZeropsCreationHandoffs,
} from "@t3tools/client-runtime/zerops";

import { accountLocalStorage } from "./accountLifetime";

function read(): ZeropsCreationHandoffs {
  try {
    return parseCreationHandoffs(accountLocalStorage.getItem(ZEROPS_CREATION_HANDOFF_STORAGE_KEY));
  } catch {
    return {};
  }
}

function write(next: ZeropsCreationHandoffs): void {
  try {
    accountLocalStorage.setItem(ZEROPS_CREATION_HANDOFF_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // See the module note: a lost handoff costs an opening message, nothing more.
  }
}

/** Written by the creation, which has a Zerops project and no environment yet. */
export function rememberCreationHandoff(projectId: string, handoff: ZeropsCreationHandoff): void {
  write(withCreationHandoff(read(), { projectId }, handoff));
}

/** The connect is the one place both ids are in hand. */
export function promoteCreationHandoff(projectId: string, environmentId: string): void {
  const next = withCreationHandoffPromoted(read(), projectId, environmentId);
  write(next);
}

export function creationHandoffFor(environmentId: string): ZeropsCreationHandoff | undefined {
  return readCreationHandoff(read(), { environmentId });
}

export function forgetCreationHandoff(environmentId: string): void {
  write(withoutCreationHandoff(read(), environmentId));
}

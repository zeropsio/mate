/**
 * What the credential reconcile found out about each Mate, kept for the one
 * screen that asks afterwards.
 *
 * The reconcile runs on the projects screen, over the whole account
 * (`useZeropsGiteaCredential`); the Git tab is per Mate and opens later. So the
 * reconcile leaves a **receipt** here — it asked the broker and wrote a token,
 * or it read this Mate's environment and found this Gitea's credential already
 * there — and the tab reads that rather than inspecting the Mate itself. A
 * `GITEA_TOKEN` key is not a receipt: it is there for a Mate pointed at a Gitea
 * that no longer exists, and reading it back says `REDACTED` whatever it holds.
 *
 * In memory and nowhere else. A receipt is what *this session* established; a
 * remembered one would be a memory of what was done, which is the thing the
 * reconcile exists not to rely on (guide 4.5). Nothing said about a Mate is
 * `undefined`, which is never read as provisioned.
 */
import type { GiteaCredentialOutcome } from "@t3tools/client-runtime/zerops";
import { useSyncExternalStore } from "react";

/**
 * What one reconcile outcome proves about a Mate.
 *
 * `written` is the broker's answer, in this Mate's environment. `up-to-date` is
 * the reconcile having read that environment and decided nothing was needed —
 * the credential is this Gitea's and the Mate holds it. `unavailable` is the
 * ask having failed, and the reconcile only asks for a Mate that needs one, so
 * it is a Mate without access rather than an unknown. Waiting on the account's
 * Gitea proves nothing either way.
 */
export function mateGiteaReceiptFrom(outcome: GiteaCredentialOutcome): boolean | undefined {
  switch (outcome.kind) {
    case "written":
    case "up-to-date":
      return true;
    case "unavailable":
      return false;
    case "waiting-for-gitea":
      return undefined;
  }
}

const receipts = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** What the reconcile established for one Mate's project. */
export function recordMateGiteaReceipt(projectId: string, provisioned: boolean): void {
  if (receipts.get(projectId) === provisioned) return;
  receipts.set(projectId, provisioned);
  for (const listener of listeners) listener();
}

/** `undefined` until a reconcile has answered for this Mate. */
export function readMateGiteaReceipt(projectId: string | undefined): boolean | undefined {
  return projectId === undefined ? undefined : receipts.get(projectId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The receipt for one Mate, re-rendering the caller when one arrives. */
export function useMateGiteaReceipt(projectId: string | undefined): boolean | undefined {
  return useSyncExternalStore(
    subscribe,
    () => readMateGiteaReceipt(projectId),
    () => undefined,
  );
}

/** Forgets everything — a sign-out, and the tests. */
export function forgetMateGiteaReceipts(): void {
  receipts.clear();
  for (const listener of listeners) listener();
}

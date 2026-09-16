/**
 * Records who signed an agent in, the moment their sign-in succeeds (D6).
 *
 * The record is a tag on the Mate's own project,
 * `mate:signer:{agent}:{userId}`, and it is written **as the person** — which
 * is the whole point. A Mate's key is `BASIC_USER` on its project and cannot
 * write tags, so neither the container nor the agent running inside it can
 * forge whose login this is. The server reads the tag with its own key and
 * refuses a turn started by anybody else.
 *
 * It is written here rather than by the server for exactly that reason. The
 * login itself is server-driven (`ZeropsAgentLogin` walks the CLI's own
 * menus), so this watches the snapshot that login publishes and writes on the
 * transition into `succeeded` — once per success, never on an attempt that is
 * merely in progress.
 *
 * A write that fails is not reported: the person has just signed in
 * successfully and telling them about a tag would be telling them about our
 * plumbing. The consequence is visible and recoverable on its own — the agent
 * refuses their turn and the card says nobody is recorded, and signing in
 * again writes the tag.
 */

import { lookupEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import type { EnvironmentId, ZeropsAgentAuthSnapshot, ZeropsAgentId } from "@t3tools/contracts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { browserZeropsStorage } from "./storage";
import { useZeropsSession } from "./ZeropsSessionProvider";

/**
 * The records this client wrote itself, agent to Zerops user id, held until
 * the server's snapshot carries them.
 *
 * The server reads the signers when it publishes on the credential event,
 * which is before this client has written the record; it re-reads on its own
 * schedule (`ZeropsAgentAuth`'s `SIGNER_RECHECK_INTERVAL`), but the person
 * who just signed in should not sit in front of a closed composer for it.
 * They are the one person who already knows what the record says, so the
 * client remembers it for them, and forgets it the moment the snapshot says
 * the same thing.
 */
export type LocalAgentSigners = Readonly<Partial<Record<ZeropsAgentId, string>>>;

let localAgentSigners: LocalAgentSigners = {};
const localAgentSignerListeners = new Set<() => void>();

function setLocalAgentSigners(next: LocalAgentSigners): void {
  localAgentSigners = next;
  for (const listener of localAgentSignerListeners) listener();
}

export function readLocalAgentSigners(): LocalAgentSigners {
  return localAgentSigners;
}

export function subscribeLocalAgentSigners(listener: () => void): () => void {
  localAgentSignerListeners.add(listener);
  return () => {
    localAgentSignerListeners.delete(listener);
  };
}

export function rememberLocalAgentSigner(agentId: ZeropsAgentId, userId: string): void {
  if (localAgentSigners[agentId] === userId) return;
  setLocalAgentSigners({ ...localAgentSigners, [agentId]: userId });
}

/** Forgets every entry the snapshot now carries itself: the server has caught up. */
export function localSignersSettledBy(snapshot: ZeropsAgentAuthSnapshot): void {
  const settled = snapshot.agents.filter(
    (agent) => agent.authorizedBy !== undefined && localAgentSigners[agent.agentId] !== undefined,
  );
  if (settled.length === 0) return;
  const next: Partial<Record<ZeropsAgentId, string>> = { ...localAgentSigners };
  for (const agent of settled) delete next[agent.agentId];
  setLocalAgentSigners(next);
}

export function useLocalAgentSigners(): LocalAgentSigners {
  return useSyncExternalStore(
    subscribeLocalAgentSigners,
    readLocalAgentSigners,
    readLocalAgentSigners,
  );
}

/**
 * Who signed this agent in, for ownership: the snapshot's own record when it
 * has one, else the record this client wrote and the server has not read back
 * yet, else nobody.
 */
export function resolveAgentAuthorizer(
  agentId: ZeropsAgentId,
  authorizedBy: { readonly subject: string } | undefined,
  local: LocalAgentSigners,
): { readonly subject: string } | undefined {
  if (authorizedBy !== undefined) return { subject: authorizedBy.subject };
  const subject = local[agentId];
  return subject === undefined ? undefined : { subject };
}

/**
 * Which agents' sign-ins have just succeeded, given what the snapshot said
 * before and what it says now.
 *
 * A phase that was already `succeeded` is not a success again: the snapshot
 * republishes for reasons of its own, and a record written on every republish
 * would be a project write on every repaint.
 */
export function agentSignInsJustSucceeded(
  previous: ZeropsAgentAuthSnapshot | null,
  next: ZeropsAgentAuthSnapshot,
): ReadonlyArray<ZeropsAgentId> {
  return next.agents
    .filter((agent) => {
      if (agent.login?.phase !== "succeeded") return false;
      const before = previous?.agents.find((entry) => entry.agentId === agent.agentId);
      return before?.login?.phase !== "succeeded";
    })
    .map((agent) => agent.agentId);
}

export function useZeropsAgentSignerRecord(input: {
  readonly snapshot: ZeropsAgentAuthSnapshot | null;
  /** The Zerops project this Mate is, when the client knows which one. */
  readonly projectId: string | undefined;
}): void {
  const { client, user } = useZeropsSession();
  const previous = useRef<ZeropsAgentAuthSnapshot | null>(null);
  const { snapshot, projectId } = input;
  const userId = user?.id;

  useEffect(() => {
    if (snapshot !== null) localSignersSettledBy(snapshot);
  }, [snapshot]);

  useEffect(() => {
    if (snapshot === null) return;
    const succeeded = agentSignInsJustSucceeded(previous.current, snapshot);
    previous.current = snapshot;
    if (succeeded.length === 0 || projectId === undefined || !userId) return;

    const controller = new AbortController();
    void (async () => {
      for (const agentId of succeeded) {
        if (controller.signal.aborted) return;
        try {
          await client.recordProjectAgentSigner({ projectId, agentId, userId }, controller.signal);
          rememberLocalAgentSigner(agentId, userId);
        } catch {
          // The card says nobody is recorded and the agent refuses the turn;
          // signing in again writes the tag.
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [client, projectId, snapshot, userId]);
}

/**
 * Which Zerops project a connected environment is, from the durable memory
 * `environmentProjectRef.ts` keeps. `undefined` until it is known — a tag
 * write that guessed the project would be a tag on somebody else's.
 */
export function useZeropsEnvironmentProjectId(
  environmentId: EnvironmentId | null,
): string | undefined {
  const [projectId, setProjectId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const read =
      environmentId === null
        ? Promise.resolve(undefined)
        : lookupEnvironmentProjectRef(browserZeropsStorage, environmentId);
    void read.then((stored) => {
      if (!cancelled) setProjectId(stored?.projectId);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  return projectId;
}

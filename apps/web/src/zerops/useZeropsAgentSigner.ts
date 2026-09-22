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
 * menus) and names who started it (`login.startedBy`), so this reads the
 * snapshot's STATE, not a transition some screen happened to watch: a login
 * that succeeded, started by this person, whose record the project does not
 * carry yet, gets written — whichever door the sign-in went through (the
 * panel's card, the thread's band, the empty conversation), and after a
 * reload too. {@link useZeropsAgentSignerRecord} runs once per conversation
 * view (`ChatView`) and publishes how it went per environment; every row
 * reads it with {@link useZeropsAgentSignerRecordState}.
 *
 * A write that fails is surfaced, never swallowed (H13): `recordFailed`
 * names the agent and `retry` writes it again — the person has just signed
 * in successfully, so asking them to sign out and back in only to retry the
 * same write is not a real recovery, and it used to be the only one offered.
 * It is also retried on its own ({@link SIGNER_RECORD_RETRY_DELAYS_MS}), so a
 * passing network blip clears without anyone pressing anything.
 */

import { lookupEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import type { EnvironmentId, ZeropsAgentAuthSnapshot, ZeropsAgentId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

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
 * Which agents' signer records this person should write now: a login that
 * succeeded, that this person started, and whose record the snapshot does not
 * carry. State, not a transition — see the module header.
 *
 * An older server names nobody (`startedBy` absent). There the success this
 * client watched happen — a phase that was not `succeeded` in `previous`, or
 * no previous snapshot at all — is taken as this person's, as before.
 */
export function agentSignersToRecord(
  snapshot: ZeropsAgentAuthSnapshot,
  viewerId: string | undefined,
  previous: ZeropsAgentAuthSnapshot | null,
): ReadonlyArray<ZeropsAgentId> {
  if (!viewerId) return [];
  return snapshot.agents
    .filter((agent) => {
      if (agent.login?.phase !== "succeeded" || agent.authorizedBy?.subject === viewerId) {
        return false;
      }
      if (agent.login.startedBy !== undefined) return agent.login.startedBy === viewerId;
      const before = previous?.agents.find((entry) => entry.agentId === agent.agentId);
      return before?.login?.phase !== "succeeded";
    })
    .map((agent) => agent.agentId);
}

/** How long after a failed signer-record write it is tried again on its own. */
export const SIGNER_RECORD_RETRY_DELAYS_MS: ReadonlyArray<number> = [2_000, 5_000, 15_000];

export interface ZeropsAgentSignerRecordState {
  /**
   * Agents whose sign-in succeeded but whose record write did not (H13):
   * the person is signed in, but the record that lets the door — and D6 —
   * recognize them never landed. `retry` writes it again.
   */
  readonly recordFailed: ReadonlySet<ZeropsAgentId>;
  readonly retry: (agentId: ZeropsAgentId) => void;
}

const NO_RECORD_STATE: ZeropsAgentSignerRecordState = { recordFailed: new Set(), retry: () => {} };

/**
 * What each environment's recorder knows, for the rows that show it — the
 * panel's card and the empty conversation live in different subtrees of the
 * one conversation view that records.
 */
const recordStates = new Map<string, ZeropsAgentSignerRecordState>();
const recordStateListeners = new Set<() => void>();

function publishRecordState(environmentId: string, state: ZeropsAgentSignerRecordState | null) {
  if (state === null) recordStates.delete(environmentId);
  else recordStates.set(environmentId, state);
  for (const listener of recordStateListeners) listener();
}

function subscribeRecordStates(listener: () => void): () => void {
  recordStateListeners.add(listener);
  return () => {
    recordStateListeners.delete(listener);
  };
}

/** How recording this environment's signers went — see {@link useZeropsAgentSignerRecord}. */
export function useZeropsAgentSignerRecordState(
  environmentId: EnvironmentId | null | undefined,
): ZeropsAgentSignerRecordState {
  const read = () =>
    (environmentId ? recordStates.get(environmentId) : undefined) ?? NO_RECORD_STATE;
  return useSyncExternalStore(subscribeRecordStates, read, read);
}

export function useZeropsAgentSignerRecord(input: {
  readonly environmentId: EnvironmentId | null;
  readonly snapshot: ZeropsAgentAuthSnapshot | null;
  /** The Zerops project this Mate is, when the client knows which one. */
  readonly projectId: string | undefined;
}): ZeropsAgentSignerRecordState {
  const { client, user } = useZeropsSession();
  const { environmentId, snapshot, projectId } = input;
  const userId = user?.id;
  const [recordFailed, setRecordFailed] = useState<ReadonlySet<ZeropsAgentId>>(new Set());

  useEffect(() => {
    if (snapshot !== null) localSignersSettledBy(snapshot);
  }, [snapshot]);

  const writeRecord = useCallback(
    async (agentId: ZeropsAgentId, signal: AbortSignal): Promise<boolean> => {
      if (projectId === undefined || !userId) return false;
      try {
        await client.recordProjectAgentSigner({ projectId, agentId, userId }, signal);
        rememberLocalAgentSigner(agentId, userId);
        setRecordFailed((current) => {
          if (!current.has(agentId)) return current;
          const next = new Set(current);
          next.delete(agentId);
          return next;
        });
        return true;
      } catch {
        if (signal.aborted) return false;
        // Surfaced (H13): the card says nobody is recorded and the agent
        // refuses the turn, and `retry` is how signing in again would have
        // fixed it anyway — offered without asking the person to sign out.
        setRecordFailed((current) => new Set(current).add(agentId));
        return false;
      }
    },
    [client, projectId, userId],
  );

  // The writes live as long as the view, not as long as one snapshot: a
  // republish mid-write must not abort one. `attempted` keeps it to one write
  // per login — the snapshot republishes for reasons of its own, and the
  // record lands in it only on the server's next read of the tags — and is
  // per mount, so a remount (StrictMode's included) writes again: the tag
  // write is idempotent.
  const lifetimeOwner = `${projectId ?? ""}:${userId ?? ""}`;
  const lifetime = useRef<{
    readonly owner: string;
    readonly controller: AbortController;
    readonly timers: Set<number>;
    readonly attempted: Set<string>;
    /** The snapshot last read, for a server that names no `startedBy`. */
    previous: ZeropsAgentAuthSnapshot | null;
  } | null>(null);
  // Also renewed for another person or project: a retry scheduled for the
  // one before must never write their record under this session.
  useEffect(() => {
    const current = {
      owner: lifetimeOwner,
      controller: new AbortController(),
      timers: new Set<number>(),
      attempted: new Set<string>(),
      previous: null,
    };
    lifetime.current = current;
    return () => {
      current.controller.abort();
      for (const timer of current.timers) window.clearTimeout(timer);
      lifetime.current = null;
    };
  }, [lifetimeOwner]);

  useEffect(() => {
    const owner = lifetime.current;
    if (
      owner === null ||
      owner.owner !== lifetimeOwner ||
      snapshot === null ||
      projectId === undefined
    ) {
      return;
    }
    const previous = owner.previous;
    owner.previous = snapshot;
    const due = agentSignersToRecord(snapshot, userId, previous).filter((agentId) => {
      const startedAt = snapshot.agents.find((agent) => agent.agentId === agentId)?.login
        ?.startedAt;
      const key = `${projectId}:${agentId}:${startedAt === undefined ? "" : String(startedAt)}`;
      if (owner.attempted.has(key)) return false;
      owner.attempted.add(key);
      return true;
    });
    const { controller, timers } = owner;
    const attempt = async (agentId: ZeropsAgentId, retriesLeft: ReadonlyArray<number>) => {
      if (await writeRecord(agentId, controller.signal)) return;
      const [delay, ...rest] = retriesLeft;
      if (delay === undefined || controller.signal.aborted) return;
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        void attempt(agentId, rest);
      }, delay);
      timers.add(timer);
    };
    void (async () => {
      for (const agentId of due) await attempt(agentId, SIGNER_RECORD_RETRY_DELAYS_MS);
    })();
  }, [lifetimeOwner, projectId, snapshot, userId, writeRecord]);

  const retry = useCallback(
    (agentId: ZeropsAgentId) => {
      void writeRecord(agentId, new AbortController().signal);
    },
    [writeRecord],
  );

  // A record the project now carries for this person — another tab wrote it —
  // is no longer a failure here.
  const unsettledFailed = useMemo(() => {
    const settled = (snapshot?.agents ?? []).filter(
      (agent) => recordFailed.has(agent.agentId) && agent.authorizedBy?.subject === userId,
    );
    if (settled.length === 0) return recordFailed;
    const next = new Set(recordFailed);
    for (const agent of settled) next.delete(agent.agentId);
    return next;
  }, [recordFailed, snapshot, userId]);

  useEffect(() => {
    if (environmentId === null) return;
    publishRecordState(environmentId, { recordFailed: unsettledFailed, retry });
    return () => {
      publishRecordState(environmentId, null);
    };
  }, [environmentId, unsettledFailed, retry]);

  return { recordFailed: unsettledFailed, retry };
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

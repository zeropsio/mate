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
 *
 * Every login carries its own record (D6 per login): an agent's default login
 * under the agent id, and a login beyond the defaults (crew mode's *Runs on*)
 * under its own id — `mate:signer:claudeAgent-work:{userId}`. That key is what
 * every record, retry and failure here is by.
 */

import type { RecordProjectRef } from "@t3tools/client-runtime/zerops/environments";
import type {
  EnvironmentId,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentLoginPhase,
} from "@t3tools/contracts";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { latestSucceededSignIn } from "@t3tools/shared/zeropsAgentAuth";

import { useRegistrationRecord } from "./registrationRecords";
import { runZeropsCommand, ZeropsDataContext } from "./zeropsDataContext";
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
export type LocalAgentSigners = Readonly<Partial<Record<string, string>>>;

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

export function rememberLocalAgentSigner(key: string, userId: string): void {
  if (localAgentSigners[key] === userId) return;
  setLocalAgentSigners({ ...localAgentSigners, [key]: userId });
}

/** Forgets a record this client meant to write: its write failed. */
export function forgetLocalAgentSigner(key: string): void {
  if (localAgentSigners[key] === undefined) return;
  const next: Partial<Record<string, string>> = { ...localAgentSigners };
  delete next[key];
  setLocalAgentSigners(next);
}

/** Every login's signer key and its record, as the snapshot carries them. */
function recordedSigners(
  snapshot: ZeropsAgentAuthSnapshot,
): ReadonlyArray<readonly [string, string | undefined]> {
  return [
    ...snapshot.agents.map((agent) => [agent.agentId, agent.authorizedBy?.subject] as const),
    ...(snapshot.logins ?? [])
      .filter((login) => !login.default)
      .map((login) => [login.id, login.signedInBy] as const),
  ];
}

/** Forgets every entry the snapshot now carries itself: the server has caught up. */
export function localSignersSettledBy(snapshot: ZeropsAgentAuthSnapshot): void {
  const settled = recordedSigners(snapshot).filter(
    ([key, signer]) => signer !== undefined && localAgentSigners[key] !== undefined,
  );
  if (settled.length === 0) return;
  const next: Partial<Record<string, string>> = { ...localAgentSigners };
  for (const [key] of settled) delete next[key];
  setLocalAgentSigners(next);
}

export function useLocalAgentSigners(): LocalAgentSigners {
  return useSyncExternalStore(
    subscribeLocalAgentSigners,
    readLocalAgentSigners,
    readLocalAgentSigners,
  );
}

/** The login a signer comes from, as a snapshot row carries it. */
export interface AgentSignerFacts {
  readonly authorizedBy?: { readonly subject: string } | undefined;
  readonly login?:
    | { readonly phase: ZeropsAgentLoginPhase; readonly startedBy?: string | undefined }
    | undefined;
}

/**
 * A login that has ended vouches for nobody by itself: a failed or cancelled one has no
 * credential, and a succeeded one stays succeeded on the server until it restarts — after a
 * record write that failed and a reload it would claim a sign-in the server refuses. Its record
 * write, while pending, is the local signer (`rememberLocalAgentSigner`).
 */
const LOGIN_ENDED: ReadonlySet<ZeropsAgentLoginPhase> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

/**
 * Who signed this agent in, for ownership: the snapshot's own record when it has one, else the
 * record this client is writing or wrote and the server has not read back yet, else the viewer's
 * own login while its code is being checked — else nobody. The viewer is the one
 * person who knows what the record will say, so the seconds before it lands never read as a
 * sign-in nobody recorded.
 */
export function resolveAgentAuthorizer(
  key: string,
  agent: AgentSignerFacts,
  local: LocalAgentSigners,
  viewer: string | undefined,
): { readonly subject: string } | undefined {
  if (agent.authorizedBy !== undefined) return { subject: agent.authorizedBy.subject };
  const subject = local[key];
  if (subject !== undefined) return { subject };
  const login = agent.login;
  if (
    viewer !== undefined &&
    viewer.length > 0 &&
    login !== undefined &&
    login.startedBy === viewer &&
    !LOGIN_ENDED.has(login.phase)
  ) {
    return { subject: viewer };
  }
  return undefined;
}

/**
 * Which logins' signer records this person should write now, by signer key: a
 * login that succeeded, that this person started, and whose record the
 * snapshot does not carry. State, not a transition — see the module header.
 *
 * An older server names nobody (`startedBy` absent). There the success this
 * client watched happen — a phase that was not `succeeded` in `previous`, or
 * no previous snapshot at all — is taken as this person's, as before. A login
 * beyond the defaults exists only on a server that names its starter.
 */
export function agentSignersToRecord(
  snapshot: ZeropsAgentAuthSnapshot,
  viewerId: string | undefined,
  previous: ZeropsAgentAuthSnapshot | null,
): ReadonlyArray<string> {
  if (!viewerId) return [];
  const agents = snapshot.agents
    .filter((agent) => {
      // The latest success: an attempt started, cancelled or failed after it changes nothing.
      const success = latestSucceededSignIn(agent.login);
      if (success === undefined || agent.authorizedBy?.subject === viewerId) return false;
      if (success.startedBy !== undefined) return success.startedBy === viewerId;
      const before = previous?.agents.find((entry) => entry.agentId === agent.agentId);
      return before?.login?.phase !== "succeeded";
    })
    .map((agent) => agent.agentId);
  const logins = (snapshot.logins ?? [])
    .filter(
      (login) =>
        !login.default &&
        latestSucceededSignIn(login.login)?.startedBy === viewerId &&
        login.signedInBy !== viewerId,
    )
    .map((login) => login.id);
  return [...agents, ...logins];
}

/** How long after a failed signer-record write it is tried again on its own. */
export const SIGNER_RECORD_RETRY_DELAYS_MS: ReadonlyArray<number> = [2_000, 5_000, 15_000];

export interface ZeropsAgentSignerRecordState {
  /**
   * Agents whose sign-in succeeded but whose record write did not (H13):
   * the person is signed in, but the record that lets the door — and D6 —
   * recognize them never landed. `retry` writes it again.
   */
  readonly recordFailed: ReadonlySet<string>;
  readonly retry: (key: string) => void;
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
  readonly project: RecordProjectRef | undefined;
}): ZeropsAgentSignerRecordState {
  const { user } = useZeropsSession();
  // Absent before the account is verified: there is no runtime to write with yet.
  const data = useContext(ZeropsDataContext);
  const { environmentId, snapshot, project } = input;
  const projectId = project?.projectId;
  const orgId = project?.orgId;
  const userId = user?.id;
  const [recordFailed, setRecordFailed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (snapshot !== null) localSignersSettledBy(snapshot);
  }, [snapshot]);

  const writeRecord = useCallback(
    async (key: string, signal: AbortSignal): Promise<boolean> => {
      if (projectId === undefined || orgId === undefined || !userId || data === null) return false;
      // The record counts as the viewer's while it is written, and stops counting if it fails.
      rememberLocalAgentSigner(key, userId);
      try {
        // A patch the TagWriter applies to the project as it is now: a list that already names
        // this signer costs a read and nothing more.
        await runZeropsCommand(
          data.runtime.commands.updateProjectTags(data.projectRef(orgId, projectId), {
            kind: "agent-signer",
            agentId: key,
            userId,
          }),
        );
        rememberLocalAgentSigner(key, userId);
        setRecordFailed((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        return true;
      } catch {
        forgetLocalAgentSigner(key);
        if (signal.aborted) return false;
        // Surfaced (H13): the card says nobody is recorded and the agent
        // refuses the turn, and `retry` is how signing in again would have
        // fixed it anyway — offered without asking the person to sign out.
        setRecordFailed((current) => new Set(current).add(key));
        return false;
      }
    },
    [data, orgId, projectId, userId],
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
  // one before must never write their record under this session. Both run before paint, so a
  // sign-in that just succeeded counts as its record being written from its first frame.
  useLayoutEffect(() => {
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

  useLayoutEffect(() => {
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
    // One write per sign-in that succeeded, whatever was started after it.
    const startedAtOf = (key: string) =>
      latestSucceededSignIn(
        snapshot.agents.find((agent) => agent.agentId === key)?.login ??
          snapshot.logins?.find((login) => !login.default && login.id === key)?.login,
      )?.startedAt;
    const due = agentSignersToRecord(snapshot, userId, previous).filter((key) => {
      const startedAt = startedAtOf(key);
      const attemptKey = `${projectId}:${key}:${startedAt === undefined ? "" : String(startedAt)}`;
      if (owner.attempted.has(attemptKey)) return false;
      owner.attempted.add(attemptKey);
      return true;
    });
    const { controller, timers } = owner;
    const attempt = async (key: string, retriesLeft: ReadonlyArray<number>) => {
      if (await writeRecord(key, controller.signal)) return;
      const [delay, ...rest] = retriesLeft;
      if (delay === undefined || controller.signal.aborted) return;
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        void attempt(key, rest);
      }, delay);
      timers.add(timer);
    };
    void (async () => {
      for (const key of due) await attempt(key, SIGNER_RECORD_RETRY_DELAYS_MS);
    })();
  }, [lifetimeOwner, projectId, snapshot, userId, writeRecord]);

  const retry = useCallback(
    (key: string) => {
      void writeRecord(key, new AbortController().signal);
    },
    [writeRecord],
  );

  // A record the project now carries for this person — another tab wrote it —
  // is no longer a failure here.
  const unsettledFailed = useMemo(() => {
    const settled = (snapshot === null ? [] : recordedSigners(snapshot)).filter(
      ([key, signer]) => recordFailed.has(key) && signer === userId,
    );
    if (settled.length === 0) return recordFailed;
    const next = new Set(recordFailed);
    for (const [key] of settled) next.delete(key);
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
 * Which Zerops project a connected environment is, from its registration record. `undefined`
 * until it is known — a tag write that guessed the project would be a tag on somebody else's.
 */
export function useZeropsEnvironmentProject(
  environmentId: EnvironmentId | null,
): RecordProjectRef | undefined {
  return useRegistrationRecord(environmentId)?.projectRef ?? undefined;
}

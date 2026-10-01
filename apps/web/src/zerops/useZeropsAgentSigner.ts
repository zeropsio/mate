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
 * The records this client wrote itself, signer key to Zerops user id, per Mate, held until the
 * server's snapshot carries them.
 *
 * The server reads the signers when it publishes on the credential event, which is before this
 * client has written the record, and its read of the tags is cached: a sign-in over an earlier
 * record goes on naming the earlier one for a while after the new one is written. The person who
 * just signed in should neither sit in front of a closed composer for it nor be told somebody
 * else holds their agent. They are the one person who already knows what the record says, so the
 * client remembers it for them — per Mate, a record of one is never another's — and forgets it
 * the moment the snapshot says the same thing, or says somebody else has signed in since.
 */
export type LocalAgentSigners = Readonly<Partial<Record<string, string>>>;

const NO_LOCAL_SIGNERS: LocalAgentSigners = {};
let localAgentSigners: ReadonlyMap<string, LocalAgentSigners> = new Map();
const localAgentSignerListeners = new Set<() => void>();

function setLocalAgentSigners(environmentId: string, next: LocalAgentSigners): void {
  const all = new Map(localAgentSigners);
  if (Object.keys(next).length === 0) all.delete(environmentId);
  else all.set(environmentId, next);
  localAgentSigners = all;
  for (const listener of localAgentSignerListeners) listener();
}

/** One Mate's records: absent is a fact here, nothing written for it from this client. */
function signersOf(
  all: ReadonlyMap<string, LocalAgentSigners>,
  environmentId: string | null | undefined,
): LocalAgentSigners {
  const signers = environmentId ? all.get(environmentId) : undefined;
  return signers === undefined ? NO_LOCAL_SIGNERS : signers;
}

/** The records this client wrote for one Mate's logins and the server has not read back yet. */
export function readLocalAgentSigners(environmentId: string | null | undefined): LocalAgentSigners {
  return signersOf(localAgentSigners, environmentId);
}

function readAllLocalAgentSigners(): ReadonlyMap<string, LocalAgentSigners> {
  return localAgentSigners;
}

export function subscribeLocalAgentSigners(listener: () => void): () => void {
  localAgentSignerListeners.add(listener);
  return () => {
    localAgentSignerListeners.delete(listener);
  };
}

/** Remembers a record this client is writing: it speaks for its login until the write ends. */
export function rememberLocalAgentSigner(environmentId: string, key: string, userId: string): void {
  const current = readLocalAgentSigners(environmentId);
  if (current[key] === userId) return;
  setLocalAgentSigners(environmentId, { ...current, [key]: userId });
}

/** Forgets a record this client meant to write: its write failed, or it has been read back. */
export function forgetLocalAgentSigner(environmentId: string, key: string): void {
  const current = readLocalAgentSigners(environmentId);
  if (current[key] === undefined) return;
  const next: Partial<Record<string, string>> = { ...current };
  delete next[key];
  setLocalAgentSigners(environmentId, next);
}

/** The latest sign-in that succeeded on a login, by whom — what a record on its way records. */
const latestSignInBy = (login: AgentSignerFacts["login"]): string | undefined =>
  login === undefined
    ? undefined
    : login.phase === "succeeded"
      ? login.startedBy
      : login.lastSucceeded?.startedBy;

/**
 * Whether the record this client wrote still speaks for the login: nothing is recorded yet, or
 * the record names somebody else while the latest sign-in is the one this record is of — the
 * server's read from before it. A record that names the same person is settled, and a sign-in
 * by somebody else since leaves it behind.
 */
function localSignerStands(local: string, agent: AgentSignerFacts): boolean {
  const recorded = agent.authorizedBy?.subject;
  const latest = latestSignInBy(agent.login);
  if (recorded === undefined) return latest === undefined || latest === local;
  return recorded !== local && latest === local;
}

/** Every login's signer key and its facts, as the snapshot carries them. */
function signerFacts(
  snapshot: ZeropsAgentAuthSnapshot,
): ReadonlyArray<readonly [string, AgentSignerFacts]> {
  return [
    ...snapshot.agents.map((agent) => [agent.agentId, agent] as const),
    ...(snapshot.logins ?? [])
      .filter((login) => !login.default)
      .map(
        (login) =>
          [
            login.id,
            {
              authorizedBy:
                login.signedInBy === undefined ? undefined : { subject: login.signedInBy },
              login: login.login,
            },
          ] as const,
      ),
  ];
}

/** Every login's signer key and its record, as the snapshot carries them. */
function recordedSigners(
  snapshot: ZeropsAgentAuthSnapshot,
): ReadonlyArray<readonly [string, string | undefined]> {
  return signerFacts(snapshot).map(([key, facts]) => [key, facts.authorizedBy?.subject] as const);
}

/** Forgets every entry of this Mate the snapshot has settled: the server has caught up. */
export function localSignersSettledBy(
  environmentId: string,
  snapshot: ZeropsAgentAuthSnapshot,
): void {
  const current = readLocalAgentSigners(environmentId);
  const settled = signerFacts(snapshot).filter(([key, facts]) => {
    const local = current[key];
    return local !== undefined && !localSignerStands(local, facts);
  });
  if (settled.length === 0) return;
  const next: Partial<Record<string, string>> = { ...current };
  for (const [key] of settled) delete next[key];
  setLocalAgentSigners(environmentId, next);
}

/** This Mate's records written here and not read back yet. */
export function useLocalAgentSigners(environmentId: string | null | undefined): LocalAgentSigners {
  const read = () => readLocalAgentSigners(environmentId);
  return useSyncExternalStore(subscribeLocalAgentSigners, read, read);
}

/** Every Mate's records written here and not read back yet: each Mate's, by its environment. */
export function useLocalAgentSignersByEnvironment(): (environmentId: string) => LocalAgentSigners {
  const all = useSyncExternalStore(
    subscribeLocalAgentSigners,
    readAllLocalAgentSigners,
    readAllLocalAgentSigners,
  );
  return useCallback((environmentId) => signersOf(all, environmentId), [all]);
}

/** The login a signer comes from, as a snapshot row carries it. */
export interface AgentSignerFacts {
  readonly authorizedBy?: { readonly subject: string } | undefined;
  readonly login?:
    | {
        readonly phase: ZeropsAgentLoginPhase;
        readonly startedBy?: string | undefined;
        /** The latest attempt before this one that succeeded, where this one has not. */
        readonly lastSucceeded?: { readonly startedBy?: string | undefined } | undefined;
      }
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
 * Who signed this agent in, for ownership: the record this client is writing or wrote for the
 * latest sign-in, while the server has not read it back (`localSignerStands`), else the
 * snapshot's own record — or, where it names somebody other than whoever signed in last, that
 * person — else the viewer's own login while its code is being checked — else nobody. The viewer is the one person who knows what the record will say, so the seconds before
 * it lands never read as a sign-in nobody recorded, nor as the earlier signer's.
 */
export function resolveAgentAuthorizer(
  key: string,
  agent: AgentSignerFacts,
  local: LocalAgentSigners,
  viewer: string | undefined,
): { readonly subject: string } | undefined {
  const subject = local[key];
  if (subject !== undefined && localSignerStands(subject, agent)) return { subject };
  if (agent.authorizedBy !== undefined) {
    // Whoever signed in last holds the credential: a record naming anybody else runs nothing
    // (`ZeropsProjectSigners`' gate), so it is not whose the agent is.
    const latest = latestSignInBy(agent.login);
    if (latest !== undefined && latest.length > 0 && latest !== agent.authorizedBy.subject) {
      return { subject: latest };
    }
    return { subject: agent.authorizedBy.subject };
  }
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

/** Whether the latest sign-in of this login is somebody other than `userId`'s. */
function signedInSinceBySomebodyElse(
  snapshot: ZeropsAgentAuthSnapshot | null,
  key: string,
  userId: string | undefined,
): boolean {
  if (snapshot === null) return false;
  const facts = signerFacts(snapshot).find(([candidate]) => candidate === key)?.[1];
  const latest = latestSignInBy(facts?.login);
  return latest !== undefined && latest.length > 0 && latest !== userId;
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
  // The snapshot as last read, for a write about to go out: somebody may have signed in since.
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;

  useEffect(() => {
    if (snapshot !== null && environmentId !== null) localSignersSettledBy(environmentId, snapshot);
  }, [environmentId, snapshot]);

  const writeRecord = useCallback(
    async (key: string, signal: AbortSignal): Promise<boolean> => {
      if (
        environmentId === null ||
        projectId === undefined ||
        orgId === undefined ||
        !userId ||
        data === null
      ) {
        return false;
      }
      // Somebody else has signed in since this person did: writing their record now would put it
      // over the record of that later sign-in. Theirs is not this person's to write any more.
      if (signedInSinceBySomebodyElse(latestSnapshot.current, key, userId)) {
        forgetLocalAgentSigner(environmentId, key);
        return false;
      }
      // The record counts as the viewer's while it is written, and stops counting if it fails.
      rememberLocalAgentSigner(environmentId, key, userId);
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
        rememberLocalAgentSigner(environmentId, key, userId);
        setRecordFailed((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        return true;
      } catch {
        forgetLocalAgentSigner(environmentId, key);
        if (signal.aborted) return false;
        // Surfaced (H13): the card says nobody is recorded and the agent
        // refuses the turn, and `retry` is how signing in again would have
        // fixed it anyway — offered without asking the person to sign out.
        setRecordFailed((current) => new Set(current).add(key));
        return false;
      }
    },
    [data, environmentId, orgId, projectId, userId],
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
  // is no longer a failure here; nor one somebody else has signed in over since,
  // whose retry would write this person's tag over theirs.
  const unsettledFailed = useMemo(() => {
    const settled = (snapshot === null ? [] : recordedSigners(snapshot)).filter(
      ([key, signer]) =>
        recordFailed.has(key) &&
        (signer === userId || signedInSinceBySomebodyElse(snapshot, key, userId)),
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

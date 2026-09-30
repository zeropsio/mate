/**
 * The crew exactly as closed as its conversations (D6). A crewmate runs on a
 * login somebody signed in, and only that person runs it: a viewer who may not
 * run a login the crew runs on is offered nothing that runs or changes what
 * runs on it, and reads everything else — the rows, the plan, the crewmates'
 * conversations, what went into the Mate's code.
 *
 * The same answer the server's door reaches (`crewAccess.ts` there,
 * `ZeropsTurnAdmission.admitOperator`), so a press that is offered never meets
 * a refusal and one that is not never hides a press that would have worked. A
 * press reaches the logins `crewCommandReach` names, resolved against the
 * snapshot as the engine resolves them against its tables
 * (`crewReachLogins`). A login is closed where a conversation on it would not
 * run for the viewer, read as `ChatView` reads its own agent
 * (`resolveAgentOwnership`: whose it is, never whether it works this minute;
 * a project token's never), from facts the caller resolves as it does.
 *
 * Pure: no clock, no I/O.
 *
 * @module crewAccess
 */
import {
  crewCommandReach,
  crewReachLogins,
  type CrewCommand,
  type CrewCommandReach,
  type CrewLoginRoster,
  type CrewSnapshot,
  type ZeropsAgentAuth,
  type ZeropsAgentId,
} from "@t3tools/contracts";

import {
  agentOwnershipAllowsTurns,
  resolveAgentOwnership,
  type ZeropsAgentAuthorizer,
  type ZeropsAgentOwnership,
} from "../agentOwnership.ts";

/** Why a login is not the viewer's to run: somebody else's, nobody's on record, or their own record failed. */
export type CrewLockOwnership = Exclude<ZeropsAgentOwnership, "mine" | "none">;

/** A login the viewer may not run, and whose sign-in its one way out opens. */
export interface CrewLock {
  /** The login: a provider instance id. */
  readonly login: string;
  readonly agentId: ZeropsAgentId;
  readonly ownership: CrewLockOwnership;
}

/** A login as its conversation reads it (`resolveSpentLogin`, `resolveAgentAuthorizer`). */
export interface CrewLoginFacts {
  /** Its agent's row — a login beyond the defaults as one (`mateLoginAsAgentRow`). */
  readonly agent: Pick<ZeropsAgentAuth, "agentId" | "credPresent" | "flagToken">;
  /** Its recorded signer, this browser's own record counted until the feed carries it. */
  readonly authorizedBy: ZeropsAgentAuthorizer | undefined;
  /** This browser's own record of signing it in failed (H13). */
  readonly recordFailed: boolean;
}

/** `null` where the viewer may run `login`: theirs, a project token's, or nobody's (no facts, no credential). */
export function crewLoginLock(
  login: string,
  facts: CrewLoginFacts | undefined,
  viewerSubject: string | undefined,
): CrewLock | null {
  if (facts === undefined || facts.agent.flagToken) return null;
  const ownership = resolveAgentOwnership({
    credPresent: facts.agent.credPresent,
    authorizedBy: facts.authorizedBy,
    viewerSubject,
    recordFailed: facts.recordFailed,
  });
  if (agentOwnershipAllowsTurns(ownership)) return null;
  return { login, agentId: facts.agent.agentId, ownership: ownership as CrewLockOwnership };
}

/** The crew as a reach resolves against it, from the snapshot as the engine does from its tables. */
export function crewSnapshotRoster(
  snapshot: Pick<CrewSnapshot, "crewmates" | "board" | "hosts">,
  home?: CrewLoginRoster["home"],
): CrewLoginRoster {
  return {
    crewmates: snapshot.crewmates.map((mate) => ({
      handle: mate.handle,
      kind: mate.kind,
      login: mate.login.id,
    })),
    ownerOf: (taskId) => snapshot.board.tasks.find((task) => task.id === taskId)?.owner,
    claimOf: (host) =>
      snapshot.hosts.find((entry) => entry.host === host)?.claim.handle ?? undefined,
    ...(home === undefined ? {} : { home }),
  };
}

/** What a viewer may run or change on a crew: each lock `null` where it is theirs. */
export interface CrewAccess {
  /** Whose the logins are is still being read: a press waits for the answer. */
  readonly reading: boolean;
  /** The lock `command` meets. */
  readonly command: (command: CrewCommand) => CrewLock | null;
  /** The lock `reach` meets, a crew home's logins counted where it names them. */
  readonly reach: (reach: CrewCommandReach, home?: CrewLoginRoster["home"]) => CrewLock | null;
  /** One crewmate: what it is on, its conversation, its app, its job. */
  readonly crewmate: (handle: string) => CrewLock | null;
  /** One login: a job's new *Runs on*, the chat an ask for the Mate goes to. */
  readonly login: (login: string) => CrewLock | null;
  /** The whole crew — a run, the goal, a crewmate added; a crew nobody set up yet, on its default login. */
  readonly crew: CrewLock | null;
  /**
   * Apply of a crew home: every crewmate's login, and every one the home
   * names — a crewmate naming none runs on the default.
   */
  readonly home: (
    members: ReadonlyArray<{ readonly handle: string; readonly login?: string | undefined }>,
  ) => CrewLock | null;
  /** The composer: to the lead's login, or without a lead to anybody the viewer may pick. */
  readonly composer: CrewLock | null;
}

export function crewAccess(input: {
  readonly snapshot: Pick<CrewSnapshot, "crewmates" | "board" | "hosts"> | null;
  readonly lockOf: (login: string) => CrewLock | null;
  /** The login a crewmate the crew home names none for runs on: the project's default. */
  readonly defaultLogin: string;
  readonly reading: boolean;
}): CrewAccess {
  const { lockOf } = input;
  const crewmates = input.snapshot?.crewmates ?? [];
  const roster = (home?: CrewLoginRoster["home"]) =>
    crewSnapshotRoster(input.snapshot ?? { crewmates: [], board: { tasks: [] }, hosts: [] }, home);
  const first = (logins: ReadonlyArray<string>) =>
    logins.map(lockOf).find((lock) => lock !== null) ?? null;
  const reach = (target: CrewCommandReach, home?: CrewLoginRoster["home"]) =>
    first(crewReachLogins(target, roster(home)));
  const crew = crewmates.length === 0 ? lockOf(input.defaultLogin) : reach({ kind: "crew" });
  const lead = crewmates.find((mate) => mate.kind === "lead");
  const composer =
    crewmates.length === 0
      ? crew
      : lead !== undefined
        ? lockOf(lead.login.id)
        : crewmates.some((mate) => lockOf(mate.login.id) === null)
          ? null
          : crew;
  return {
    reading: input.reading,
    command: (command) => reach(crewCommandReach(command)),
    reach,
    crewmate: (handle) => reach({ kind: "crewmates", handles: [handle] }),
    login: lockOf,
    crew,
    home: (members) =>
      reach(
        { kind: "home" },
        members.map((member) => ({
          handle: member.handle,
          login: member.login ?? input.defaultLogin,
        })),
      ),
    composer,
  };
}

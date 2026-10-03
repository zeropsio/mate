/**
 * ZeropsMembershipWatch — the half of the door that keeps working after the
 * caller has gone.
 *
 * A session minted at the throwaway door (`ZeropsThrowawayIdentity`) holds
 * nothing of the person's: there is no token to re-present, and so nothing
 * that stops working when their rights change. The old shape papered over that
 * by making the session short and having the client re-mint every fifteen
 * minutes — which meant a person's Zerops token arriving at a container four
 * times an hour, forever.
 *
 * So the server asks instead. Every few minutes it re-reads the org's member
 * list and this project's `userRoles` **with its own key**, runs the same role
 * function the door ran, and ends every session whose answer is no longer
 * `open`. Removal, a lowered role and a project override all land the same
 * way, within one interval. The client notices its session is gone, mints a
 * fresh throwaway, and is told the new answer at the door.
 *
 * ## Two reads, not two per person
 *
 * The member list and the project are the same two documents whoever is
 * signed in, so one pass costs two calls however many people are connected —
 * and the member list is the one the door and the signers read too, read once
 * for all of them (`ZeropsOrgRead`).
 *
 * ## A failed read keeps people in, once
 *
 * A platform blip must not throw a room full of people out, and it must not
 * become a way to stay in either. One failed pass changes nothing; a second
 * consecutive failure ends every Zerops session, because by then the server
 * has been unable to say who belongs here for two intervals running. The
 * counter resets on the first pass that reads. So a changed answer lands
 * within two intervals at worst, and the interval is never longer than
 * `MAX_ZEROPS_ROLE_RECHECK_SECONDS` (`ZeropsEnvironment.ts`).
 *
 * ## The day rule
 *
 * A session older than {@link ZeropsEnvironment.sessionMaxAge} ends whatever
 * the read said — including on a pass that could not read. It is not a
 * security window (role changes are caught in minutes); it is the promise that
 * nothing runs forever on one proof.
 *
 * @module ZeropsMembershipWatch
 */
import type { AuthSessionId } from "@t3tools/contracts";
import { opensForOf, readProjectRoles } from "@t3tools/shared/mateAccess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

import * as ServerConfig from "../config.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsIdentityStatusModule from "./ZeropsIdentityStatus.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import { readMemberEntries, ZeropsOrgRead } from "./ZeropsOrgRead.ts";

/** The subject prefix every session the Zerops door mints carries. */
export const ZEROPS_SUBJECT_PREFIX = "zerops-user:";

/** The Zerops user id behind a session subject; any other subject is kept whole, and matches no Zerops user. */
export const zeropsUserIdOf = (subject: string): string =>
  subject.startsWith(ZEROPS_SUBJECT_PREFIX) ? subject.slice(ZEROPS_SUBJECT_PREFIX.length) : subject;

/** One live session, as much of it as this decision needs. */
export interface WatchedSession {
  readonly sessionId: string;
  readonly subject: string;
  readonly issuedAtEpochMs: number;
}

/** What one pass of the two reads produced, or that it produced nothing. */
export type MembershipRead =
  | {
      readonly ok: true;
      /** Every Zerops user id this project still opens for. */
      readonly opensFor: ReadonlySet<string>;
    }
  | { readonly ok: false };

export interface MembershipRecheckPlan {
  /** Sessions to end, in the order they were listed. */
  readonly endSessions: ReadonlyArray<string>;
  /** Consecutive failed passes, to carry into the next one. */
  readonly failures: number;
}

/**
 * What one pass should do. Pure: the reads, the clock and the revocations are
 * the caller's, so every rule here is a table row rather than a timing test.
 */
export function planMembershipRecheck(input: {
  readonly sessions: ReadonlyArray<WatchedSession>;
  readonly read: MembershipRead;
  readonly nowEpochMs: number;
  readonly maxSessionAgeMs: number;
  /** Consecutive failures BEFORE this pass. */
  readonly failures: number;
}): MembershipRecheckPlan {
  const failures = input.read.ok ? 0 : input.failures + 1;
  // One failed pass is a blip and changes nothing. Two in a row means the
  // server has not known who belongs here for two intervals, and guessing
  // "still them" is the guess that keeps a removed person in.
  const blind = !input.read.ok && failures > 1;

  const endSessions: Array<string> = [];
  for (const session of input.sessions) {
    if (!session.subject.startsWith(ZEROPS_SUBJECT_PREFIX)) continue;
    if (input.nowEpochMs - session.issuedAtEpochMs >= input.maxSessionAgeMs) {
      endSessions.push(session.sessionId);
      continue;
    }
    if (!input.read.ok) {
      if (blind) endSessions.push(session.sessionId);
      continue;
    }
    const userId = session.subject.slice(ZEROPS_SUBJECT_PREFIX.length);
    if (!input.read.opensFor.has(userId)) endSessions.push(session.sessionId);
  }
  return { endSessions, failures };
}

/**
 * The two reads, as the Mate. Answers `{ok: false}` for every failure alike —
 * the API down, a body that does not parse, no key of our own — because the
 * plan treats them the same and a caller that had to tell them apart would
 * have to decide which ones mean "throw everyone out".
 */
export const readProjectMembership = Effect.fn("ZeropsMembershipWatch.read")(function* (input: {
  readonly environment: ZeropsEnvironment;
}) {
  const { apiBaseUrl, projectId } = input.environment;
  const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
  const identityStatus = yield* ZeropsIdentityStatusModule.ZeropsIdentityStatus;

  // Both reads are the ones the door and the signers make too, read once for
  // all of them. The project's is also the read the descriptor's `identity`
  // field reports (S4).
  const orgRead = yield* ZeropsOrgRead;
  const own = yield* orgRead.project({ apiBaseUrl, projectId });
  yield* identityStatus.record({
    ok: own.kind === "answered" && own.status === 200,
    keySource: yield* mateKey.lastSource,
  });
  if (own.kind !== "answered" || own.status !== 200) return { ok: false } as const;
  const project = readProjectRoles(own.body);
  if (project === null) return { ok: false } as const;

  const members = yield* orgRead.members({ apiBaseUrl, clientId: project.clientId });
  if (members.kind !== "answered" || members.status !== 200) return { ok: false } as const;
  const entries = readMemberEntries(members.body);
  // An unreadable list is an outage; an empty one would be a lockout dressed
  // as an answer, so it is read as an outage too.
  if (entries === null || entries.length === 0) return { ok: false } as const;

  return { ok: true, opensFor: opensForOf(projectId, project, entries) } as const;
});

export class ZeropsMembershipWatch extends Context.Service<
  ZeropsMembershipWatch,
  {
    /** Runs one pass now and answers how many sessions it ended. */
    readonly recheckNow: Effect.Effect<number>;
  }
>()("t3/zerops/ZeropsMembershipWatch") {}

/**
 * One pass, given everything it needs. Exported so a test can run exactly one
 * and look at what it did.
 */
export const runMembershipRecheck = Effect.fn("ZeropsMembershipWatch.pass")(function* (input: {
  readonly environment: ZeropsEnvironment;
  readonly failures: Ref.Ref<number>;
}) {
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const sessions = yield* serverAuth
    .listSessions()
    .pipe(Effect.catchCause(() => Effect.succeed([])));
  if (sessions.length === 0) return 0;

  const read = yield* readProjectMembership({ environment: input.environment });
  const now = yield* DateTime.now;
  const plan = planMembershipRecheck({
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      subject: session.subject,
      issuedAtEpochMs: session.issuedAt.epochMilliseconds,
    })),
    read,
    nowEpochMs: now.epochMilliseconds,
    maxSessionAgeMs: Duration.toMillis(input.environment.sessionMaxAge),
    failures: yield* Ref.get(input.failures),
  });
  yield* Ref.set(input.failures, plan.failures);

  for (const sessionId of plan.endSessions) {
    yield* serverAuth
      .revokeSession(sessionId as AuthSessionId)
      .pipe(Effect.catchCause(() => Effect.succeed(false)));
  }
  return plan.endSessions.length;
});

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const environment = config.zerops;
  const failures = yield* Ref.make(0);
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  // The process-wide reader, identity status and member list read once for
  // all, shared with the door and the signers gate — provided by the layer
  // this service's own layer composes above (`zeropsFeedsLayer.ts`).
  const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
  const identityStatus = yield* ZeropsIdentityStatusModule.ZeropsIdentityStatus;
  const orgRead = yield* ZeropsOrgRead;

  const recheckNow: ZeropsMembershipWatch["Service"]["recheckNow"] =
    environment === undefined
      ? Effect.succeed(0)
      : runMembershipRecheck({ environment, failures }).pipe(
          Effect.provideService(EnvironmentAuth.EnvironmentAuth, serverAuth),
          Effect.provideService(ZeropsMateKeyModule.ZeropsMateKey, mateKey),
          Effect.provideService(ZeropsIdentityStatusModule.ZeropsIdentityStatus, identityStatus),
          Effect.provideService(ZeropsOrgRead, orgRead),
          // A pass that dies must not take the loop with it: the next one is
          // minutes away and is the recovery.
          Effect.catchCause(() => Effect.succeed(0)),
        );

  if (environment !== undefined) {
    yield* Effect.forkScoped(
      recheckNow.pipe(Effect.repeat(Schedule.spaced(environment.roleRecheckInterval))),
    );
  }

  return ZeropsMembershipWatch.of({ recheckNow });
});

export const layer = Layer.effect(ZeropsMembershipWatch, make);

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
 * So the server asks instead. Every few minutes — and at once whenever HQ
 * sends a different list — it asks who the project lets in, as HQ's access
 * list says (`ZeropsMateAccessList`), and ends every session whose entry is no
 * longer `open`. While HQ says the organisation's key was refused, the list
 * opens for nobody. Removal, a lowered role and a project override all land
 * the same way, within one interval. The client notices its session is gone,
 * mints a fresh throwaway, and is told the new answer at the door.
 *
 * ## One answer, not one per person
 *
 * Who the project lets in is the same whoever is signed in, so one pass asks
 * once however many people are connected. Each pass also reads this Mate's
 * own project with its own key, read once for the door and the signers too
 * (`ZeropsOrgRead`): the descriptor reports what it answered (S4).
 *
 * ## A failed read keeps people in, for a bounded time
 *
 * A platform blip must not throw a room full of people out, and it must not
 * become a way to stay in either. A pass that cannot say changes nothing while
 * the last list still holds — `ACCESS_LIST_HOLDS` from when it was heard, the
 * same rule a scheduled turn follows (`ZeropsProjectSigners`); past that, it
 * ends every Zerops session. While Zerops answers, a changed answer lands
 * within one interval of the newest answer that still named them
 * (`DEFAULT_ZEROPS_ROLE_RECHECK_SECONDS`, `ZeropsEnvironment.ts`).
 *
 * ## The day rule
 *
 * A session older than {@link ZeropsEnvironment.sessionMaxAge} ends whatever
 * the read said — including on a pass that could not read. It is not a
 * security window (role changes are caught within a minute); it is the promise that
 * nothing runs forever on one proof.
 *
 * @module ZeropsMembershipWatch
 */
import type { AuthSessionId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsIdentityStatusModule from "./ZeropsIdentityStatus.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import { ZeropsOrgRead } from "./ZeropsOrgRead.ts";
import { ACCESS_LIST_HOLDS, ZeropsMateAccessList } from "./ZeropsMateAccessList.ts";

/** Whether a list heard at `heardAtMs` still holds at `nowMs` with no newer one. */
const accessHolds = (heardAtMs: number, nowMs: number): boolean =>
  nowMs - heardAtMs <= Duration.toMillis(ACCESS_LIST_HOLDS);

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
}

/** The last answer that said who the project lets in: when Zerops answered it. */
export interface LastGoodRead {
  readonly atMs: number;
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
  /** The last good answer before this pass. */
  readonly lastGood: LastGoodRead;
}): MembershipRecheckPlan {
  // A failed read is a blip while the last answer holds. Past that the server
  // has not known who belongs here for too long, and guessing "still them" is
  // the guess that keeps a removed person in.
  const blind = !input.read.ok && !accessHolds(input.lastGood.atMs, input.nowEpochMs);

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
  return { endSessions };
}

/**
 * Reads this Mate's own project with its own key — read once for the door, the watch and the
 * signers (`ZeropsOrgRead`) — and records what it answered for the descriptor (S4).
 */
export const recordIdentity = Effect.fn("ZeropsMembershipWatch.recordIdentity")(function* (input: {
  readonly environment: ZeropsEnvironment;
}) {
  const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
  const identityStatus = yield* ZeropsIdentityStatusModule.ZeropsIdentityStatus;
  const own = yield* (yield* ZeropsOrgRead).project({
    apiBaseUrl: input.environment.apiBaseUrl,
    projectId: input.environment.projectId,
  });
  yield* identityStatus.record({
    ok: own.kind === "answered" && own.status === 200,
    keySource: yield* mateKey.lastSource,
  });
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
  readonly lastGood: Ref.Ref<LastGoodRead>;
}) {
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const sessions = yield* serverAuth
    .listSessions()
    .pipe(Effect.catchCause(() => Effect.succeed([])));
  const now = yield* DateTime.now;
  // Nobody signed in: no answer is kept from anyone, and whoever signs in next is let in by the
  // door's own answer.
  if (sessions.length === 0) {
    yield* Ref.set(input.lastGood, { atMs: now.epochMilliseconds });
    return 0;
  }

  yield* recordIdentity({ environment: input.environment });
  const access = Option.getOrUndefined(yield* (yield* ZeropsMateAccessList).current);
  const read: MembershipRead =
    access === undefined
      ? { ok: false }
      : {
          ok: true,
          opensFor: new Set(
            access.refused
              ? []
              : access.members
                  .filter((member) => member.visibility === "open")
                  .map((member) => member.userId),
          ),
        };
  const lastGood = yield* Ref.get(input.lastGood);
  const plan = planMembershipRecheck({
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      subject: session.subject,
      issuedAtEpochMs: session.issuedAt.epochMilliseconds,
    })),
    read,
    nowEpochMs: now.epochMilliseconds,
    maxSessionAgeMs: Duration.toMillis(input.environment.sessionMaxAge),
    lastGood,
  });
  if (access !== undefined && access.heardAtMs >= lastGood.atMs) {
    yield* Ref.set(input.lastGood, { atMs: access.heardAtMs });
  }

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
  // As if Zerops last answered as long ago as an answer holds: the pass at start that cannot say
  // is the one tolerated, the next ends every session.
  const lastGood = yield* Ref.make<LastGoodRead>({
    atMs: (yield* DateTime.now).epochMilliseconds - Duration.toMillis(ACCESS_LIST_HOLDS),
  });
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const accessList = yield* ZeropsMateAccessList;
  // The process-wide reader, identity status and member list read once for
  // all, shared with the door and the signers gate — provided by the layer
  // this service's own layer composes above (`zeropsFeedsLayer.ts`).
  const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
  const identityStatus = yield* ZeropsIdentityStatusModule.ZeropsIdentityStatus;
  const orgRead = yield* ZeropsOrgRead;

  const recheckNow: ZeropsMembershipWatch["Service"]["recheckNow"] =
    environment === undefined
      ? Effect.succeed(0)
      : runMembershipRecheck({ environment, lastGood }).pipe(
          Effect.provideService(EnvironmentAuth.EnvironmentAuth, serverAuth),
          Effect.provideService(ZeropsMateAccessList, accessList),
          Effect.provideService(ZeropsMateKeyModule.ZeropsMateKey, mateKey),
          Effect.provideService(ZeropsIdentityStatusModule.ZeropsIdentityStatus, identityStatus),
          Effect.provideService(ZeropsOrgRead, orgRead),
          // A pass that dies must not take the loop with it: the next one is
          // the recovery.
          Effect.catchCause(() => Effect.succeed(0)),
        );

  if (environment !== undefined) {
    yield* Effect.forkScoped(
      recheckNow.pipe(Effect.repeat(Schedule.spaced(environment.roleRecheckInterval))),
    );
    // HQ sent a different list: it lands now, not at the next interval.
    yield* Effect.forkScoped(Stream.runForEach(accessList.changes, () => recheckNow));
  }

  return ZeropsMembershipWatch.of({ recheckNow });
});

export const layer = Layer.effect(ZeropsMembershipWatch, make);

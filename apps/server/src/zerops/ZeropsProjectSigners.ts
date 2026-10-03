/**
 * ZeropsProjectSigners — whose login a turn would spend, and the gate that asks.
 *
 * ## Whose a login is
 *
 * An agent CLI's credential is a *personal* one: under the vendors' consumer
 * terms a subscription login is yours to use on your own machines and nobody
 * else's. A Zerops project has members, though, and everyone who can open this
 * Mate reaches the same agent — so the product has to know whose identity a
 * turn is about to spend, and refuse the ones that are not theirs (D6).
 *
 * The record is what this server saw: the person whose door session started
 * the sign-in that succeeded here (`ZeropsAgentLogin`), kept across restarts
 * beside the logins' homes (`zeropsSignIns`). Nobody writes it from outside —
 * not a project member by API, not the app. Forging it needs access to this
 * container, and that access already holds the login's credential.
 *
 * Said out loud, because it matters: this is a guardrail, not a lock. Everyone
 * who can open a Mate can also write in it and open a terminal as the agent's
 * user, so any of them could copy the credential file. What D6 buys is that an
 * org owner or admin does not run a colleague's agent by habit or by accident,
 * and that there is a record of who signed it in. It does not claim to stop
 * theft.
 *
 * ## Who may still use it
 *
 * `hasProjectAccess` is the one answer to whether a person may use this Mate
 * at all — the one that keeps their session open — for a turn no session of
 * theirs stands behind (X3), and for offboarding, which signs every login of a
 * person it says no for out (`ZeropsOffboarding`, X4).
 *
 * @module ZeropsProjectSigners
 */
import type {
  OrchestrationThreadActivity,
  ZeropsAgentAuth,
  ZeropsAgentId,
  ZeropsAgentLoginState,
  ZeropsLoginState,
} from "@t3tools/contracts";
import {
  classifyZeropsAgentAuth,
  type ZeropsAgentAuthFields,
  type ZeropsAgentAuthKind,
} from "@t3tools/shared/zeropsAgentAuth";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../config.ts";
import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { readMemberEntries, ZeropsOrgRead } from "./ZeropsOrgRead.ts";
import { opensForOf, readProjectRoles } from "./ZeropsMembershipWatch.ts";
import { ZeropsSignIns, type SignInRecords } from "./zeropsSignIns.ts";

/**
 * How long the last answer to "may this person use this Mate" holds while reads fail (D7): a
 * person whose access went keeps running turns no longer than this, as HQ's own view (X7).
 */
export const ACCESS_HOLDS = Duration.minutes(5);

/**
 * Signer key → the Zerops user id of whoever this server saw sign that login
 * in. The keys are the agent ids for the two default logins and the login's
 * own id for every other one (`zeropsLoginIds.ts`).
 */
export type ProjectSigners = Readonly<Record<string, string>>;

/** The signers out of the sign-ins this server kept. */
const signersOf = (records: SignInRecords): ProjectSigners =>
  Object.fromEntries(Object.entries(records).map(([key, record]) => [key, record.by]));

/** Why a turn may not start on an agent, or `undefined` when it may. */
export type TurnRefusal =
  /** The agent is not signed in on this project: the turn would only fail inside its CLI. */
  | {
      readonly kind: "not-signed-in";
      readonly auth: Exclude<ZeropsAgentAuthKind["kind"], "authorized" | "registering">;
    }
  /** Signed in, but no signer was recorded for it. */
  | { readonly kind: "unrecorded" }
  /** Signed in by somebody other than this session's person. */
  | { readonly kind: "someone-else" };

/**
 * Whether this session may start a turn on this agent.
 *
 * - an agent that is **not signed in** (never, or its login no longer works)
 *   is refused first: nothing it would run can succeed;
 * - a **token**-authorized agent is nobody's personal login, so it is
 *   unaffected by D6: `flagToken` means the container was given an API key,
 *   and an API key belongs to the project;
 * - an agent whose recorded signer **is** this session's subject: yes;
 * - anything else — someone else's, or no record at all — no. D6 keeps no
 *   backward compatibility here: a login with no recorded signer (an older
 *   one, a terminal login, a copied file) cannot run until somebody signs in
 *   through Mate, because "unrecorded" and "somebody else's" are the same
 *   thing to everyone but the person who knows.
 */
export function turnRefusal(input: {
  readonly agent: ZeropsAgentAuthFields & Pick<ZeropsAgentAuth, "flagToken">;
  readonly signer: string | undefined;
  readonly subject: string | undefined;
}): TurnRefusal | undefined {
  return loginTurnRefusal({
    state: classifyZeropsAgentAuth(input.agent).kind,
    token: input.agent.flagToken,
    signer: input.signer,
    subject: input.subject,
  });
}

/**
 * {@link turnRefusal} for any login, from its classified state: a default
 * login's comes from its agent row, another login's from its own check. The
 * same order — signed in at all, then a project token, then whose it is.
 */
export function loginTurnRefusal(input: {
  readonly state: ZeropsLoginState;
  readonly token: boolean;
  readonly signer: string | undefined;
  readonly subject: string | undefined;
}): TurnRefusal | undefined {
  if (input.state !== "authorized" && input.state !== "registering") {
    return { kind: "not-signed-in", auth: input.state };
  }
  if (input.token) return undefined;
  if (input.signer === undefined || input.signer.length === 0) return { kind: "unrecorded" };
  return input.subject === input.signer ? undefined : { kind: "someone-else" };
}

/**
 * The commands that spend somebody's subscription by starting a turn. Every
 * other command — interrupting a runaway turn, archiving, renaming — stays
 * open to every member who can open the Mate: a colleague must be able to stop
 * an agent they are not allowed to start.
 *
 * An answer to a question the agent asked in message mode is one of them: its
 * turn has ended, and the decider starts a new one with the answer as the
 * message. An answer to a native callback question is not — the agent's turn
 * is still running and waits on it. `request` is the question's latest
 * activity, which only an answer needs.
 */
export function isTurnStartingCommand(
  command: { readonly type: string },
  request?: Pick<OrchestrationThreadActivity, "kind" | "payload">,
): boolean {
  if (command.type === "thread.turn.start") return true;
  if (command.type !== "thread.user-input.respond" || request === undefined) return false;
  return (
    request.kind === "user-input.requested" &&
    typeof request.payload === "object" &&
    request.payload !== null &&
    (request.payload as { readonly responseMode?: unknown }).responseMode === "message"
  );
}

/**
 * How long a turn waits on a code being checked whose outcome decides it: a success makes the
 * login its person's, a failure leaves it the signer's before. The CLI writes the credential
 * before the walker sees the success, so a turn admitted meanwhile could run on the new person's
 * credential — or refuse that very person a second before their sign-in lands (live runs,
 * 2026-09-30 and 2026-10-01).
 */
export const SIGN_IN_CHECK_WAIT = Duration.seconds(30);
const SIGN_IN_CHECK_POLL = Duration.seconds(1);

export class ZeropsProjectSigners extends Context.Service<
  ZeropsProjectSigners,
  {
    /** Who this server saw sign each login in (`zeropsSignIns`). */
    readonly signers: Effect.Effect<ProjectSigners>;
    /**
     * {@link turnRefusal} for this session on `agentId`, against who this server saw sign it in.
     * While a code is being checked on it whose outcome decides this turn, the turn waits up to
     * {@link SIGN_IN_CHECK_WAIT} for the check to settle, then goes by the sign-in it left.
     */
    readonly turnRefusal: (input: {
      readonly agentId: ZeropsAgentId;
      readonly agent: ZeropsAgentAuthFields & Pick<ZeropsAgentAuth, "flagToken">;
      readonly subject: string | undefined;
      /** The agent's server-driven login as this server holds it (`ZeropsAgentLogin`). */
      readonly login?: ZeropsAgentLoginState | undefined;
      /** That login as it stands now, read again while the turn waits on it. */
      readonly currentLogin?: Effect.Effect<ZeropsAgentLoginState | undefined> | undefined;
    }) => Effect.Effect<TurnRefusal | undefined>;
    /** {@link loginTurnRefusal} for this session on the login keyed `key`, as `turnRefusal`. */
    readonly loginRefusal: (input: {
      readonly key: string;
      readonly state: ZeropsLoginState;
      readonly token: boolean;
      readonly subject: string | undefined;
      /** That login's server-driven sign-in as this server holds it (`ZeropsAgentLogin`). */
      readonly login?: ZeropsAgentLoginState | undefined;
      /** That login as it stands now, read again while the turn waits on it. */
      readonly currentLogin?: Effect.Effect<ZeropsAgentLoginState | undefined> | undefined;
    }) => Effect.Effect<TurnRefusal | undefined>;
    /**
     * Whether this project opens for `userId` — the door's own rule, over the project's roles and
     * the org's member list, the answer that keeps a session open (`ZeropsMembershipWatch`) — from
     * a read no older than `ORG_READ_MAX_AGE` (`ZeropsOrgRead`). What admits a turn no session
     * stands behind: the crew's, the stand-up's (X3). While reads fail, the last answer holds
     * {@link ACCESS_HOLDS} from its read; past that, or with none, `undefined`.
     */
    readonly hasProjectAccess: (userId: string) => Effect.Effect<boolean | undefined>;
  }
>()("t3/zerops/ZeropsProjectSigners") {}

/**
 * Whether `body` claims the member list it carried is the whole thing.
 *
 * No paging field on `GET /client/{id}/user/list` has ever been measured
 * (`docs/internals/zerops/verified.md` — 21 members read back in one
 * unpaged `clientUserList`, no `nextCursor`, no `totalCount` seen on this
 * endpoint specifically). So a `totalCount` this build has never observed is
 * read defensively rather than ignored: present and it must match the row
 * count read, or the list is partial; absent, the whole array is the whole
 * list, matching every read measured so far.
 */
export function isMemberListComplete(body: unknown, entriesLength: number): boolean {
  if (typeof body !== "object" || body === null) return true;
  const totalCount = (body as Record<string, unknown>)["totalCount"];
  if (typeof totalCount !== "number" || !Number.isFinite(totalCount)) return true;
  return entriesLength >= totalCount;
}

/**
 * Every Zerops user this project opens for (`opensForOf`), or `undefined` when the project or
 * the member list is no usable answer — unreadable, empty, or a partial page (S6).
 */
const readProjectAccess = Effect.fn("ZeropsProjectSigners.readAccess")(function* (input: {
  readonly environment: ZeropsEnvironment;
}) {
  const { apiBaseUrl, projectId } = input.environment;
  const orgRead = yield* ZeropsOrgRead;
  const own = yield* orgRead.project({ apiBaseUrl, projectId });
  if (own.kind !== "answered" || own.status !== 200) return undefined;
  const project = readProjectRoles(own.body);
  if (project === null) return undefined;
  const members = yield* orgRead.members({ apiBaseUrl, clientId: project.clientId });
  if (members.kind !== "answered" || members.status !== 200) return undefined;
  const entries = readMemberEntries(members.body);
  if (entries === null || entries.length === 0) return undefined;
  if (!isMemberListComplete(members.body, entries.length)) return undefined;
  return opensForOf(projectId, project, entries);
});

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const environment = config.zerops;
  const signIns = yield* ZeropsSignIns;
  // The project and the member list read once for all, shared with the door
  // and the watch — provided by the layer this service's own layer composes
  // above (`zeropsFeedsLayer.ts`).
  const orgRead = yield* ZeropsOrgRead;
  /** Whom this project opened for at the last read that answered, and when that was. */
  const lastAccess = yield* Ref.make<
    { readonly opensFor: ReadonlySet<string>; readonly atMs: number } | undefined
  >(undefined);

  const hasProjectAccess: ZeropsProjectSigners["Service"]["hasProjectAccess"] = (userId) =>
    environment === undefined
      ? Effect.succeed(undefined)
      : Effect.gen(function* () {
          const read = yield* readProjectAccess({ environment }).pipe(
            Effect.provideService(ZeropsOrgRead, orgRead),
          );
          const now = yield* Clock.currentTimeMillis;
          if (read !== undefined) {
            yield* Ref.set(lastAccess, { opensFor: read, atMs: now });
            return read.has(userId);
          }
          const last = yield* Ref.get(lastAccess);
          return last !== undefined && now - last.atMs <= Duration.toMillis(ACCESS_HOLDS)
            ? last.opensFor.has(userId)
            : undefined;
        });

  const signers: ZeropsProjectSigners["Service"]["signers"] = signIns.load.pipe(
    Effect.map(signersOf),
  );

  /**
   * `base` against the signer of `key`, with the sign-in this server walks for that login. A
   * code being checked decides the turn when its person's success would change the answer — it
   * is this person's own sign-in over somebody else's, or somebody else's over this person's:
   * the turn waits for the check to settle, re-reading the login and the signer about a second
   * at a time, up to {@link SIGN_IN_CHECK_WAIT}. A check still deciding then refuses. A login at
   * its menu, its page or its code prompt has written nothing, and holds no turn.
   */
  const gateSignedIn = (
    key: string,
    base: (signer: string | undefined) => TurnRefusal | undefined,
    input: {
      readonly token: boolean;
      readonly subject: string | undefined;
      readonly login: ZeropsAgentLoginState | undefined;
      readonly currentLogin?: Effect.Effect<ZeropsAgentLoginState | undefined> | undefined;
    },
  ) =>
    Effect.gen(function* () {
      const person =
        input.subject !== undefined && input.subject.length > 0 ? input.subject : undefined;
      const decides = (login: ZeropsAgentLoginState | undefined, signer: string | undefined) =>
        !input.token &&
        person !== undefined &&
        login?.phase === "verifying-code" &&
        (login.startedBy === person) !== (signer === person);
      let login = input.login;
      let signer = (yield* signers)[key];
      const refusal = base(signer);
      if (refusal?.kind === "not-signed-in" || !decides(login, signer)) return refusal;
      const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(SIGN_IN_CHECK_WAIT);
      while (decides(login, signer) && (yield* Clock.currentTimeMillis) < deadline) {
        yield* Effect.sleep(SIGN_IN_CHECK_POLL);
        login = input.currentLogin === undefined ? input.login : yield* input.currentLogin;
        signer = (yield* signers)[key];
      }
      return decides(login, signer)
        ? (base(signer) ?? { kind: "someone-else" as const })
        : base(signer);
    });

  const gateTurn: ZeropsProjectSigners["Service"]["turnRefusal"] = ({
    agentId,
    agent,
    subject,
    login,
    currentLogin,
  }) =>
    gateSignedIn(agentId, (signer) => turnRefusal({ agent, signer, subject }), {
      token: agent.flagToken,
      subject,
      login,
      currentLogin,
    });

  const gateLogin: ZeropsProjectSigners["Service"]["loginRefusal"] = ({
    key,
    state,
    token,
    subject,
    login,
    currentLogin,
  }) =>
    gateSignedIn(key, (signer) => loginTurnRefusal({ state, token, signer, subject }), {
      token,
      subject,
      login,
      currentLogin,
    });

  return ZeropsProjectSigners.of({
    signers,
    turnRefusal: gateTurn,
    loginRefusal: gateLogin,
    hasProjectAccess,
  });
});

export const layer = Layer.effect(ZeropsProjectSigners, make);

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
 * the sign-in that succeeded here (`ZeropsAgentLogin`), and what HQ holds as
 * each login's last signer, sent on the link (`zeropsSignIns`) — how it
 * outlives a restart. No project member writes it by API, and neither does the
 * app. Forging it needs access to this container or to HQ's link, and the
 * container already holds the login's credential.
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
 * Whether a person who signed a login here may still run turns on it is not this record's: HQ
 * answers it as that person (`ZeropsSignerStanding`), for a turn no session of theirs stands
 * behind on that login (X3) and for offboarding, which signs every login of a person it hears has
 * lost the project out (`ZeropsOffboarding`, X4). HQ answers only for the signers it records, so a
 * turn no session stands behind on a login nobody signed (a project token, an agent with no
 * sign-in) is admitted by `hasProjectAccess`: the Mate's own access list, the answer that keeps a
 * session open (`ZeropsMateAccessList`), an opener, not a mere member.
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
  loginTurnRefusal,
  turnRefusal,
  type TurnRefusal,
  type ZeropsAgentAuthFields,
} from "@t3tools/shared/zeropsAgentAuth";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { ZeropsMateAccessList } from "./ZeropsMateAccessList.ts";
import { subscribeChanges } from "./zeropsChanges.ts";
import { ZeropsSignIns, type SignInRecords } from "./zeropsSignIns.ts";

/**
 * Signer key → the Zerops user id of whoever this server saw sign that login
 * in. The keys are the agent ids for the two default logins and the login's
 * own id for every other one (`zeropsLoginIds.ts`).
 */
export type ProjectSigners = Readonly<Record<string, string>>;

/** The signers out of the sign-ins this server kept. */
const signersOf = (records: SignInRecords): ProjectSigners =>
  Object.fromEntries(Object.entries(records).map(([key, record]) => [key, record.by]));

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

/** A login as it stands now, and when it may have changed (`ZeropsAgentLogin`'s pair). */
export interface CurrentLogin {
  readonly latest: Effect.Effect<ZeropsAgentLoginState | undefined>;
  readonly changes: Stream.Stream<unknown>;
}

export class ZeropsProjectSigners extends Context.Service<
  ZeropsProjectSigners,
  {
    /** Whose each login is, by this server's sign-ins and HQ's map (`zeropsSignIns`). */
    readonly signers: Effect.Effect<ProjectSigners>;
    /** Fires after each sign-in record is written, cleared or moved by HQ: `signers` may have moved. */
    readonly changes: Stream.Stream<void>;
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
      /** That login as it stands now, read again at each change while the turn waits on it. */
      readonly currentLogin?: CurrentLogin | undefined;
    }) => Effect.Effect<TurnRefusal | undefined>;
    /** {@link loginTurnRefusal} for this session on the login keyed `key`, as `turnRefusal`. */
    readonly loginRefusal: (input: {
      readonly key: string;
      readonly state: ZeropsLoginState;
      readonly token: boolean;
      readonly subject: string | undefined;
      /** That login's server-driven sign-in as this server holds it (`ZeropsAgentLogin`). */
      readonly login?: ZeropsAgentLoginState | undefined;
      /** That login as it stands now, read again at each change while the turn waits on it. */
      readonly currentLogin?: CurrentLogin | undefined;
    }) => Effect.Effect<TurnRefusal | undefined>;
    /**
     * Whether `userId` is an opener of this project, as the Mate's access list says — the
     * answer that keeps a connection open (`ZeropsConnections`). What admits a turn no session
     * stands behind on a login nobody signed (X3). The list holds at most 15 min from the read
     * that brought it (`ACCESS_LIST_HOLDS`); past that, or with none yet, `undefined`: nobody is
     * vouched for.
     */
    readonly hasProjectAccess: (userId: string) => Effect.Effect<boolean | undefined>;
  }
>()("t3/zerops/ZeropsProjectSigners") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const environment = config.zerops;
  const signIns = yield* ZeropsSignIns;
  // Who the project lets in, one list for the door, the watch and this — provided by the layer
  // this service's own layer composes above (`zeropsFeedsLayer.ts`).
  const accessList = yield* ZeropsMateAccessList;

  const hasProjectAccess: ZeropsProjectSigners["Service"]["hasProjectAccess"] = (userId) =>
    environment === undefined
      ? Effect.succeed(undefined)
      : Effect.gen(function* () {
          const list = Option.getOrUndefined(yield* accessList.current);
          const now = yield* Clock.currentTimeMillis;
          if (list === undefined || now > list.expiresAtMs) return undefined;
          return list.members.some(
            (member) => member.userId === userId && member.visibility === "open",
          );
        });

  const signers: ZeropsProjectSigners["Service"]["signers"] = signIns.load.pipe(
    Effect.map(signersOf),
  );

  /**
   * `base` against the signer of `key`, with the sign-in this server walks for that login. A
   * code being checked decides the turn when its person's success would change the answer — it
   * is this person's own sign-in over somebody else's, or somebody else's over this person's:
   * the turn waits for the check to settle, re-reading the login and the signer at each change of
   * either, up to {@link SIGN_IN_CHECK_WAIT}. A check still deciding then refuses. A login at
   * its menu, its page or its code prompt has written nothing, and holds no turn.
   */
  const gateSignedIn = (
    key: string,
    base: (signer: string | undefined) => TurnRefusal | undefined,
    input: {
      readonly token: boolean;
      readonly subject: string | undefined;
      readonly login: ZeropsAgentLoginState | undefined;
      readonly currentLogin?: CurrentLogin | undefined;
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
      const look = Effect.gen(function* () {
        if (input.currentLogin !== undefined) login = yield* input.currentLogin.latest;
        signer = (yield* signers)[key];
      });
      yield* Effect.scoped(
        Effect.gen(function* () {
          // Subscribed before the look, so no change after it goes unheard.
          const moved = yield* subscribeChanges([
            signIns.changes,
            ...(input.currentLogin === undefined ? [] : [input.currentLogin.changes]),
          ]);
          yield* look;
          while (decides(login, signer)) yield* moved.pipe(Effect.andThen(look));
        }),
      ).pipe(Effect.timeoutOrElse({ duration: SIGN_IN_CHECK_WAIT, orElse: () => Effect.void }));
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
    changes: signIns.changes,
    turnRefusal: gateTurn,
    loginRefusal: gateLogin,
    hasProjectAccess,
  });
});

export const layer = Layer.effect(ZeropsProjectSigners, make);

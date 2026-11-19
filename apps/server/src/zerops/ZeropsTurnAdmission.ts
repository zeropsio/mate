/**
 * ZeropsTurnAdmission — decides whose login a run, a crew press or a
 * generation may spend (D6), through {@link ZeropsTurnAdmission.admitRun},
 * {@link ZeropsTurnAdmission.admitOperator} and
 * {@link ZeropsTurnAdmission.admitGeneration}.
 *
 * A turn starts only on an agent that is signed in on this project, and only
 * for the person who signed it in. A login beyond the two defaults
 * (`ZeropsLogins`) is gated on its own state and its own signer — never its
 * agent's (D6 per login, PRD §2.3). Any other instance is gated as its
 * driver's default login. An agent Mate never signs anybody in to, and an
 * agent authorized by a token rather than by a personal login, are both
 * unaffected — a token belongs to the project.
 *
 * The record is what this server saw: the person whose session started the
 * sign-in that succeeded here, kept beside the logins' homes
 * (`zeropsSignIns`). No record refuses: "nobody recorded it" and "somebody
 * else's" are the same thing to everyone but the person who knows. It is a
 * guardrail, not a lock — whoever can write in this container can rewrite it,
 * and already holds the login's credential (`ZeropsProjectSigners`).
 *
 * A press on the crew that runs or changes it without starting a turn at once
 * — a task queued, a run resumed, a job changed — is judged by
 * {@link ZeropsTurnAdmission.admitOperator} on every login it reaches: whose
 * the login is, never whether it works this minute. A login held here by
 * somebody else, or by nobody on record, refuses it in the words its turn
 * would be refused in; one nobody holds — never signed in, or its credential
 * gone — is nobody's, and whoever signs it in makes it theirs.
 *
 * @module ZeropsTurnAdmission
 */
import {
  agentIdForDriverKind,
  agentIdForProviderInstance,
  type AgentAdmissionRefusal,
  type SessionSubject,
  type ZeropsAgentId,
  type ZeropsLoginState,
  type ZeropsUserId,
  zeropsUserIdOf,
} from "@t3tools/contracts";
import {
  zeropsAgentUnavailableReason,
  zeropsLoginTitle,
  zeropsLoginUnavailableReason,
} from "@t3tools/shared/zeropsAgentAuth";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { ProviderInstances } from "../spi/providerInstances.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import { ZeropsAgentLogin } from "./ZeropsAgentLogin.ts";
import { AUTOMATED_MATE_SIGNS_NOBODY_IN, ZeropsAutomation } from "./ZeropsAutomation.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsLogins, type MateLogin } from "./ZeropsLogins.ts";
import { ZeropsProjectSigners, type GateRefusal } from "./ZeropsProjectSigners.ts";
import { ZeropsSignerStanding } from "./ZeropsSignerStanding.ts";

/**
 * Whom a turn is for.
 *
 * - `session`: a person's authenticated session, dispatching now; `subject`
 *   is the session's subject as the auth layer holds it.
 * - `crew`: a turn the crew dispatches later on a person's behalf;
 *   `startedBy` is that person's Zerops user id.
 * - `standup`: the stand-up this server starts for the person who asked for
 *   it (`ZeropsSetup`), `startedBy` theirs — no session of theirs sends it.
 *
 * - `task`: a task from outside an automated Mate took (`ZeropsTasks`), by
 *   HQ's id: it runs for nobody, on the organization's key only.
 * - `mate`: a message another Mate of the same person sent
 *   (`ZeropsMateMessages`), by HQ's id: it runs only on a login whose recorded
 *   signer is `ownerUserId`, the owner HQ named when the Mate took it. HQ checks
 *   both Mates are that person's as it delivers the message, so nothing more is
 *   asked of it here.
 *
 * `crew` has no session HQ would end: on a login its person signed, it is
 * admitted only while HQ says that person may still run turns here (X3); on a
 * login nobody signed it runs while its project exists. `standup` asks HQ
 * nothing: adding the Mate is its person's own act, moments before, and adding
 * a Mate sets it up with no condition of its own.
 */
export type TurnPrincipal =
  | { readonly kind: "session"; readonly subject: SessionSubject }
  | { readonly kind: "crew"; readonly startedBy: ZeropsUserId }
  | { readonly kind: "standup"; readonly startedBy: ZeropsUserId }
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "mate"; readonly messageId: string; readonly ownerUserId: ZeropsUserId };

/** Admission's refusal: the sentence its person reads, the login it is about, and whether the door could not say now. */
export class TurnRefused extends Data.TaggedError("TurnRefused")<{
  readonly message: string;
  readonly agentAdmission?: AgentAdmissionRefusal | undefined;
  /** The door could not say now rather than gave a verdict: the engine asks such a run again (`RunRefused.undetermined`). */
  readonly undetermined?: true;
}> {}

/**
 * A run for somebody away refused because HQ could not say their standing now: the engine asks
 * again, patiently, before the run fails with these words (`RunRefused.undetermined`).
 */
export const ACCESS_UNCONFIRMED =
  "Could not confirm that the person this turn runs for still has access to this project. Try again in a moment.";

/**
 * A turn on a login with no signer on record, asked before HQ's map of signers was heard in this
 * process (`ZeropsProjectSigners`, `SIGNERS_WAIT`): whose the login is cannot be said yet, so the
 * engine asks again, as for {@link ACCESS_UNCONFIRMED}.
 */
export const SIGNERS_UNHEARD =
  "Zerops Mate has not heard from HQ yet who signed this agent in, so it cannot tell whose turn this is. Try again in a moment.";

/**
 * A run for another Mate's message on a login its owner did not sign in here (a project token, an
 * agent Mate signs nobody in to): such a message spends only its owner's own sign-in, and waits.
 */
export const MATE_MESSAGE_NEEDS_OWNER =
  "Another Mate's message runs only on an agent its owner signed in here.";

/** The Zerops user a principal stands for, or `undefined` when it names none. */
export function principalUserId(principal: TurnPrincipal): ZeropsUserId | undefined {
  switch (principal.kind) {
    case "task":
      return undefined;
    case "mate":
      return principal.ownerUserId;
    case "session":
      return zeropsUserIdOf(principal.subject);
    default:
      return principal.startedBy;
  }
}

/** The sentence a refused turn reports. */
export function turnRefusalMessage(agentId: ZeropsAgentId, refusal: GateRefusal): string {
  switch (refusal.kind) {
    case "signers-unheard":
      return SIGNERS_UNHEARD;
    case "not-signed-in":
      return zeropsAgentUnavailableReason(agentId, refusal.auth);
    case "unrecorded":
      return "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it. Sign in with your own account first.";
    case "someone-else":
      return "This agent was signed in by another project member — only they can run it.";
  }
}

/** The sentence a refused turn on a login beyond the defaults reports. */
export function loginRefusalMessage(
  login: Pick<MateLogin, "agent" | "kind" | "label">,
  refusal: GateRefusal,
): string {
  const title = zeropsLoginTitle(login);
  switch (refusal.kind) {
    case "signers-unheard":
      return SIGNERS_UNHEARD;
    case "not-signed-in":
      return zeropsLoginUnavailableReason({ ...login, default: false }, refusal.auth);
    case "unrecorded":
      return `${title}'s sign-in was not recorded by Zerops Mate, so nobody can run it. Sign it in with your own account first.`;
    case "someone-else":
      return `${title} was signed in by another project member — only they can run it.`;
  }
}

/**
 * The login a refusal is about and why, as clients and the engine's run ends carry it; none for a
 * refusal that is no verdict on a login (`signers-unheard`).
 */
const admissionRefusalOf = (
  loginId: string,
  refusal: GateRefusal,
): AgentAdmissionRefusal | undefined => {
  switch (refusal.kind) {
    case "signers-unheard":
      return undefined;
    case "unrecorded":
      return { loginId, reason: "unrecorded" };
    case "someone-else":
      return { loginId, reason: "not-permitted" };
    case "not-signed-in":
      return {
        loginId,
        reason:
          refusal.auth === "needs-reauth" || refusal.auth === "reconnect"
            ? "expired-login"
            : "missing-sign-in",
      };
  }
};

/**
 * Whether a login beyond the defaults holds a credential here, by its state —
 * the client reads the same off it (`mateLoginAsAgentRow`): signed in, being
 * checked, or signed in and no longer working all hold one.
 */
const LOGIN_HOLDS_CREDENTIAL: Readonly<Record<ZeropsLoginState, boolean>> = {
  authorized: true,
  registering: true,
  "needs-reauth": true,
  reconnect: false,
  "not-authorized": false,
};

/**
 * D6's verdict on the login a turn would run on: `refusal` when this principal
 * may not run it; else `signed` when it runs on a login whose recorded signer is
 * this principal — not a project token, not an agent Mate signs nobody in to.
 */
interface LoginVerdict {
  readonly signed: boolean;
  readonly refusal?: TurnRefused;
}

export class ZeropsTurnAdmission extends Context.Service<
  ZeropsTurnAdmission,
  {
    /**
     * Fails with admission's refusal when `principal` may not operate one of
     * `instanceIds` (D6): a personal login held here whose recorded signer is
     * somebody else, or nobody. A login no credential holds, a token's and a
     * driver Mate signs nobody in to are nobody's, and pass.
     */
    /**
     * Fails with the refusal when `principal` may not start a run on
     * `instanceId` (D6): the Mate engine's admission, which names its instance.
     */
    readonly admitRun: (input: {
      readonly instanceId: string;
      readonly principal: TurnPrincipal;
    }) => Effect.Effect<void, TurnRefused>;
    readonly admitOperator: (input: {
      readonly instanceIds: ReadonlyArray<string>;
      readonly principal: TurnPrincipal;
    }) => Effect.Effect<void, TurnRefused>;
    /**
     * Fails with the refusal a run on `instanceId` would meet when the person
     * `subject` asks its agent for one piece of text outside every
     * conversation (a crew proposed from the goal): it spends the login as a
     * run does, so it is judged as one — signed in, and by this person — yet
     * it starts no run, so the engine's door (`admitRun`) stays the runs' own.
     */
    readonly admitGeneration: (input: {
      readonly instanceId: string;
      readonly subject: SessionSubject;
    }) => Effect.Effect<void, TurnRefused>;
  }
>()("t3/zerops/ZeropsTurnAdmission") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const agentAuth = yield* ZeropsAgentAuth.ZeropsAgentAuth;
  const projectSigners = yield* ZeropsProjectSigners;
  const signerStanding = yield* ZeropsSignerStanding;
  // The server-driven logins, as this server holds them: the agent-auth feed's rows carry none
  // (only the clients' stream is joined with them), and the gate waits on a login just made.
  const agentLogins = yield* ZeropsAgentLogin;
  const providerInstances = yield* ProviderInstances;
  const zeropsLogins = yield* ZeropsLogins;
  const automation = yield* ZeropsAutomation;

  /**
   * The agent an instance runs, by its driver — a second instance of a driver
   * is the same agent CLI on somebody's login. The instance id resolves when
   * no configured instance carries it: the agent-auth spelling
   * (`claude-code`) arrives on real threads too.
   */
  const agentIdOf = (instanceId: string | undefined) =>
    instanceId === undefined
      ? Effect.succeed(undefined)
      : providerInstances
          .driverKindOf(instanceId)
          .pipe(
            Effect.map(
              (driver) => agentIdForDriverKind(driver) ?? agentIdForProviderInstance(instanceId),
            ),
          );

  /**
   * A crew turn runs for somebody who is not at the keyboard, so
   * on a login they signed it asks whether that person may still run turns
   * here (X3): HQ answers, their signer standing (`ZeropsSignerStanding`). A
   * login nobody signed (a project token, an agent with no sign-in) asks nobody:
   * its turn runs while its project exists. A person's own
   * session needs no such check: HQ ends a session whose standing changed. Only
   * `may` admits; a person who lost the project is signed out by offboarding,
   * one HQ no longer holds a token for is refused until they open Mate once.
   */
  const refuseWithoutStanding = Effect.fnUntraced(function* (startedBy: ZeropsUserId) {
    const standing = yield* signerStanding.standing(startedBy);
    if (standing === "may") return;
    return yield* new TurnRefused({
      message:
        standing === "no_access" || standing === "left"
          ? "The person this turn runs for no longer has access to this project."
          : standing === "sign_in_needed"
            ? "The person this turn runs for needs to open Mate once so HQ can confirm their access."
            : ACCESS_UNCONFIRMED,
      ...(standing === undefined ? { undetermined: true as const } : {}),
    });
  });

  /**
   * D6 on a login beyond the defaults: its own check must say it is signed
   * in, and its own signer must be this principal. A login the feed has not
   * listed yet is not signed in — unknown refuses.
   */
  const judgeLogin = Effect.fnUntraced(function* (
    login: MateLogin,
    principal: TurnPrincipal,
  ): Effect.fn.Return<LoginVerdict> {
    const row = (yield* zeropsLogins.latest).find((entry) => entry.id === login.id);
    const refusal = yield* projectSigners.loginRefusal({
      key: login.id,
      state: row?.state ?? "not-authorized",
      token: false,
      person: principalUserId(principal),
      login: (yield* agentLogins.latest)[login.id],
      currentLogin: {
        latest: agentLogins.latest.pipe(Effect.map((logins) => logins[login.id])),
        changes: agentLogins.changes,
      },
    });
    // Admitted with no token: its recorded signer is this principal.
    if (refusal === undefined) return { signed: true };
    return {
      signed: false,
      refusal: new TurnRefused({
        message: loginRefusalMessage(login, refusal),
        agentAdmission: admissionRefusalOf(login.id, refusal),
        ...(refusal.kind === "signers-unheard" ? { undetermined: true as const } : {}),
      }),
    };
  });

  /**
   * D6 itself: the agent must be signed in, and signed in by this principal.
   * An agent Mate signs nobody in to, and a login no row lists, pass unsigned.
   */
  const judgeAgent = Effect.fnUntraced(function* (
    instanceId: string | undefined,
    principal: TurnPrincipal,
  ): Effect.fn.Return<LoginVerdict> {
    const login = instanceId === undefined ? undefined : yield* zeropsLogins.resolve(instanceId);
    if (login !== undefined) return yield* judgeLogin(login, principal);
    const agentId = yield* agentIdOf(instanceId);
    if (agentId === undefined) return { signed: false };
    const snapshot = yield* agentAuth.latest;
    const agent = snapshot.agents.find((entry) => entry.agentId === agentId);
    if (agent === undefined) return { signed: false };
    const refusal = yield* projectSigners.turnRefusal({
      agentId,
      agent,
      person: principalUserId(principal),
      login: (yield* agentLogins.latest)[agentId],
      currentLogin: {
        latest: agentLogins.latest.pipe(Effect.map((logins) => logins[agentId])),
        changes: agentLogins.changes,
      },
    });
    // Admitted on a project token: nobody signed it. Otherwise its recorded signer is this principal.
    if (refusal === undefined) return { signed: !agent.flagToken };
    return {
      signed: false,
      refusal: new TurnRefused({
        message: turnRefusalMessage(agentId, refusal),
        agentAdmission: admissionRefusalOf(agentId, refusal),
        ...(refusal.kind === "signers-unheard" ? { undetermined: true as const } : {}),
      }),
    };
  });

  const refuse = (message: string) => new TurnRefused({ message });

  /**
   * An automated Mate runs on the organization's key only, and so does a task's run wherever it
   * is: a Claude Code or Codex sign-in, the default one or a subscription login, runs neither.
   */
  const refuseSubscription = Effect.fnUntraced(function* (
    instanceId: string | undefined,
    principal: TurnPrincipal,
  ) {
    if (instanceId === undefined) return;
    if (principal.kind !== "task" && !(yield* automation.automated)) return;
    const login = yield* zeropsLogins.resolve(instanceId);
    const subscription =
      login === undefined
        ? (yield* agentIdOf(instanceId)) !== undefined
        : login.kind === "subscription";
    if (subscription) return yield* refuse(AUTOMATED_MATE_SIGNS_NOBODY_IN);
  });

  /**
   * Whether the principal runs for a person outside their session, whose access is asked: the
   * crew's. A stand-up is its person's own act of adding the Mate, never asked again.
   */
  const forSomeoneAway = (
    principal: TurnPrincipal,
  ): principal is Extract<TurnPrincipal, { readonly kind: "crew" }> => principal.kind === "crew";

  /**
   * The checks every turn passes, in order: a person away may still run turns
   * here, on a login they signed (`refuseWithoutStanding`); the
   * organization's key only where that is the rule; D6. D6 is judged first, as
   * whether that login is one its person signed decides who is asked.
   */
  const refuseOnLogin = Effect.fnUntraced(function* (
    instanceId: string | undefined,
    principal: TurnPrincipal,
  ) {
    const verdict = yield* judgeAgent(instanceId, principal);
    if (forSomeoneAway(principal) && verdict.signed) {
      yield* refuseWithoutStanding(principal.startedBy);
    }
    yield* refuseSubscription(instanceId, principal);
    if (verdict.refusal !== undefined) return yield* verdict.refusal;
    // Signed means signed by this principal, its owner: a login nobody signed spends nothing of it.
    if (principal.kind === "mate" && !verdict.signed)
      return yield* refuse(MATE_MESSAGE_NEEDS_OWNER);
  });

  /**
   * The checks for a run that names its instance: a wake's person must still
   * have access, and the agent or login must be signed in by this principal.
   */
  const admitRun: ZeropsTurnAdmission["Service"]["admitRun"] = Effect.fnUntraced(function* ({
    instanceId,
    principal,
  }) {
    if (!isZeropsEnvironment(config)) return;
    yield* refuseOnLogin(instanceId, principal);
  });

  const admitGeneration: ZeropsTurnAdmission["Service"]["admitGeneration"] = Effect.fnUntraced(
    function* ({ instanceId, subject }) {
      if (!isZeropsEnvironment(config)) return;
      yield* refuseSubscription(instanceId, { kind: "session", subject });
      const verdict = yield* judgeAgent(instanceId, { kind: "session", subject });
      if (verdict.refusal !== undefined) return yield* verdict.refusal;
    },
  );

  /**
   * Whose login `instanceId` is, judged as if it were signed in — a login
   * that holds a credential goes on to its token and its signer, exactly as a
   * turn on it would; one that holds none is nobody's. Resolved as a turn
   * resolves it: a login beyond the defaults by its own row, any other
   * instance by its driver's agent.
   */
  const operatorRefusal = Effect.fnUntraced(function* (
    instanceId: string,
    principal: TurnPrincipal,
  ) {
    const person = principalUserId(principal);
    const login = yield* zeropsLogins.resolve(instanceId);
    if (login !== undefined) {
      const row = (yield* zeropsLogins.latest).find((entry) => entry.id === login.id);
      const refusal = yield* projectSigners.loginRefusal({
        key: login.id,
        state: LOGIN_HOLDS_CREDENTIAL[row?.state ?? "not-authorized"]
          ? "authorized"
          : "not-authorized",
        token: false,
        person,
      });
      return refusal === undefined || refusal.kind === "not-signed-in"
        ? undefined
        : loginRefusalMessage(login, refusal);
    }
    const agentId = yield* agentIdOf(instanceId);
    if (agentId === undefined) return undefined;
    const agent = (yield* agentAuth.latest).agents.find((entry) => entry.agentId === agentId);
    if (agent === undefined) return undefined;
    const refusal = yield* projectSigners.loginRefusal({
      key: agentId,
      state: agent.credPresent ? "authorized" : "not-authorized",
      token: agent.flagToken,
      person,
    });
    return refusal === undefined || refusal.kind === "not-signed-in"
      ? undefined
      : turnRefusalMessage(agentId, refusal);
  });

  const admitOperator: ZeropsTurnAdmission["Service"]["admitOperator"] = Effect.fnUntraced(
    function* ({ instanceIds, principal }) {
      if (!isZeropsEnvironment(config)) return;
      for (const instanceId of instanceIds) {
        const message = yield* operatorRefusal(instanceId, principal);
        if (message !== undefined) return yield* refuse(message);
      }
    },
  );

  return ZeropsTurnAdmission.of({ admitRun, admitOperator, admitGeneration });
});

export const layer = Layer.effect(ZeropsTurnAdmission, make);

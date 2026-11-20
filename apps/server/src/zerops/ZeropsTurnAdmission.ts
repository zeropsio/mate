/**
 * ZeropsTurnAdmission — decides whose login a run, a crew press or a
 * generation may spend (D6), through {@link ZeropsTurnAdmission.admitRun},
 * {@link ZeropsTurnAdmission.admitOperator} and
 * {@link ZeropsTurnAdmission.admitGeneration}.
 *
 * A turn starts only on an agent that is signed in on this project, and only
 * for the person who signed it in. A login beyond the defaults
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
  type ZeropsLoginState,
  type ZeropsUserId,
  zeropsUserIdOf,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { ProviderInstances } from "../spi/providerInstances.ts";
import {
  type AdmissionTarget,
  type AdmissionVerdict,
  admissionVerdict,
  asksStanding,
  loginRefusalMessage,
  turnRefusalMessage,
} from "./admission/admissionVerdict.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import { ZeropsAgentLogin } from "./ZeropsAgentLogin.ts";
import { ZeropsAutomation } from "./ZeropsAutomation.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsLogins } from "./ZeropsLogins.ts";
import { ZeropsProjectSigners } from "./ZeropsProjectSigners.ts";
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
  readonly forNow?: true;
}> {}

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

  const targetOf = Effect.fnUntraced(function* (
    instanceId: string | undefined,
    principal: TurnPrincipal,
  ): Effect.fn.Return<AdmissionTarget> {
    const login = instanceId === undefined ? undefined : yield* zeropsLogins.resolve(instanceId);
    if (login !== undefined) {
      const row = (yield* zeropsLogins.latest).find((entry) => entry.id === login.id);
      const refusal = yield* projectSigners.loginRefusal({
        key: login.id,
        // A login beyond the defaults needs its own signed-in row. A missing row refuses the turn.
        state: row?.state ?? "not-authorized",
        token: false,
        person: principalUserId(principal),
        login: (yield* agentLogins.latest)[login.id],
        currentLogin: {
          latest: agentLogins.latest.pipe(Effect.map((logins) => logins[login.id])),
          changes: agentLogins.changes,
        },
      });
      return { kind: "login", login, refusal };
    }

    const agentId = yield* agentIdOf(instanceId);
    if (agentId === undefined) return { kind: "none" };
    const snapshot = yield* agentAuth.latest;
    const agent = snapshot.agents.find((entry) => entry.agentId === agentId);
    if (agent === undefined) return { kind: "unlisted-agent" };
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
    return { kind: "agent", agentId, token: agent.flagToken, refusal };
  });

  const refuse = (message: string) => new TurnRefused({ message });

  const refusedOf = (verdict: Exclude<AdmissionVerdict, { readonly _tag: "Admit" }>) => {
    if (verdict._tag === "Undetermined") {
      return new TurnRefused({ message: verdict.message, undetermined: true });
    }
    return new TurnRefused({
      message: verdict.message,
      ...(verdict.agentAdmission ? { agentAdmission: verdict.agentAdmission } : {}),
      ...(verdict.forNow ? { forNow: true } : {}),
    });
  };

  const admitRun: ZeropsTurnAdmission["Service"]["admitRun"] = Effect.fnUntraced(function* ({
    instanceId,
    principal,
  }) {
    if (!isZeropsEnvironment(config)) return;
    const target = yield* targetOf(instanceId, principal);
    const standing = asksStanding(principal, target)
      ? yield* signerStanding.standing(principal.startedBy)
      : undefined;
    const organizationKeyOnly = principal.kind === "task" || (yield* automation.automated);
    const verdict = admissionVerdict({ principal, target, standing, organizationKeyOnly });
    if (verdict._tag !== "Admit") return yield* refusedOf(verdict);
  });

  const admitGeneration: ZeropsTurnAdmission["Service"]["admitGeneration"] = Effect.fnUntraced(
    function* ({ instanceId, subject }) {
      if (!isZeropsEnvironment(config)) return;
      const principal: TurnPrincipal = { kind: "session", subject };
      const target = yield* targetOf(instanceId, principal);
      const organizationKeyOnly = yield* automation.automated;
      const verdict = admissionVerdict({
        principal,
        target,
        standing: undefined,
        organizationKeyOnly,
      });
      if (verdict._tag !== "Admit") return yield* refusedOf(verdict);
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

/**
 * ZeropsTurnAdmission — the one place that decides whether a command may
 * start a turn (D6).
 *
 * A turn starts only on an agent that is signed in on this project, and only
 * for the person who signed it in. Every path that dispatches a command a
 * client or a person caused asks here first, with the principal the turn is
 * for; `scripts/turn-start-sites.test.ts` pins which paths those are.
 *
 * The instance is resolved from the command's own model selection, or from the
 * thread's when the command names none. A login beyond the two defaults
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
 * A crewmate's conversation (a thread with a crew origin) has three guards
 * of its own (ARCHITECTURE seam 13). A person's session never archives,
 * restores or deletes one — the crew does, through its own actions — and
 * never starts a turn on a retired one. And no turn starts on one at all
 * unless the thread tool policy has a profile for it: a crewmate's turn
 * never runs ungated.
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
  ProviderInstanceId,
  agentIdForDriverKind,
  agentIdForProviderInstance,
  OrchestrationDispatchCommandError,
  type AgentAdmissionRefusal,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
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
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderInstances } from "../spi/providerInstances.ts";
import { ThreadToolPolicyRegistry, threadProfileFor } from "../spi/threadToolPolicy.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import { ZeropsAgentLogin } from "./ZeropsAgentLogin.ts";
import { AUTOMATED_MATE_SIGNS_NOBODY_IN, ZeropsAutomation } from "./ZeropsAutomation.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsLogins, type MateLogin } from "./ZeropsLogins.ts";
import {
  isTurnStartingCommand,
  ZeropsProjectSigners,
  type GateRefusal,
} from "./ZeropsProjectSigners.ts";
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
  | { readonly kind: "task"; readonly taskId: string };

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
 * Whether a refusal is the door unable to say now rather than a verdict: the engine asks such a
 * run again before failing it (`RunRefused.undetermined`).
 */
export const isUndetermined = (refusal: OrchestrationDispatchCommandError): boolean =>
  refusal.message === ACCESS_UNCONFIRMED || refusal.message === SIGNERS_UNHEARD;

/** The Zerops user a principal stands for, or `undefined` when it names none. */
export function principalUserId(principal: TurnPrincipal): ZeropsUserId | undefined {
  if (principal.kind === "task") return undefined;
  return principal.kind === "session" ? zeropsUserIdOf(principal.subject) : principal.startedBy;
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

/** The refusals of a crewmate's conversation (seam 13). */
export const CREW_THREAD_REFUSALS = {
  keptByCrew:
    "A crewmate's conversation is the crew's to archive, restore or delete; use the crew's own actions.",
  retired:
    "This crewmate conversation is retired; message the crewmate in its current conversation.",
  notRunning: "Crew mode is not running this crewmate's conversation, so it cannot take a turn.",
  /** The thread's agent never reads a thread's profile, so the turn would run ungated. */
  modeKept: "A crewmate's conversation runs in the crew's own mode, so its mode can't be changed.",
  ungated: (agent: string) =>
    `${agent} can't run a crewmate: it would work without the crew's rules. Give this crewmate another login.`,
} as const;

const CREW_KEPT_COMMANDS: ReadonlySet<OrchestrationCommand["type"]> = new Set([
  "thread.archive",
  "thread.unarchive",
  "thread.delete",
]);

/**
 * Commands no principal may run on a crewmate's conversation: a new runtime
 * mode would restart its session in a mode that approves calls on its own,
 * past the crew's gate.
 */
const CREW_FIXED_COMMANDS: ReadonlySet<OrchestrationCommand["type"]> = new Set([
  "thread.runtime-mode.set",
]);

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
  readonly refusal?: OrchestrationDispatchCommandError;
}

export class ZeropsTurnAdmission extends Context.Service<
  ZeropsTurnAdmission,
  {
    /** Fails with the refusal when `command` would start a turn `principal` may not start. */
    readonly admit: (input: {
      readonly command: OrchestrationCommand;
      readonly principal: TurnPrincipal;
    }) => Effect.Effect<void, OrchestrationDispatchCommandError>;
    /**
     * Fails with admission's refusal when `principal` may not operate one of
     * `instanceIds` (D6): a personal login held here whose recorded signer is
     * somebody else, or nobody. A login no credential holds, a token's and a
     * driver Mate signs nobody in to are nobody's, and pass.
     */
    /**
     * Fails with the refusal when `principal` may not start a run on
     * `instanceId` (D6): the Mate engine's admission, which names its instance
     * and reads no V1 conversation.
     */
    readonly admitRun: (input: {
      readonly instanceId: string;
      readonly principal: TurnPrincipal;
    }) => Effect.Effect<void, OrchestrationDispatchCommandError>;
    readonly admitOperator: (input: {
      readonly instanceIds: ReadonlyArray<string>;
      readonly principal: TurnPrincipal;
    }) => Effect.Effect<void, OrchestrationDispatchCommandError>;
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
    }) => Effect.Effect<void, OrchestrationDispatchCommandError>;
  }
>()("t3/zerops/ZeropsTurnAdmission") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const agentAuth = yield* ZeropsAgentAuth.ZeropsAgentAuth;
  const projectSigners = yield* ZeropsProjectSigners;
  const signerStanding = yield* ZeropsSignerStanding;
  // The server-driven logins, as this server holds them: the agent-auth feed's rows carry none
  // (only the clients' stream is joined with them), and the gate waits on a login just made.
  const agentLogins = yield* ZeropsAgentLogin;
  const providerInstances = yield* ProviderInstances;
  const zeropsLogins = yield* ZeropsLogins;
  const policies = yield* Effect.serviceOption(ThreadToolPolicyRegistry);
  const automation = yield* ZeropsAutomation;

  /** The thread the command acts on, when it names one and the projection has it. */
  const threadOf = (command: OrchestrationCommand) =>
    "threadId" in command
      ? projectionSnapshotQuery.getThreadShellById(command.threadId).pipe(
          Effect.map(Option.getOrUndefined),
          Effect.catchCause(() => Effect.succeed(undefined)),
        )
      : Effect.succeed(undefined);

  /** The instance the command names, or else the one its thread runs on. */
  const instanceIdOf = (
    command: OrchestrationCommand,
    thread: OrchestrationThreadShell | undefined,
  ): string | undefined =>
    ("modelSelection" in command ? command.modelSelection?.instanceId : undefined) ??
    thread?.modelSelection.instanceId;

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
   * Whether `command` starts a turn. An answer reads its question first: only
   * an answer in message mode becomes a turn. A question that cannot be read
   * is gated like one that would — unknown refuses, as everywhere in D6.
   */
  const startsTurn = (command: OrchestrationCommand) =>
    command.type === "thread.user-input.respond"
      ? projectionSnapshotQuery.getUserInputActivity(command).pipe(
          Effect.map((request) => isTurnStartingCommand(command, Option.getOrUndefined(request))),
          Effect.catchCause(() => Effect.succeed(true)),
        )
      : Effect.succeed(isTurnStartingCommand(command));

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
    return yield* new OrchestrationDispatchCommandError({
      message:
        standing === "no_access" || standing === "left"
          ? "The person this turn runs for no longer has access to this project."
          : standing === "sign_in_needed"
            ? "The person this turn runs for needs to open Mate once so HQ can confirm their access."
            : ACCESS_UNCONFIRMED,
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
      refusal: new OrchestrationDispatchCommandError({
        message: loginRefusalMessage(login, refusal),
        agentAdmission: admissionRefusalOf(login.id, refusal),
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
      refusal: new OrchestrationDispatchCommandError({
        message: turnRefusalMessage(agentId, refusal),
        agentAdmission: admissionRefusalOf(agentId, refusal),
      }),
    };
  });

  const refuse = (message: string) => new OrchestrationDispatchCommandError({ message });

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
  });

  /**
   * The checks, in order. Archiving, restoring and deleting start no turn
   * but are checked against a crewmate's conversation; every other command
   * that starts no turn passes untouched, without a read.
   */
  const admit: ZeropsTurnAdmission["Service"]["admit"] = Effect.fnUntraced(function* ({
    command,
    principal,
  }) {
    if (!isZeropsEnvironment(config)) return;
    if (CREW_FIXED_COMMANDS.has(command.type)) {
      if ((yield* threadOf(command))?.crew !== undefined) {
        return yield* refuse(CREW_THREAD_REFUSALS.modeKept);
      }
      return;
    }
    const kept = CREW_KEPT_COMMANDS.has(command.type);
    if (!kept && !(yield* startsTurn(command))) return;
    const thread = yield* threadOf(command);
    const crewThread = thread?.crew !== undefined ? thread : undefined;
    if (kept) {
      if (crewThread !== undefined && principal.kind === "session") {
        return yield* refuse(CREW_THREAD_REFUSALS.keptByCrew);
      }
      return;
    }
    if (crewThread !== undefined) {
      if (principal.kind === "session" && crewThread.archivedAt !== null) {
        return yield* refuse(CREW_THREAD_REFUSALS.retired);
      }
      // The turn runs on the instance it names, else on its thread's.
      const instanceId = ProviderInstanceId.make(
        instanceIdOf(command, crewThread) ?? crewThread.modelSelection.instanceId,
      );
      const profile = yield* threadProfileFor(policies, { threadId: crewThread.id, instanceId });
      if (profile === undefined) return yield* refuse(CREW_THREAD_REFUSALS.notRunning);
      const agent = yield* providerInstances.agentOf(instanceId);
      if (agent?.threadProfile === undefined) {
        return yield* refuse(CREW_THREAD_REFUSALS.ungated(agent?.displayName ?? instanceId));
      }
    }
    yield* refuseOnLogin(instanceIdOf(command, thread), principal);
  });

  /**
   * The command door's checks for a run that names its instance and reads no
   * conversation: a wake's person must still have access, and the agent or
   * login must be signed in by this principal. The crew-thread guards stay
   * with `admit`: crew is off whenever the Mate engine runs.
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

  return ZeropsTurnAdmission.of({ admit, admitRun, admitOperator, admitGeneration });
});

export const layer = Layer.effect(ZeropsTurnAdmission, make);

/**
 * ZeropsTurnAdmission — the one place that decides whether a command may
 * start a turn (D6).
 *
 * A turn starts only on an agent that is signed in on this project, and only
 * for the person who signed it in. Every path that dispatches a command a
 * client or a person caused asks here first, with the principal the turn is
 * for; `scripts/turn-start-sites.test.ts` pins which paths those are.
 *
 * The agent is resolved from the command's own model selection, or from the
 * thread's when the command names none. An agent Mate never signs anybody in
 * to, and an agent authorized by a token rather than by a personal login, are
 * both unaffected — a token belongs to the project.
 *
 * The record is a tag on the Mate's project, which this container's key
 * cannot write, so neither it nor its agent can forge it
 * (`ZeropsProjectSigners`). A read that fails leaves the record unknown, and
 * unknown refuses: "nobody recorded it" and "somebody else's" are the same
 * thing to everyone but the person who knows. A refusal on a cached record is
 * re-read once before it stands.
 *
 * @module ZeropsTurnAdmission
 */
import {
  agentIdForDriverKind,
  agentIdForProviderInstance,
  OrchestrationDispatchCommandError,
  type OrchestrationCommand,
  type ZeropsAgentId,
} from "@t3tools/contracts";
import { zeropsAgentUnavailableReason } from "@t3tools/shared/zeropsAgentAuth";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderInstances } from "../spi/providerInstances.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZEROPS_SUBJECT_PREFIX } from "./ZeropsMembershipWatch.ts";
import {
  isTurnStartingCommand,
  type TurnRefusal,
  ZeropsProjectSigners,
} from "./ZeropsProjectSigners.ts";

/**
 * Whom a turn is for.
 *
 * - `session`: a person's authenticated session, dispatching now; `subject`
 *   is the session's subject as the auth layer holds it.
 * - `crew`: a turn the crew dispatches later on a person's behalf;
 *   `startedBy` is that person's Zerops user id.
 */
export type TurnPrincipal =
  | { readonly kind: "session"; readonly subject: string }
  | { readonly kind: "crew"; readonly startedBy: string };

/** The Zerops user a principal stands for, or `undefined` when it names none. */
export function principalUserId(principal: TurnPrincipal): string | undefined {
  if (principal.kind === "crew") return principal.startedBy;
  return principal.subject.startsWith(ZEROPS_SUBJECT_PREFIX)
    ? principal.subject.slice(ZEROPS_SUBJECT_PREFIX.length)
    : undefined;
}

/** The sentence a refused turn reports. */
export function turnRefusalMessage(agentId: ZeropsAgentId, refusal: TurnRefusal): string {
  switch (refusal.kind) {
    case "not-signed-in":
      return zeropsAgentUnavailableReason(agentId, refusal.auth);
    case "unrecorded":
      return "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it. Sign in with your own account first.";
    case "someone-else":
      return "This agent was signed in by another project member — only they can run it. Sign in with your own account first.";
  }
}

export class ZeropsTurnAdmission extends Context.Service<
  ZeropsTurnAdmission,
  {
    /** Fails with the refusal when `command` would start a turn `principal` may not start. */
    readonly admit: (input: {
      readonly command: OrchestrationCommand;
      readonly principal: TurnPrincipal;
    }) => Effect.Effect<void, OrchestrationDispatchCommandError>;
  }
>()("t3/zerops/ZeropsTurnAdmission") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const agentAuth = yield* ZeropsAgentAuth.ZeropsAgentAuth;
  const projectSigners = yield* ZeropsProjectSigners;
  const providerInstances = yield* ProviderInstances;

  /** The instance the command names, or else the one its thread runs on. */
  const instanceIdOf = (command: OrchestrationCommand) =>
    Effect.gen(function* () {
      const commandInstanceId =
        "modelSelection" in command ? command.modelSelection?.instanceId : undefined;
      if (commandInstanceId !== undefined) return commandInstanceId as string;
      if (!("threadId" in command)) return undefined;
      return yield* projectionSnapshotQuery.getThreadShellById(command.threadId).pipe(
        Effect.map(
          Option.match({
            onNone: () => undefined,
            onSome: (thread) => thread.modelSelection.instanceId as string | undefined,
          }),
        ),
        Effect.catchCause(() => Effect.succeed(undefined)),
      );
    });

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
   * A crew turn runs for somebody who is not at the keyboard, so it re-checks
   * that they are still in the org. A person's own session needs no such
   * check: the membership watch ends a session whose person left.
   */
  const refuseDepartedStarter = Effect.fnUntraced(function* (startedBy: string) {
    const active = yield* projectSigners.isActiveMember(startedBy);
    if (active === true) return;
    return yield* new OrchestrationDispatchCommandError({
      message:
        active === false
          ? "The person this turn runs for is no longer an active member of this Zerops organization."
          : "Could not confirm that the person this turn runs for is still a member of this Zerops organization. Try again in a moment.",
    });
  });

  /** D6 itself: the agent must be signed in, and signed in by this principal. */
  const refuseSomeoneElsesAgent = Effect.fnUntraced(function* (
    command: OrchestrationCommand,
    principal: TurnPrincipal,
  ) {
    const agentId = yield* agentIdOf(yield* instanceIdOf(command));
    if (agentId === undefined) return;
    const snapshot = yield* agentAuth.latest;
    const agent = snapshot.agents.find((entry) => entry.agentId === agentId);
    if (agent === undefined) return;
    const refusal = yield* projectSigners.turnRefusal({
      agentId,
      agent,
      subject: principalUserId(principal),
    });
    if (refusal === undefined) return;
    return yield* new OrchestrationDispatchCommandError({
      message: turnRefusalMessage(agentId, refusal),
    });
  });

  /**
   * The checks, in order. Checks keyed on a thread's crew origin go right
   * after the environment check: some of them refuse commands that start no
   * turn at all (archiving a crewmate's thread).
   */
  const admit: ZeropsTurnAdmission["Service"]["admit"] = Effect.fnUntraced(function* ({
    command,
    principal,
  }) {
    if (!isZeropsEnvironment(config)) return;
    if (!(yield* startsTurn(command))) return;
    if (principal.kind === "crew") yield* refuseDepartedStarter(principal.startedBy);
    yield* refuseSomeoneElsesAgent(command, principal);
  });

  return ZeropsTurnAdmission.of({ admit });
});

export const layer = Layer.effect(ZeropsTurnAdmission, make);

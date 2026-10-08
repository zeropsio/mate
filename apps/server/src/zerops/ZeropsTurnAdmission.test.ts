import { assert, describe, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  OrchestrationDispatchCommandError,
  CommandId,
  MessageId,
  type OrchestrationCommand,
  type OrchestrationThreadActivity,
  type OrchestrationThreadShell,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ZeropsAgentAuth,
  type ZeropsAgentId,
  type ZeropsLoginState,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import { PersistenceSqlError } from "../persistence/Errors.ts";
import { ProviderInstances } from "../spi/providerInstances.ts";
import { ThreadToolPolicyRegistry, type ThreadToolProfile } from "../spi/threadToolPolicy.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ZeropsAgentAuthModule from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsLoginsModule from "./ZeropsLogins.ts";
import { ZEROPS_SUBJECT_PREFIX } from "./ZeropsMembershipWatch.ts";
import * as ZeropsProjectSignersModule from "./ZeropsProjectSigners.ts";
import { make as makeAdmission, type TurnPrincipal } from "./ZeropsTurnAdmission.ts";

const JAN = "jan-user-id";
const EVA = "eva-user-id";
const THREAD = ThreadId.make("thread-1");
const CREATED_AT = "2026-09-27T10:00:00.000Z";

const environment = resolveZeropsEnvironment({
  projectId: "nTV3oMB2SS634ImDJnQckg",
  apiHost: undefined,
  apiToken: "the-mates-own-zerops-key",
})!;

const signedIn = (agentId: ZeropsAgentId, flagToken = false): ZeropsAgentAuth => ({
  agentId,
  credPresent: true,
  flagOAuth: !flagToken,
  flagToken,
  providerAuth: "authenticated",
  state: flagToken ? "authorized-token" : "authorized",
});

const session = (userId: string): TurnPrincipal => ({
  kind: "session",
  subject: `${ZEROPS_SUBJECT_PREFIX}${userId}`,
});

const turnStart = (instanceId?: string): OrchestrationCommand => ({
  type: "thread.turn.start",
  commandId: CommandId.make("command-1"),
  threadId: THREAD,
  message: { messageId: MessageId.make("message-1"), role: "user", text: "hi", attachments: [] },
  ...(instanceId === undefined
    ? {}
    : { modelSelection: { instanceId: ProviderInstanceId.make(instanceId), model: "m" } }),
  runtimeMode: "full-access",
  interactionMode: "default",
  createdAt: CREATED_AT,
});

interface World {
  readonly zerops?: boolean;
  readonly agents?: ReadonlyArray<ZeropsAgentAuth>;
  readonly signers?: ZeropsProjectSignersModule.ProjectSigners;
  /** The instance the thread itself runs on; absent means no such thread. */
  readonly threadInstanceId?: string;
  /** The answered question's latest activity; absent means none was found. */
  readonly question?: Pick<OrchestrationThreadActivity, "kind" | "payload"> | "unreadable";
  /** User → whether the org lists them ACTIVE; `undefined` is an unreadable list. */
  /** Whether this project opens for each person, as `hasProjectAccess` answers. */
  readonly access?: Readonly<Record<string, boolean | undefined>>;
  /** Configured instance → driver kind; the two default instances when absent. */
  readonly drivers?: Readonly<Record<string, string>>;
  /**
   * The thread is a crewmate's stint (seam 13): retired or not, and what the
   * thread tool policy registry answers for it.
   */
  readonly crewThread?: {
    readonly archived?: boolean;
    readonly profile: "given" | "none" | "no-registry";
  };
  /** Logins beyond the defaults (`ZeropsLogins`), by id → their state. */
  readonly logins?: Readonly<Record<string, ZeropsLoginState>>;
  /** The server-driven logins this server holds (`ZeropsAgentLogin`), by agent. */
  readonly agentLogins?: ZeropsAgentLoginModule.ZeropsAgentLoginByAgent;
  /** Every question the gate was asked, as it was asked. */
  readonly gateCalls?: Array<{ readonly agentId: string; readonly login: unknown }>;
}

const DEFAULT_DRIVERS: Readonly<Record<string, string>> = {
  claudeAgent: "claudeAgent",
  codex: "codex",
};

const DRIVER_NAMES: Readonly<Record<string, string>> = {
  claudeAgent: "Claude",
  codex: "Codex",
  cursor: "Cursor",
};

/** What each driver's adapter does with a thread's profile: Cursor's nothing. */
const DRIVER_PROFILES: Readonly<
  Record<string, { readonly tools: boolean; readonly reportsSpend: boolean }>
> = {
  claudeAgent: { tools: true, reportsSpend: true },
  codex: { tools: false, reportsSpend: false },
};

const admission = (world: World) =>
  makeAdmission.pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerConfig.layer({
          zerops: world.zerops === false ? undefined : environment,
        } as ServerConfig.ServerConfig["Service"]),
        Layer.mock(ProjectionSnapshotQuery)({
          getThreadShellById: () =>
            Effect.succeed(
              world.threadInstanceId === undefined && world.crewThread === undefined
                ? Option.none()
                : Option.some({
                    modelSelection: {
                      instanceId: world.threadInstanceId ?? "claudeAgent",
                      model: "m",
                    },
                    archivedAt: world.crewThread?.archived === true ? CREATED_AT : null,
                    ...(world.crewThread === undefined
                      ? {}
                      : { crew: { crew: "main", crewmate: "backend", stint: 1 } }),
                  } as unknown as OrchestrationThreadShell),
            ),
          getUserInputActivity: () =>
            world.question === "unreadable"
              ? Effect.fail(new PersistenceSqlError({ operation: "test", detail: "unreadable" }))
              : Effect.succeed(
                  Option.fromUndefinedOr(world.question as OrchestrationThreadActivity | undefined),
                ),
        }),
        Layer.mock(ProviderInstances)({
          driverKindOf: (instanceId) => {
            const driver = (world.drivers ?? DEFAULT_DRIVERS)[instanceId];
            return Effect.succeed(
              driver === undefined ? undefined : ProviderDriverKind.make(driver),
            );
          },
          agentOf: (instanceId) => {
            const driver = (world.drivers ?? DEFAULT_DRIVERS)[instanceId];
            return Effect.succeed(
              driver === undefined
                ? undefined
                : {
                    driver: ProviderDriverKind.make(driver),
                    displayName: DRIVER_NAMES[driver] ?? driver,
                    threadProfile: DRIVER_PROFILES[driver],
                  },
            );
          },
        }),
        Layer.mock(ZeropsLoginsModule.ZeropsLogins)({
          resolve: (id) =>
            Effect.succeed(
              world.logins?.[id] === undefined
                ? undefined
                : {
                    id,
                    agent: "claude-code",
                    kind: "subscription",
                    label: "work",
                    home: `/home/zerops/.mate/logins/${id}`,
                    keyStored: false,
                  },
            ),
          latest: Effect.succeed(
            Object.entries(world.logins ?? {}).map(([id, state]) => ({
              id,
              agent: "claude-code" as const,
              label: "work",
              kind: "subscription" as const,
              default: false,
              state,
              token: false,
            })),
          ),
        }),
        Layer.mock(ZeropsAgentAuthModule.ZeropsAgentAuth)({
          latest: Effect.succeed({ available: true, agents: world.agents ?? [] }),
        }),
        Layer.mock(ZeropsAgentLoginModule.ZeropsAgentLogin)({
          latest: Effect.succeed(world.agentLogins ?? {}),
        }),
        Layer.mock(ZeropsProjectSignersModule.ZeropsProjectSigners)({
          turnRefusal: ({ agentId, agent, subject, login }) =>
            Effect.sync(() => world.gateCalls?.push({ agentId, login })).pipe(
              Effect.as(
                ZeropsProjectSignersModule.turnRefusal({
                  agent,
                  signer: world.signers?.[agentId],
                  subject,
                }),
              ),
            ),
          loginRefusal: ({ key, state, token, subject, login }) =>
            Effect.sync(() => world.gateCalls?.push({ agentId: key, login })).pipe(
              Effect.as(
                ZeropsProjectSignersModule.loginTurnRefusal({
                  state,
                  token,
                  signer: world.signers?.[key],
                  subject,
                }),
              ),
            ),
          hasProjectAccess: (userId) => Effect.succeed(world.access?.[userId]),
        }),
        world.crewThread === undefined || world.crewThread.profile === "no-registry"
          ? Layer.empty
          : Layer.succeed(ThreadToolPolicyRegistry, {
              install: () => Effect.void,
              current: Effect.succeed(
                Option.some({
                  profileFor: () =>
                    Effect.succeed(
                      world.crewThread?.profile === "given" ? ({} as ThreadToolProfile) : undefined,
                    ),
                }),
              ),
            }),
      ),
    ),
  );

const admitted = (
  world: World,
  command: OrchestrationCommand,
  principal: TurnPrincipal,
): Effect.Effect<string | undefined> =>
  admission(world).pipe(
    Effect.flatMap((service) => service.admit({ command, principal })),
    Effect.match({ onFailure: (error) => error.message, onSuccess: () => undefined }),
  );

const NO_ACCESS = "The person this turn runs for no longer has access to this project.";
const ACCESS_UNCONFIRMED =
  "Could not confirm that the person this turn runs for still has access to this project. Try again in a moment.";

const SOMEONE_ELSE =
  "This agent was signed in by another project member — only they can run it. Sign in with your own account first.";
const UNRECORDED =
  "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it. Sign in with your own account first.";

const LOGIN_SOMEONE_ELSE =
  "Claude Code · work was signed in by another project member — only they can run it. Use a login you signed in yourself.";
const LOGIN_UNRECORDED =
  "Claude Code · work's sign-in was not recorded by Zerops Mate, so nobody can run it. Sign it in with your own account first.";

const interrupt: OrchestrationCommand = {
  type: "thread.turn.interrupt",
  commandId: CommandId.make("command-1"),
  threadId: THREAD,
  createdAt: CREATED_AT,
};

const answer: OrchestrationCommand = {
  type: "thread.user-input.respond",
  commandId: CommandId.make("command-1"),
  threadId: THREAD,
  requestId: ApprovalRequestId.make("request-1"),
  answers: { q1: "yes" },
  createdAt: CREATED_AT,
};

const onCrewThread = (type: "thread.archive" | "thread.unarchive" | "thread.delete") =>
  ({ type, commandId: CommandId.make("command-1"), threadId: THREAD }) as OrchestrationCommand;

const CREW_KEEPS_IT =
  "A crewmate's conversation is the crew's to archive, restore or delete; use the crew's own actions.";
const RETIRED =
  "This crewmate conversation is retired; message the crewmate in its current conversation.";
const NOT_RUNNING =
  "Crew mode is not running this crewmate's conversation, so it cannot take a turn.";
const MODE_KEPT =
  "A crewmate's conversation runs in the crew's own mode, so its mode can't be changed.";
const onCrewThreadMode = {
  type: "thread.runtime-mode.set",
  commandId: CommandId.make("command-mode"),
  threadId: THREAD,
  runtimeMode: "full-access",
  createdAt: CREATED_AT,
} as unknown as OrchestrationCommand;
const UNGATED =
  "Cursor can't run a crewmate: it would work without the crew's rules. Give this crewmate another login.";

const janSignedClaude: World = {
  agents: [signedIn("claude-code")],
  signers: { "claude-code": JAN },
  access: { [JAN]: true, [EVA]: true },
};

/** Jan signed Claude Code in; Eva signed in a second Claude account, `work`. */
const evaSignedWork: World = {
  ...janSignedClaude,
  signers: { "claude-code": JAN, "claudeAgent-work": EVA },
  drivers: { ...DEFAULT_DRIVERS, "claudeAgent-work": "claudeAgent" },
  logins: { "claudeAgent-work": "authorized" },
};

// The stand-up leaves as its person's sign-in succeeds, a second before their record lands: the
// gate waits for a record on its way only if it is told of the login, which this server holds
// itself (`ZeropsAgentLogin`), not on the agent-auth feed's rows.
describe("ZeropsTurnAdmission — the login the gate is told of", () => {
  it.effect("hands the gate the agent's login this server holds", () =>
    Effect.gen(function* () {
      const login = {
        phase: "succeeded",
        terminalId: "t",
        startedAt: DateTime.makeUnsafe(CREATED_AT),
        startedBy: JAN,
      } as const;
      const gateCalls: Array<{ readonly agentId: string; readonly login: unknown }> = [];
      yield* admitted(
        {
          agents: [{ ...signedIn("claude-code"), state: "local-only", providerAuth: "unknown" }],
          agentLogins: { "claude-code": login },
          gateCalls,
        },
        turnStart("claudeAgent"),
        session(JAN),
      );
      assert.deepStrictEqual(gateCalls, [{ agentId: "claude-code", login }]);
    }),
  );
});

describe("ZeropsTurnAdmission — the login beyond the defaults the gate is told of", () => {
  it.effect("hands the gate that login's own state, by the login the turn runs on", () =>
    Effect.gen(function* () {
      const login = {
        phase: "succeeded",
        terminalId: "t",
        startedAt: DateTime.makeUnsafe(CREATED_AT),
        startedBy: JAN,
      } as const;
      const gateCalls: Array<{ readonly agentId: string; readonly login: unknown }> = [];
      yield* admitted(
        { ...evaSignedWork, agentLogins: { "claudeAgent-work": login }, gateCalls },
        turnStart("claudeAgent-work"),
        session(JAN),
      );
      assert.deepStrictEqual(gateCalls, [{ agentId: "claudeAgent-work", login }]);
    }),
  );
});

describe("ZeropsTurnAdmission", () => {
  for (const [name, world, command, principal, expected] of [
    [
      "admits the signer's own turn",
      janSignedClaude,
      turnStart("claudeAgent"),
      session(JAN),
      undefined,
    ],
    [
      "refuses a turn on an agent another member signed in",
      janSignedClaude,
      turnStart("claudeAgent"),
      session(EVA),
      SOMEONE_ELSE,
    ],
    [
      "refuses a turn on an agent nobody recorded a signer for",
      { agents: [signedIn("claude-code")] },
      turnStart("claudeAgent"),
      session(JAN),
      UNRECORDED,
    ],
    [
      "admits anybody on a token-authorized agent: a key belongs to the project",
      { agents: [signedIn("codex", true)], signers: { codex: JAN } },
      turnStart("codex"),
      session(EVA),
      undefined,
    ],
    [
      "refuses a turn on an agent that is not signed in",
      {
        agents: [
          {
            ...signedIn("claude-code"),
            credPresent: false,
            providerAuth: "unauthenticated",
            state: "not-authorized",
          },
        ],
        signers: { "claude-code": JAN },
      },
      turnStart("claudeAgent"),
      session(JAN),
      "Claude Code is not signed in on this project. Sign it in to use it.",
    ],
    [
      "reads the agent off the thread when the command names none",
      { ...janSignedClaude, threadInstanceId: "claudeAgent" },
      turnStart(),
      session(EVA),
      SOMEONE_ELSE,
    ],
    [
      "resolves the agent-auth spelling of an instance too",
      janSignedClaude,
      turnStart("claude-code"),
      session(EVA),
      SOMEONE_ELSE,
    ],
    [
      "gates a second instance of a signed-in agent's driver as that agent",
      { ...janSignedClaude, drivers: { ...DEFAULT_DRIVERS, claudeAgent_work: "claudeAgent" } },
      turnStart("claudeAgent_work"),
      session(EVA),
      SOMEONE_ELSE,
    ],
    [
      "admits a turn on another login by that login's own signer",
      evaSignedWork,
      turnStart("claudeAgent-work"),
      session(EVA),
      undefined,
    ],
    [
      "refuses a turn on another login a teammate signed in, whoever signed its agent in",
      evaSignedWork,
      turnStart("claudeAgent-work"),
      session(JAN),
      LOGIN_SOMEONE_ELSE,
    ],
    [
      "reads another login off the thread when the command names none",
      { ...evaSignedWork, threadInstanceId: "claudeAgent-work" },
      turnStart(),
      session(JAN),
      LOGIN_SOMEONE_ELSE,
    ],
    [
      "refuses a crew turn on a login its starter did not sign in (N9)",
      evaSignedWork,
      turnStart("claudeAgent-work"),
      { kind: "crew", startedBy: JAN },
      LOGIN_SOMEONE_ELSE,
    ],
    [
      "admits a crew turn on the starter's own login",
      evaSignedWork,
      turnStart("claudeAgent-work"),
      { kind: "crew", startedBy: EVA },
      undefined,
    ],
    [
      "never lets another login inherit its agent's signer",
      { ...evaSignedWork, signers: { "claude-code": JAN } },
      turnStart("claudeAgent-work"),
      session(JAN),
      LOGIN_UNRECORDED,
    ],
    [
      "refuses a turn on another login that is not signed in",
      { ...evaSignedWork, logins: { "claudeAgent-work": "not-authorized" } },
      turnStart("claudeAgent-work"),
      session(EVA),
      "Claude Code · work is not signed in on this project. Sign it in to use it.",
    ],
    [
      "admits a turn on a driver Mate signs nobody in to",
      janSignedClaude,
      turnStart("opencode"),
      session(EVA),
      undefined,
    ],
    [
      "admits a turn whose agent the auth feed does not report",
      { signers: { "claude-code": JAN } },
      turnStart("claudeAgent"),
      session(EVA),
      undefined,
    ],
    [
      "admits a turn on no known thread and no named instance",
      janSignedClaude,
      turnStart(),
      session(EVA),
      undefined,
    ],
    [
      "leaves stopping a turn to every member",
      { ...janSignedClaude, threadInstanceId: "claudeAgent" },
      interrupt,
      session(EVA),
      undefined,
    ],
    [
      "gates an answer to a message-mode question: it starts a turn",
      {
        ...janSignedClaude,
        threadInstanceId: "claudeAgent",
        question: { kind: "user-input.requested", payload: { responseMode: "message" } },
      },
      answer,
      session(EVA),
      SOMEONE_ELSE,
    ],
    [
      "leaves an answer to a native callback question to every member",
      {
        ...janSignedClaude,
        threadInstanceId: "claudeAgent",
        question: { kind: "user-input.requested", payload: {} },
      },
      answer,
      session(EVA),
      undefined,
    ],
    [
      "gates an answer whose question cannot be read",
      { ...janSignedClaude, threadInstanceId: "claudeAgent", question: "unreadable" },
      answer,
      session(EVA),
      SOMEONE_ELSE,
    ],
    [
      "refuses a session that names no Zerops user",
      janSignedClaude,
      turnStart("claudeAgent"),
      { kind: "session", subject: "cloud-connect" },
      SOMEONE_ELSE,
    ],
    [
      "admits every turn outside a Zerops environment",
      { ...janSignedClaude, zerops: false },
      turnStart("claudeAgent"),
      session(EVA),
      undefined,
    ],
    [
      "admits a crew turn started by the signer",
      janSignedClaude,
      turnStart("claudeAgent"),
      { kind: "crew", startedBy: JAN },
      undefined,
    ],
    [
      "refuses a crew turn started by somebody else",
      janSignedClaude,
      turnStart("claudeAgent"),
      { kind: "crew", startedBy: EVA },
      SOMEONE_ELSE,
    ],
    // X3: a turn no session stands behind follows project access, as a session does.
    [
      "refuses a crew turn whose starter this project no longer opens for",
      { ...janSignedClaude, access: { [JAN]: false } },
      turnStart("claudeAgent"),
      { kind: "crew", startedBy: JAN },
      NO_ACCESS,
    ],
    [
      "refuses a crew turn whose starter's access cannot be confirmed",
      { ...janSignedClaude, access: {} },
      turnStart("opencode"),
      { kind: "crew", startedBy: JAN },
      ACCESS_UNCONFIRMED,
    ],
    [
      "admits a stand-up its starter signed the agent in for and may still use",
      janSignedClaude,
      turnStart("claudeAgent"),
      { kind: "standup", startedBy: JAN },
      undefined,
    ],
    [
      "refuses a stand-up whose starter this project no longer opens for",
      { ...janSignedClaude, access: { [JAN]: false } },
      turnStart("claudeAgent"),
      { kind: "standup", startedBy: JAN },
      NO_ACCESS,
    ],
    [
      "refuses a stand-up on an agent somebody else signed in",
      janSignedClaude,
      turnStart("claudeAgent"),
      { kind: "standup", startedBy: EVA },
      SOMEONE_ELSE,
    ],
    ...(["thread.archive", "thread.unarchive", "thread.delete"] as const).map(
      (type) =>
        [
          `refuses ${type} on a crewmate's conversation from a session`,
          { ...janSignedClaude, crewThread: { profile: "given" } },
          onCrewThread(type),
          session(JAN),
          CREW_KEEPS_IT,
        ] as const,
    ),
    [
      "refuses a runtime-mode change on a crewmate's conversation",
      { ...janSignedClaude, crewThread: { profile: "given" } },
      onCrewThreadMode,
      session(JAN),
      MODE_KEPT,
    ],
    [
      "leaves a runtime-mode change on a person's own conversation alone",
      { ...janSignedClaude, threadInstanceId: "claudeAgent" },
      onCrewThreadMode,
      session(JAN),
      undefined,
    ],
    [
      "leaves archiving a crewmate's conversation to the crew itself",
      { ...janSignedClaude, crewThread: { profile: "given" } },
      onCrewThread("thread.archive"),
      { kind: "crew", startedBy: JAN },
      undefined,
    ],
    [
      "refuses a session's turn on a retired crewmate conversation",
      { ...janSignedClaude, crewThread: { archived: true, profile: "given" } },
      turnStart("claudeAgent"),
      session(JAN),
      RETIRED,
    ],
    [
      "refuses a crewmate turn the thread tool policy has no profile for",
      { ...janSignedClaude, crewThread: { profile: "none" } },
      turnStart("claudeAgent"),
      { kind: "crew", startedBy: JAN },
      NOT_RUNNING,
    ],
    [
      "refuses a crewmate turn where no thread tool policy registry exists",
      { ...janSignedClaude, crewThread: { profile: "no-registry" } },
      turnStart("claudeAgent"),
      session(JAN),
      NOT_RUNNING,
    ],
    [
      "refuses a crewmate turn on an agent that never reads the crew's profile",
      {
        ...janSignedClaude,
        drivers: { ...DEFAULT_DRIVERS, cursor: "cursor" },
        threadInstanceId: "cursor",
        crewThread: { profile: "given" },
      },
      turnStart("cursor"),
      { kind: "crew", startedBy: JAN },
      UNGATED,
    ],
    [
      "refuses a crewmate turn that names an agent which never reads the crew's profile",
      {
        ...janSignedClaude,
        drivers: { ...DEFAULT_DRIVERS, cursor: "cursor" },
        threadInstanceId: "claudeAgent",
        crewThread: { profile: "given" },
      },
      turnStart("cursor"),
      { kind: "crew", startedBy: JAN },
      UNGATED,
    ],
    [
      "admits a crewmate turn its profile gates, as its signer",
      { ...janSignedClaude, crewThread: { profile: "given" } },
      turnStart("claudeAgent"),
      session(JAN),
      undefined,
    ],
    [
      "leaves a person's own session to the membership watch",
      { ...janSignedClaude, access: { [JAN]: false } },
      turnStart("claudeAgent"),
      session(JAN),
      undefined,
    ],
  ] as const satisfies ReadonlyArray<
    readonly [string, World, OrchestrationCommand, TurnPrincipal, string | undefined]
  >) {
    it.effect(name, () =>
      Effect.gen(function* () {
        assert.strictEqual(yield* admitted(world, command, principal), expected);
      }),
    );
  }
});

const operator = (
  world: World,
  instanceIds: ReadonlyArray<string>,
  principal: TurnPrincipal,
): Effect.Effect<string | undefined> =>
  admission(world).pipe(
    Effect.flatMap((service) => service.admitOperator({ instanceIds, principal })),
    Effect.match({ onFailure: (error) => error.message, onSuccess: () => undefined }),
  );

/** Jan's Claude Code login whose credential stopped working here: still his. */
const janNeedsReauth: World = {
  ...janSignedClaude,
  agents: [{ ...signedIn("claude-code"), providerAuth: "unauthenticated" }],
};

describe("ZeropsTurnAdmission.admitOperator", () => {
  for (const [name, world, instanceIds, principal, expected] of [
    [
      "lets the signer run or change what runs on their login",
      janSignedClaude,
      ["claudeAgent"],
      session(JAN),
      undefined,
    ],
    [
      "refuses anybody else, in admission's words",
      janSignedClaude,
      ["claudeAgent"],
      session(EVA),
      SOMEONE_ELSE,
    ],
    [
      "refuses everybody on a login nobody recorded a signer for",
      { agents: [signedIn("claude-code")] },
      ["claudeAgent"],
      session(JAN),
      UNRECORDED,
    ],
    [
      "lets anybody on a token-authorized agent: a key belongs to the project",
      { agents: [signedIn("codex", true)], signers: { codex: JAN } },
      ["codex"],
      session(EVA),
      undefined,
    ],
    [
      "lets anybody where no login is held: there is nobody's to spend",
      {
        agents: [
          {
            ...signedIn("claude-code"),
            credPresent: false,
            providerAuth: "unauthenticated",
            state: "not-authorized",
          },
        ],
        signers: { "claude-code": JAN },
      },
      ["claudeAgent"],
      session(EVA),
      undefined,
    ],
    [
      "judges a login whose credential stopped working by whose it is",
      janNeedsReauth,
      ["claudeAgent"],
      session(EVA),
      SOMEONE_ELSE,
    ],
    [
      "lets its signer at a login whose credential stopped working",
      janNeedsReauth,
      ["claudeAgent"],
      session(JAN),
      undefined,
    ],
    [
      "judges another login by its own signer",
      evaSignedWork,
      ["claudeAgent-work"],
      session(JAN),
      LOGIN_SOMEONE_ELSE,
    ],
    [
      "lets another login's own signer",
      evaSignedWork,
      ["claudeAgent-work"],
      session(EVA),
      undefined,
    ],
    [
      "never lets another login inherit its agent's signer",
      { ...evaSignedWork, signers: { "claude-code": JAN } },
      ["claudeAgent-work"],
      session(JAN),
      LOGIN_UNRECORDED,
    ],
    [
      "lets anybody on another login that holds no credential",
      { ...evaSignedWork, logins: { "claudeAgent-work": "reconnect" } },
      ["claudeAgent-work"],
      session(JAN),
      undefined,
    ],
    [
      "judges another login that must sign in again by whose it is",
      { ...evaSignedWork, logins: { "claudeAgent-work": "needs-reauth" } },
      ["claudeAgent-work"],
      session(JAN),
      LOGIN_SOMEONE_ELSE,
    ],
    [
      "refuses on the first login of several the person may not run",
      evaSignedWork,
      ["claudeAgent-work", "claudeAgent"],
      session(EVA),
      SOMEONE_ELSE,
    ],
    ["lets a press that reaches no login", janSignedClaude, [], session(EVA), undefined],
    [
      "lets anybody on a driver Mate signs nobody in to",
      janSignedClaude,
      ["opencode"],
      session(EVA),
      undefined,
    ],
    [
      "lets anybody on an agent the auth feed does not report",
      { signers: { "claude-code": JAN } },
      ["claudeAgent"],
      session(EVA),
      undefined,
    ],
    [
      "refuses a session that names no Zerops user",
      janSignedClaude,
      ["claudeAgent"],
      { kind: "session", subject: "cloud-connect" },
      SOMEONE_ELSE,
    ],
    [
      "judges a crew principal by its starter",
      janSignedClaude,
      ["claudeAgent"],
      { kind: "crew", startedBy: EVA },
      SOMEONE_ELSE,
    ],
    [
      "lets everybody outside a Zerops environment",
      { ...janSignedClaude, zerops: false },
      ["claudeAgent"],
      session(EVA),
      undefined,
    ],
  ] as const satisfies ReadonlyArray<
    readonly [string, World, ReadonlyArray<string>, TurnPrincipal, string | undefined]
  >) {
    it.effect(name, () =>
      Effect.gen(function* () {
        assert.strictEqual(yield* operator(world, instanceIds, principal), expected);
      }),
    );
  }
});

const runAdmitted = (
  world: World,
  instanceId: string,
  principal: TurnPrincipal,
): Effect.Effect<string | undefined> =>
  admission(world).pipe(
    Effect.flatMap((service) => service.admitRun({ instanceId, principal })),
    Effect.match({ onFailure: (error) => error.message, onSuccess: () => undefined }),
  );

describe("ZeropsTurnAdmission.admitRun", () => {
  for (const [name, world, instanceId, principal, expected] of [
    ["admits the signer's own run", janSignedClaude, "claudeAgent", session(JAN), undefined],
    [
      "refuses a run on an agent another member signed in",
      janSignedClaude,
      "claudeAgent",
      session(EVA),
      SOMEONE_ELSE,
    ],
    [
      "refuses a run on an agent nobody recorded a signer for",
      { agents: [signedIn("claude-code")] },
      "claudeAgent",
      session(JAN),
      UNRECORDED,
    ],
    [
      "admits anybody on a token-authorized agent",
      { agents: [signedIn("codex", true)], signers: { codex: JAN } },
      "codex",
      session(EVA),
      undefined,
    ],
    [
      "refuses a run on another login a teammate signed in",
      evaSignedWork,
      "claudeAgent-work",
      session(JAN),
      LOGIN_SOMEONE_ELSE,
    ],
    [
      "refuses a wake for somebody this project no longer opens for",
      { ...janSignedClaude, access: { [JAN]: false } },
      "claudeAgent",
      { kind: "standup", startedBy: JAN },
      NO_ACCESS,
    ],
    [
      "refuses a wake whose person's access cannot be confirmed",
      { ...janSignedClaude, access: {} },
      "claudeAgent",
      { kind: "crew", startedBy: JAN },
      ACCESS_UNCONFIRMED,
    ],
    [
      "admits a wake for the signer who still has access",
      janSignedClaude,
      "claudeAgent",
      { kind: "standup", startedBy: JAN },
      undefined,
    ],
    [
      "lets everybody outside a Zerops environment",
      { ...janSignedClaude, zerops: false },
      "claudeAgent",
      session(EVA),
      undefined,
    ],
  ] as const satisfies ReadonlyArray<
    readonly [string, World, string, TurnPrincipal, string | undefined]
  >) {
    it.effect(name, () =>
      Effect.gen(function* () {
        assert.strictEqual(yield* runAdmitted(world, instanceId, principal), expected);
      }),
    );
    it.effect(`refuses exactly as the command door does: ${name}`, () =>
      Effect.gen(function* () {
        assert.strictEqual(
          yield* runAdmitted(world, instanceId, principal),
          yield* admitted(world, turnStart(instanceId), principal),
        );
      }),
    );
  }
});

it.effect(
  "Decision: refusals correlate by login identity (id), never by label or message text.",
  () =>
    Effect.gen(function* () {
      const gate = yield* admission({
        logins: { "claudeAgent-work": "not-authorized" },
        drivers: { "claudeAgent-work": "claudeAgent" },
      });
      const error = yield* gate
        .admit({ command: turnStart("claudeAgent-work"), principal: session(JAN) })
        .pipe(Effect.flip);
      assert.ok(Schema.is(OrchestrationDispatchCommandError)(error));
      assert.deepEqual(error.agentAdmission, {
        loginId: "claudeAgent-work",
        reason: "missing-sign-in",
      });
    }),
);

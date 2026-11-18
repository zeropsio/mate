import { assert, describe, it } from "@effect/vitest";
import { loginTurnRefusal, turnRefusal } from "@t3tools/shared/zeropsAgentAuth";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import { ProviderInstances } from "../spi/providerInstances.ts";
import * as ZeropsAgentAuthModule from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import { ZeropsAutomation } from "./ZeropsAutomation.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsLoginsModule from "./ZeropsLogins.ts";
import {
  OrchestrationDispatchCommandError,
  ProviderDriverKind,
  SessionSubject,
  ZEROPS_SUBJECT_PREFIX,
  type ZeropsAgentAuth,
  type ZeropsAgentId,
  type ZeropsLoginState,
  ZeropsUserId,
} from "@t3tools/contracts";
import * as ZeropsProjectSignersModule from "./ZeropsProjectSigners.ts";
import { ZeropsSignerStanding } from "./ZeropsSignerStanding.ts";
import { make as makeAdmission, type TurnPrincipal } from "./ZeropsTurnAdmission.ts";

const JAN = ZeropsUserId.make("jan-user-id");
const EVA = ZeropsUserId.make("eva-user-id");
const CREATED_AT = "2026-09-27T10:00:00.000Z";

const environment = resolveZeropsEnvironment({
  projectId: "TEST000000000000000023",
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
  subject: SessionSubject.make(`${ZEROPS_SUBJECT_PREFIX}${userId}`),
});

interface World {
  readonly zerops?: boolean;
  readonly agents?: ReadonlyArray<ZeropsAgentAuth>;
  readonly signers?: ZeropsProjectSignersModule.ProjectSigners;
  /**
   * Whether each person may still run turns here, as HQ's signer standing answers on a login they
   * signed: `true` is `may`, `false` is `no_access`, absent is HQ unable to say.
   */
  readonly access?: Readonly<Record<string, boolean | undefined>>;
  /** Configured instance → driver kind; the two default instances when absent. */
  readonly drivers?: Readonly<Record<string, string>>;
  /** Logins beyond the defaults (`ZeropsLogins`), by id → their state. */
  readonly logins?: Readonly<Record<string, ZeropsLoginState>>;
  /** The server-driven logins this server holds (`ZeropsAgentLogin`), by agent. */
  readonly agentLogins?: ZeropsAgentLoginModule.ZeropsAgentLoginByAgent;
  /** Whether HQ says this Mate is automated (`ZeropsAutomation`). */
  readonly automated?: boolean;
  /** Every question the gate was asked, as it was asked. */
  readonly gateCalls?: Array<{ readonly agentId: string; readonly login: unknown }>;
}

const DEFAULT_DRIVERS: Readonly<Record<string, string>> = {
  claudeAgent: "claudeAgent",
  codex: "codex",
};

const admission = (world: World) =>
  makeAdmission.pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerConfig.layer({
          zerops: world.zerops === false ? undefined : environment,
        } as ServerConfig.ServerConfig["Service"]),
        Layer.mock(ProviderInstances)({
          driverKindOf: (instanceId) => {
            const driver = (world.drivers ?? DEFAULT_DRIVERS)[instanceId];
            return Effect.succeed(
              driver === undefined ? undefined : ProviderDriverKind.make(driver),
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
        Layer.mock(ZeropsAutomation)({ automated: Effect.succeed(world.automated === true) }),
        Layer.mock(ZeropsAgentAuthModule.ZeropsAgentAuth)({
          latest: Effect.succeed({ available: true, agents: world.agents ?? [] }),
        }),
        Layer.mock(ZeropsAgentLoginModule.ZeropsAgentLogin)({
          latest: Effect.succeed(world.agentLogins ?? {}),
        }),
        Layer.mock(ZeropsProjectSignersModule.ZeropsProjectSigners)({
          turnRefusal: ({ agentId, agent, person, login }) =>
            Effect.sync(() => world.gateCalls?.push({ agentId, login })).pipe(
              Effect.as(
                turnRefusal({
                  agent,
                  signer: world.signers?.[agentId],
                  person,
                }),
              ),
            ),
          loginRefusal: ({ key, state, token, person, login }) =>
            Effect.sync(() => world.gateCalls?.push({ agentId: key, login })).pipe(
              Effect.as(
                loginTurnRefusal({
                  state,
                  token,
                  signer: world.signers?.[key],
                  person,
                }),
              ),
            ),
        }),
        Layer.mock(ZeropsSignerStanding)({
          standing: (userId) => {
            const access = world.access?.[userId];
            return Effect.succeed(
              access === undefined ? undefined : access ? ("may" as const) : ("no_access" as const),
            );
          },
        }),
      ),
    ),
  );

const runAdmitted = (
  world: World,
  instanceId: string,
  principal: TurnPrincipal,
): Effect.Effect<string | undefined> =>
  admission(world).pipe(
    Effect.flatMap((service) => service.admitRun({ instanceId, principal })),
    Effect.match({ onFailure: (error) => error.message, onSuccess: () => undefined }),
  );

const AUTOMATED = "An automated Mate runs on your organization's API key; nobody signs in to it.";
const NO_ACCESS = "The person this turn runs for no longer has access to this project.";
const ACCESS_UNCONFIRMED =
  "Could not confirm that the person this turn runs for still has access to this project. Try again in a moment.";

const SOMEONE_ELSE = "This agent was signed in by another project member — only they can run it.";
const UNRECORDED =
  "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it. Sign in with your own account first.";

const LOGIN_SOMEONE_ELSE =
  "Claude Code · work was signed in by another project member — only they can run it.";
const LOGIN_UNRECORDED =
  "Claude Code · work's sign-in was not recorded by Zerops Mate, so nobody can run it. Sign it in with your own account first.";

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
      yield* runAdmitted(
        {
          agents: [{ ...signedIn("claude-code"), state: "local-only", providerAuth: "unknown" }],
          agentLogins: { "claude-code": login },
          gateCalls,
        },
        "claudeAgent",
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
      yield* runAdmitted(
        { ...evaSignedWork, agentLogins: { "claudeAgent-work": login }, gateCalls },
        "claudeAgent-work",
        session(JAN),
      );
      assert.deepStrictEqual(gateCalls, [{ agentId: "claudeAgent-work", login }]);
    }),
  );
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
  it.effect.each(
    Array.from(
      [
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
          { kind: "session", subject: SessionSubject.make("cloud-connect") },
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
      >,
      ([name, world, instanceIds, principal, expected]) => ({
        title: name,
        world,
        instanceIds,
        principal,
        expected,
      }),
    ),
  )("$title", ({ world, instanceIds, principal, expected }) =>
    Effect.gen(function* () {
      assert.strictEqual(yield* operator(world, instanceIds, principal), expected);
    }),
  );
});

const generationAdmitted = (
  world: World,
  instanceId: string,
  subject: string,
): Effect.Effect<string | undefined> =>
  admission(world).pipe(
    Effect.flatMap((service) =>
      service.admitGeneration({
        instanceId,
        subject: SessionSubject.make(`${ZEROPS_SUBJECT_PREFIX}${subject}`),
      }),
    ),
    Effect.match({ onFailure: (error) => error.message, onSuccess: () => undefined }),
  );

describe("ZeropsTurnAdmission.admitGeneration", () => {
  it.effect.each([
    {
      title: "lets the signer ask their own agent for text",
      world: janSignedClaude,
      subject: JAN,
      expected: undefined,
    },
    {
      title: "refuses text from an agent another member signed in",
      world: janSignedClaude,
      subject: EVA,
      expected: SOMEONE_ELSE,
    },
    {
      title: "refuses text from an agent that is not signed in",
      world: {
        agents: [
          {
            ...signedIn("claude-code"),
            credPresent: false,
            providerAuth: "unauthenticated",
            state: "not-authorized",
          },
        ],
        signers: { "claude-code": JAN },
      } satisfies World,
      subject: JAN,
      expected: "Claude Code is not signed in on this project. Sign it in to use it.",
    },
  ] as const)("$title", ({ world, subject, expected }) =>
    Effect.gen(function* () {
      assert.strictEqual(yield* generationAdmitted(world, "claudeAgent", subject), expected);
    }),
  );
});

describe("ZeropsTurnAdmission.admitRun", () => {
  it.effect.each(
    Array.from(
      [
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
          { kind: "crew", startedBy: JAN },
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
        [
          "an automated Mate refuses a run on a subscription sign-in, even its signer's own",
          { ...janSignedClaude, automated: true },
          "claudeAgent",
          session(JAN),
          AUTOMATED,
        ],
        [
          "an automated Mate refuses a run on a subscription login",
          { ...evaSignedWork, automated: true },
          "claudeAgent-work",
          session(EVA),
          AUTOMATED,
        ],
        [
          "a task's run is refused on a subscription sign-in",
          janSignedClaude,
          "claudeAgent",
          { kind: "task", taskId: "task-1" },
          AUTOMATED,
        ],
        [
          "a task's run is admitted on OpenCode, which nobody signs in to",
          { drivers: { opencode: "opencode" }, automated: true },
          "opencode",
          { kind: "task", taskId: "task-1" },
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
          "claudeAgent",
          session(JAN),
          "Claude Code is not signed in on this project. Sign it in to use it.",
        ],
        [
          "resolves the agent-auth spelling of an instance too",
          janSignedClaude,
          "claude-code",
          session(EVA),
          SOMEONE_ELSE,
        ],
        [
          "gates a second instance of a signed-in agent's driver as that agent",
          { ...janSignedClaude, drivers: { ...DEFAULT_DRIVERS, claudeAgent_work: "claudeAgent" } },
          "claudeAgent_work",
          session(EVA),
          SOMEONE_ELSE,
        ],
        [
          "admits a turn on another login by that login's own signer",
          evaSignedWork,
          "claudeAgent-work",
          session(EVA),
          undefined,
        ],
        [
          "refuses a crew turn on a login its starter did not sign in (N9)",
          evaSignedWork,
          "claudeAgent-work",
          { kind: "crew", startedBy: JAN },
          LOGIN_SOMEONE_ELSE,
        ],
        [
          "admits a crew turn on the starter's own login",
          evaSignedWork,
          "claudeAgent-work",
          { kind: "crew", startedBy: EVA },
          undefined,
        ],
        [
          "never lets another login inherit its agent's signer",
          { ...evaSignedWork, signers: { "claude-code": JAN } },
          "claudeAgent-work",
          session(JAN),
          LOGIN_UNRECORDED,
        ],
        [
          "refuses a turn on another login that is not signed in",
          { ...evaSignedWork, logins: { "claudeAgent-work": "not-authorized" } },
          "claudeAgent-work",
          session(EVA),
          "Claude Code · work is not signed in on this project. Sign it in to use it.",
        ],
        [
          "admits a turn on a driver Mate signs nobody in to",
          janSignedClaude,
          "opencode",
          session(EVA),
          undefined,
        ],
        [
          "admits a turn whose agent the auth feed does not report",
          { signers: { "claude-code": JAN } },
          "claudeAgent",
          session(EVA),
          undefined,
        ],
        [
          "refuses a session that names no Zerops user",
          janSignedClaude,
          "claudeAgent",
          { kind: "session", subject: SessionSubject.make("cloud-connect") },
          SOMEONE_ELSE,
        ],
        [
          "admits a crew turn started by the signer",
          janSignedClaude,
          "claudeAgent",
          { kind: "crew", startedBy: JAN },
          undefined,
        ],
        [
          "refuses a crew turn started by somebody else",
          janSignedClaude,
          "claudeAgent",
          { kind: "crew", startedBy: EVA },
          SOMEONE_ELSE,
        ],
        // Adding a Mate sets it up with no condition: its stand-up asks HQ nothing.
        // witness: apps/server/src/zerops/ZeropsTurnAdmission.ts | principal.kind === "crew"; → principal.kind === "crew" || principal.kind === "standup";
        [
          "admits a stand-up whatever HQ says of its starter's access",
          { ...janSignedClaude, access: { [JAN]: false } },
          "claudeAgent",
          { kind: "standup", startedBy: JAN },
          undefined,
        ],
        [
          "refuses a stand-up on an agent somebody else signed in",
          janSignedClaude,
          "claudeAgent",
          { kind: "standup", startedBy: EVA },
          SOMEONE_ELSE,
        ],
        [
          "leaves a person's own session to the membership watch",
          { ...janSignedClaude, access: { [JAN]: false } },
          "claudeAgent",
          session(JAN),
          undefined,
        ],
      ] as const satisfies ReadonlyArray<
        readonly [string, World, string, TurnPrincipal, string | undefined]
      >,
      ([name, world, instanceId, principal, expected]) => ({
        title: name,
        world,
        instanceId,
        principal,
        expected,
      }),
    ),
  )("$title", ({ world, instanceId, principal, expected }) =>
    Effect.gen(function* () {
      assert.strictEqual(yield* runAdmitted(world, instanceId, principal), expected);
    }),
  );
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
        .admitRun({ instanceId: "claudeAgent-work", principal: session(JAN) })
        .pipe(Effect.flip);
      assert.ok(Schema.is(OrchestrationDispatchCommandError)(error));
      assert.deepEqual(error.agentAdmission, {
        loginId: "claudeAgent-work",
        reason: "missing-sign-in",
      });
    }),
);

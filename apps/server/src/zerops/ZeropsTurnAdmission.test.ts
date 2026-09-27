import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
  ProviderInstanceId,
  ThreadId,
  type ZeropsAgentAuth,
  type ZeropsAgentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ZeropsAgentAuthModule from "./ZeropsAgentAuth.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
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
  allowedOrigins: [],
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
}

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
              world.threadInstanceId === undefined
                ? Option.none()
                : Option.some({
                    modelSelection: { instanceId: world.threadInstanceId, model: "m" },
                  } as unknown as OrchestrationThreadShell),
            ),
        }),
        Layer.mock(ZeropsAgentAuthModule.ZeropsAgentAuth)({
          latest: Effect.succeed({ available: true, agents: world.agents ?? [] }),
        }),
        Layer.mock(ZeropsProjectSignersModule.ZeropsProjectSigners)({
          turnRefusal: ({ agentId, agent, subject }) =>
            Effect.succeed(
              ZeropsProjectSignersModule.turnRefusal({
                agent,
                signer: world.signers?.[agentId],
                subject,
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

const SOMEONE_ELSE =
  "This agent was signed in by another project member — only they can run it. Sign in with your own account first.";
const UNRECORDED =
  "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it. Sign in with your own account first.";

const interrupt: OrchestrationCommand = {
  type: "thread.turn.interrupt",
  commandId: CommandId.make("command-1"),
  threadId: THREAD,
  createdAt: CREATED_AT,
};

const janSignedClaude: World = {
  agents: [signedIn("claude-code")],
  signers: { "claude-code": JAN },
};

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

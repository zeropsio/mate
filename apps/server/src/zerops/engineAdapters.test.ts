import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import {
  ConversationId,
  OrchestrationDispatchCommandError,
  type Principal,
  type RunTrigger,
} from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import {
  AgentWorkspace,
  RestartEvidence,
  RunAdmission,
  WorkspaceUnavailable,
} from "../engine/ports.ts";
import { CrewWorkspaceDirectory } from "./crew/engine/CrewWorkspaceDirectory.ts";
import {
  engineAdaptersOpen,
  serverWorkspace,
  turnPrincipalOf,
  zeropsRunAdmission,
} from "./engineAdapters.ts";
import { makeZeropsRepositorySource, ZeropsRepositorySource } from "./ZeropsRepositorySource.ts";
import { type TurnPrincipal, ZeropsTurnAdmission } from "./ZeropsTurnAdmission.ts";

describe("engineAdapters", () => {
  const wake = (cause: string): RunTrigger => ({ kind: "wake", cause, wakeId: null });
  it.each([
    [
      "a person's run is their session's turn",
      { kind: "person", subject: "zerops-user:jan" },
      { kind: "person", itemId: "mate/r/1/i/1" },
      { kind: "session", subject: "zerops-user:jan" },
    ],
    [
      "a crew wake is a crew turn for its starter",
      { kind: "crew", startedBy: "jan" },
      wake("crew"),
      { kind: "crew", startedBy: "jan" },
    ],
    [
      "a stand-up wake is the stand-up's turn",
      { kind: "standup", startedBy: "jan" },
      wake("standup"),
      { kind: "standup", startedBy: "jan" },
    ],
    [
      "a task's run, the brief or a wake that continues it, is the task's turn",
      { kind: "task", taskId: "task-1" },
      { kind: "person", itemId: "task/r/1/i/1" },
      { kind: "task", taskId: "task-1" },
    ],
    [
      "any other wake is admitted like a stand-up, for the person it continues",
      { kind: "person", subject: "zerops-user:eva" },
      wake("usage-resume"),
      { kind: "standup", startedBy: "eva" },
    ],
    ["the engine itself is never admitted", { kind: "engine" }, wake("watchdog"), null],
  ] as ReadonlyArray<readonly [string, Principal, RunTrigger, TurnPrincipal | null]>)(
    "%s",
    (_, principal, trigger, expected) => {
      assert.deepStrictEqual(turnPrincipalOf(principal, trigger), expected);
    },
  );

  it.effect("outside Zerops every run is admitted and there is no restart to read", () =>
    Effect.gen(function* () {
      yield* (yield* RunAdmission).admit({
        instanceId: "claudeAgent",
        principal: { kind: "person", subject: "local" },
        trigger: { kind: "wake", cause: "standup", wakeId: null },
      });
      assert.strictEqual(yield* (yield* RestartEvidence).read, null);
    }).pipe(Effect.provide(engineAdaptersOpen)),
  );

  it.effect("a run refused for a login reaches the engine naming that login", () =>
    Effect.gen(function* () {
      const refused = yield* Effect.flip(
        (yield* RunAdmission).admit({
          instanceId: "claudeAgent",
          principal: { kind: "person", subject: "zerops-user:jan" },
          trigger: { kind: "person", itemId: "mate/r/1/i/1" as never },
        }),
      );
      assert.deepStrictEqual(
        { message: refused.message, admission: refused.admission },
        {
          message: "Claude's sign-in has expired.",
          admission: { loginId: "claude-code", reason: "expired-login" },
        },
      );
    }).pipe(
      Effect.provide(
        zeropsRunAdmission.pipe(
          Layer.provide(
            Layer.succeed(
              ZeropsTurnAdmission,
              ZeropsTurnAdmission.of({
                admit: () => Effect.void,
                admitOperator: () => Effect.void,
                admitGeneration: () => Effect.void,
                admitRun: () =>
                  Effect.fail(
                    new OrchestrationDispatchCommandError({
                      message: "Claude's sign-in has expired.",
                      agentAdmission: { loginId: "claude-code", reason: "expired-login" },
                    }),
                  ),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  it.effect(
    "a run a restart cut is explained by the platform's record: who restarted the Mate, and when",
    () =>
      Effect.gen(function* () {
        const evidence = yield* RestartEvidence;
        const facts = {
          name: "Fen",
          projectId: "p1",
          serviceId: "s1",
          containerStartedAt: null,
          processes: [
            {
              status: "FINISHED",
              actionName: "stack.restart",
              serviceStackId: "s1",
              started: "2026-10-07T10:00:00.000Z",
              createdByUser: { fullName: "Ana Novak" },
            },
          ],
        };
        const window = {
          lastActivityAt: Date.parse("2026-10-07T09:59:00.000Z"),
          bootAt: Date.parse("2026-10-07T10:01:00.000Z"),
        };
        assert.deepStrictEqual(evidence.explain(facts, window), {
          cause: "restarted",
          at: "2026-10-07T10:00:00.000Z",
        });
        assert.deepStrictEqual(evidence.explain(null, window), {
          cause: "restarted",
          at: "2026-10-07T10:01:00.000Z",
        });
      }).pipe(Effect.provide(engineAdaptersOpen)),
  );
});

describe("engineAdapters: where an agent works", () => {
  const ana = ConversationId.make("crew-main-ana-1");
  const mate = ConversationId.make("mate");
  const lane = { cwd: "/var/www/.crew/ana", runtimeMode: "full-access" } as const;
  const crew = Layer.succeed(CrewWorkspaceDirectory, {
    workspaceOf: (conversation) =>
      Effect.succeed(conversation === ana ? Option.some(lane) : Option.none()),
  });
  // The server's directory is all the workspace reads of its config.
  const config = Layer.succeed(ServerConfig, {
    cwd: "/var/www",
  } as unknown as ServerConfig["Service"]);

  it.effect(
    "a crewmate's conversation works where its crew says; any other in the server's directory",
    () =>
      Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        assert.deepStrictEqual(yield* workspace.of(ana, null), lane);
        assert.deepStrictEqual(yield* workspace.of(mate, null), {
          cwd: "/var/www",
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(serverWorkspace.pipe(Layer.provideMerge(Layer.merge(config, crew))))),
  );

  it.effect(
    "a crewmate's conversation whose workspace its crew cannot tell opens nowhere, never in the server's directory",
    () =>
      Effect.gen(function* () {
        const unread = yield* Effect.flip((yield* AgentWorkspace).of(ana, null));
        assert.strictEqual(unread._tag, "WorkspaceUnavailable");
      }).pipe(
        Effect.provide(
          serverWorkspace.pipe(
            Layer.provideMerge(
              Layer.merge(
                config,
                Layer.succeed(CrewWorkspaceDirectory, {
                  workspaceOf: () =>
                    Effect.fail(new WorkspaceUnavailable({ message: "The copy cannot be read." })),
                }),
              ),
            ),
          ),
        ),
      ),
  );

  it.effect("with no crew, every agent works in the server's directory", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* (yield* AgentWorkspace).of(ana, null), {
        cwd: "/var/www",
        runtimeMode: "full-access",
      });
    }).pipe(Effect.provide(serverWorkspace.pipe(Layer.provideMerge(config)))),
  );

  const lease = { alias: "webpool-3", pool: "webpool", branch: "feat-x" };
  it.effect(
    "a conversation bound to a lease works in the container zcp mounted for it, with full access",
    () =>
      Effect.gen(function* () {
        const workspace = yield* AgentWorkspace;
        assert.deepStrictEqual(yield* workspace.of(mate, lease), {
          cwd: "/var/www/webpool-3",
          runtimeMode: "full-access",
        });
        assert.deepStrictEqual(yield* workspace.of(mate, null), {
          cwd: "/var/www",
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(serverWorkspace.pipe(Layer.provideMerge(config)))),
  );

  it.effect(
    "a conversation whose lease is not mounted works in the server's directory until zcp mounts it again",
    () =>
      Effect.gen(function* () {
        const table = yield* Ref.make("");
        const source = yield* makeZeropsRepositorySource({
          enabled: true,
          readMountTable: Ref.get(table),
        });
        const workspace = yield* AgentWorkspace.pipe(
          Effect.provide(
            serverWorkspace.pipe(
              Layer.provideMerge(
                Layer.merge(config, Layer.succeed(ZeropsRepositorySource, source)),
              ),
            ),
          ),
        );
        assert.strictEqual((yield* workspace.of(mate, lease)).cwd, "/var/www");
        yield* Ref.set(
          table,
          "webpool-3:/var/www /var/www/webpool-3 fuse.sshfs rw,nosuid,nodev,relatime 0 0",
        );
        assert.strictEqual((yield* workspace.of(mate, lease)).cwd, "/var/www/webpool-3");
      }),
  );

  it.effect("beside a crew, a person's conversation bound to a lease still works in it", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* (yield* AgentWorkspace).of(mate, lease), {
        cwd: "/var/www/webpool-3",
        runtimeMode: "full-access",
      });
    }).pipe(Effect.provide(serverWorkspace.pipe(Layer.provideMerge(Layer.merge(config, crew))))),
  );
});

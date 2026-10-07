import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
  ZeropsAgentLoginError,
} from "@t3tools/contracts";
import { loadShowcaseScene, type ShowcaseScene } from "@t3tools/shared/showcaseScenes";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderInstanceRegistryTest, ProviderRegistryTest } from "../spi/ProviderRegistryTest.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentLogin from "./ZeropsAgentLogin.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { makeFixtureZeropsLayer } from "./ZeropsFixtureFeeds.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";
import { ZEROPS_SUBJECT_PREFIX } from "./ZeropsMembershipWatch.ts";
import { ZeropsTurnAdmission } from "./ZeropsTurnAdmission.ts";
import { MateEngine } from "../engine/MateEngine.ts";
import { RunAdmission } from "../engine/ports.ts";

const serviceMapScene = loadShowcaseScene("web:service-map-live");
const noZeropsScene = loadShowcaseScene("web:no-zerops");
const agentAuthAttentionScene = loadShowcaseScene("web:agent-auth-attention");
const scriptedLoginStartedAt = DateTime.makeUnsafe("2026-08-30T12:00:00.000Z");

const terminalLoginStepScene: ShowcaseScene = {
  ...agentAuthAttentionScene,
  steps: [
    {
      afterMs: 100,
      agentLogin: {
        codex: {
          phase: "succeeded",
          terminalId: "scripted-login-codex",
          startedAt: scriptedLoginStartedAt,
          startedBy: "showcase-user",
        },
      },
    },
  ],
};

const activeLoginStepScene: ShowcaseScene = {
  ...serviceMapScene,
  steps: [
    {
      afterMs: 100,
      agentLogin: {
        codex: {
          phase: "awaiting-browser",
          terminalId: "scripted-login-codex",
          startedAt: scriptedLoginStartedAt,
          startedBy: "showcase-user",
          url: "https://auth.openai.com/device",
          code: "SCRIPTED-CODE",
        },
      },
    },
  ],
};

const absoluteLoginStepScene: ShowcaseScene = {
  ...serviceMapScene,
  agentLogin: {
    "claude-code": {
      phase: "awaiting-browser",
      terminalId: "scripted-login-claude-code",
      startedAt: scriptedLoginStartedAt,
      startedBy: "showcase-user",
      url: "https://claude.ai/login",
    },
  },
  steps: [
    {
      afterMs: 300,
      agentLogin: {
        codex: {
          phase: "awaiting-code",
          terminalId: "scripted-login-codex",
          startedAt: scriptedLoginStartedAt,
          startedBy: "showcase-user",
          code: "SCRIPTED-CODE",
        },
      },
    },
  ],
};

/**
 * What the server hands the fixture layer from below: its config, the
 * projection the turn gate reads a thread's agent from, and the provider
 * registry it reads an instance's driver from. No scene here has a thread to
 * read or a configured instance to look up.
 */
const fixtureHost = (
  zerops: ServerConfig.ServerConfig["Service"]["zerops"],
  mateEngine: ServerConfig.MateEngineMode = "v1",
) =>
  Layer.mergeAll(
    ServerConfig.layer({ zerops, mateEngine } as ServerConfig.ServerConfig["Service"]),
    Layer.mock(ProjectionSnapshotQuery)({}),
    ProviderRegistryTest.empty(),
    ProviderInstanceRegistryTest.empty(),
  );

const fixtureLayer = (
  scene: ShowcaseScene,
  zerops: ServerConfig.ServerConfig["Service"]["zerops"] = undefined,
  mateEngine: ServerConfig.MateEngineMode = "v1",
) => makeFixtureZeropsLayer(scene).pipe(Layer.provide(fixtureHost(zerops, mateEngine)));

const withFixtureFeeds = <A>(
  scene: ShowcaseScene,
  use: (feeds: {
    readonly lifecycle: ZeropsLifecycle.ZeropsLifecycle["Service"];
    readonly agentAuth: ZeropsAgentAuth.ZeropsAgentAuth["Service"];
    readonly agentLogin: ZeropsAgentLogin.ZeropsAgentLogin["Service"];
  }) => Effect.Effect<A, never, Scope.Scope>,
) =>
  Effect.all({
    lifecycle: ZeropsLifecycle.ZeropsLifecycle,
    agentAuth: ZeropsAgentAuth.ZeropsAgentAuth,
    agentLogin: ZeropsAgentLogin.ZeropsAgentLogin,
  }).pipe(Effect.flatMap(use), Effect.scoped, Effect.provide(fixtureLayer(scene)));

const advanceTestClock = (ms: number) =>
  TestClock.adjust(`${ms} millis`).pipe(Effect.andThen(Effect.yieldNow));

it.effect("subscribes with every scene snapshot as the latest value", () =>
  withFixtureFeeds(serviceMapScene, ({ lifecycle, agentAuth, agentLogin }) =>
    Effect.gen(function* () {
      const lifecycleSubscription = yield* lifecycle.subscribe(serviceMapScene.lifecycle.threadId);
      const authSubscription = yield* agentAuth.subscribe;
      const loginSubscription = yield* agentLogin.subscribe;

      assert.deepEqual(lifecycleSubscription.latest, serviceMapScene.lifecycle);
      assert.deepEqual(authSubscription.latest, serviceMapScene.agentAuth);
      assert.equal(
        loginSubscription.latest["claude-code"],
        serviceMapScene.agentLogin["claude-code"],
      );
      assert.equal(loginSubscription.latest.codex, serviceMapScene.agentLogin.codex);
    }),
  ),
);

it.effect("login follows the clock and rechecks auth when it succeeds", () =>
  withFixtureFeeds(serviceMapScene, ({ agentAuth, agentLogin }) =>
    Effect.gen(function* () {
      const authSubscription = yield* agentAuth.subscribe;
      const republishedAuth = yield* Stream.runHead(authSubscription.changes).pipe(
        Effect.forkChild,
      );

      const started = yield* agentLogin
        .start("codex", serviceMapScene.lifecycle.threadId, "user-test")
        .pipe(Effect.orDie);
      assert.equal(started.terminalId, "agent-login-codex");
      assert.equal((yield* agentLogin.latest).codex?.phase, "starting");

      yield* advanceTestClock(500);
      assert.equal((yield* agentLogin.latest).codex?.phase, "awaiting-browser");

      yield* advanceTestClock(2_500);
      assert.equal((yield* agentLogin.latest).codex?.phase, "succeeded");
      assert.deepEqual(
        Option.getOrThrow(yield* Fiber.join(republishedAuth)),
        serviceMapScene.agentAuth,
      );
    }),
  ),
);

it.effect("cancel leaves the scripted login cancelled", () =>
  withFixtureFeeds(serviceMapScene, ({ agentLogin }) =>
    Effect.gen(function* () {
      yield* agentLogin
        .start("claude-code", serviceMapScene.lifecycle.threadId, "user-test")
        .pipe(Effect.orDie);
      yield* agentLogin.cancel("claude-code").pipe(Effect.orDie);
      assert.equal((yield* agentLogin.latest)["claude-code"]?.phase, "cancelled");

      yield* advanceTestClock(3_000);
      assert.equal((yield* agentLogin.latest)["claude-code"]?.phase, "cancelled");
    }),
  ),
);

it.effect("rejects login start when the fixture scene is unavailable", () =>
  withFixtureFeeds(noZeropsScene, ({ agentLogin }) =>
    Effect.gen(function* () {
      const error = yield* agentLogin
        .start("codex", noZeropsScene.lifecycle.threadId, "user-test")
        .pipe(Effect.flip, Effect.orDie);

      assert.instanceOf(error, ZeropsAgentLoginError);
      assert.equal(error.reason, "unavailable");
    }),
  ),
);

it.effect("rejects login cancel when the fixture scene is unavailable", () =>
  withFixtureFeeds(noZeropsScene, ({ agentLogin }) =>
    Effect.gen(function* () {
      const error = yield* agentLogin.cancel("codex").pipe(Effect.flip, Effect.orDie);

      assert.instanceOf(error, ZeropsAgentLoginError);
      assert.equal(error.reason, "unavailable");
    }),
  ),
);

it.effect("cancels a scene-provided active login", () =>
  withFixtureFeeds(agentAuthAttentionScene, ({ agentLogin }) =>
    Effect.gen(function* () {
      assert.equal((yield* agentLogin.latest).codex?.phase, "awaiting-browser");

      yield* agentLogin.cancel("codex").pipe(Effect.orDie);

      assert.equal((yield* agentLogin.latest).codex?.phase, "cancelled");
    }),
  ),
);

it.effect("reattaches to a scene-provided active login", () =>
  withFixtureFeeds(agentAuthAttentionScene, ({ agentLogin }) =>
    Effect.gen(function* () {
      const before = (yield* agentLogin.latest).codex;
      const result = yield* agentLogin
        .start("codex", agentAuthAttentionScene.lifecycle.threadId, "user-test")
        .pipe(Effect.orDie);

      assert.equal(result.terminalId, before?.terminalId);
      assert.equal((yield* agentLogin.latest).codex, before);
    }),
  ),
);

it.effect("a terminal login step makes cancel a no-op", () =>
  withFixtureFeeds(terminalLoginStepScene, ({ agentLogin }) =>
    Effect.gen(function* () {
      yield* advanceTestClock(100);
      assert.equal((yield* agentLogin.latest).codex?.phase, "succeeded");

      yield* agentLogin.cancel("codex").pipe(Effect.orDie);

      assert.equal((yield* agentLogin.latest).codex?.phase, "succeeded");
    }),
  ),
);

it.effect("a terminal login step lets start create a fresh session", () =>
  withFixtureFeeds(terminalLoginStepScene, ({ agentLogin }) =>
    Effect.gen(function* () {
      yield* advanceTestClock(100);

      const result = yield* agentLogin
        .start("codex", terminalLoginStepScene.lifecycle.threadId, "user-test")
        .pipe(Effect.orDie);

      assert.equal(result.terminalId, "agent-login-codex");
      assert.notEqual(result.terminalId, "scripted-login-codex");
      assert.equal((yield* agentLogin.latest).codex?.phase, "starting");
    }),
  ),
);

it.effect("a non-terminal login step seeds a cancellable session", () =>
  withFixtureFeeds(activeLoginStepScene, ({ agentLogin }) =>
    Effect.gen(function* () {
      yield* advanceTestClock(100);
      assert.equal((yield* agentLogin.latest).codex?.phase, "awaiting-browser");

      yield* agentLogin.cancel("codex").pipe(Effect.orDie);

      const cancelled = (yield* agentLogin.latest).codex;
      assert.equal(cancelled?.phase, "cancelled");
      assert.equal(cancelled?.terminalId, "scripted-login-codex");
      assert.deepEqual(cancelled?.startedAt, scriptedLoginStartedAt);
    }),
  ),
);

it.effect("agent login steps replace the whole login snapshot", () =>
  withFixtureFeeds(absoluteLoginStepScene, ({ agentLogin }) =>
    Effect.gen(function* () {
      const first = yield* agentLogin
        .start("claude-code", absoluteLoginStepScene.lifecycle.threadId, "user-test")
        .pipe(Effect.orDie);
      assert.equal(first.terminalId, "scripted-login-claude-code");

      yield* advanceTestClock(300);
      yield* advanceTestClock(2_700);
      assert.equal((yield* agentLogin.latest)["claude-code"], undefined);

      const restarted = yield* agentLogin
        .start("claude-code", absoluteLoginStepScene.lifecycle.threadId, "user-test")
        .pipe(Effect.orDie);
      assert.notEqual(restarted.terminalId, first.terminalId);
      assert.equal((yield* agentLogin.latest)["claude-code"]?.phase, "starting");
    }),
  ),
);

it.effect("answers an unknown lifecycle thread with the live feed's empty state", () =>
  withFixtureFeeds(serviceMapScene, ({ lifecycle }) =>
    Effect.gen(function* () {
      const unknownThread = ThreadId.make("fixture-unknown-thread");
      assert.deepEqual(yield* lifecycle.get(unknownThread), {
        threadId: unknownThread,
        recentTools: [],
      });
      assert.deepEqual((yield* lifecycle.subscribe(unknownThread)).latest, {
        threadId: unknownThread,
        recentTools: [],
      });
    }),
  ),
);

it.effect("admits turns through the live gate, over a scene where nobody recorded a signer", () =>
  Effect.gen(function* () {
    const admission = yield* ZeropsTurnAdmission;
    const refusal = yield* admission
      .admit({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("fixture-command"),
          threadId: ThreadId.make("fixture-thread"),
          message: {
            messageId: MessageId.make("fixture-message"),
            role: "user",
            text: "hi",
            attachments: [],
          },
          modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "m" },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: "2026-09-27T10:00:00.000Z",
        },
        principal: { kind: "session", subject: `${ZEROPS_SUBJECT_PREFIX}jan-user-id` },
      })
      .pipe(Effect.flip);
    assert.equal(
      refusal.message,
      "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it. Sign in with your own account first.",
    );
  }).pipe(
    Effect.provide(
      fixtureLayer(
        serviceMapScene,
        resolveZeropsEnvironment({
          projectId: "fixture-project",
          apiHost: undefined,
        }),
      ),
    ),
  ),
);

it.effect.each([
  ["runs V1 when the switch says v1", "v1", false],
  ["runs the Mate engine when the switch says mate", "mate", true],
] as const)("a fixture scene %s, as a live Mate would", ([, mateEngine, live]) =>
  Effect.gen(function* () {
    assert.strictEqual((yield* MateEngine).live, live);
  }).pipe(Effect.provide(fixtureLayer(serviceMapScene, undefined, mateEngine))),
);

it.effect(
  "a fixture scene on the Mate engine admits runs through the same gate as V1's turns",
  () =>
    Effect.gen(function* () {
      const refusal = yield* (yield* RunAdmission)
        .admit({
          instanceId: "claudeAgent",
          principal: { kind: "person", subject: `${ZEROPS_SUBJECT_PREFIX}jan-user-id` },
        })
        .pipe(Effect.flip);
      assert.equal(
        refusal.message,
        "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it. Sign in with your own account first.",
      );
    }).pipe(
      Effect.provide(
        fixtureLayer(
          serviceMapScene,
          resolveZeropsEnvironment({ projectId: "fixture-project", apiHost: undefined }),
          "mate",
        ),
      ),
    ),
);

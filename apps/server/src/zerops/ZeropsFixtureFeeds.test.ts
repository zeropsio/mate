import { assert, it } from "@effect/vitest";
import { ThreadId, ZeropsAgentLoginError } from "@t3tools/contracts";
import { loadShowcaseScene, type ShowcaseScene } from "@t3tools/shared/showcaseScenes";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentLogin from "./ZeropsAgentLogin.ts";
import { makeFixtureZeropsLayer } from "./ZeropsFixtureFeeds.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";
import * as ZeropsTopology from "./ZeropsTopology.ts";

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
          code: "SCRIPTED-CODE",
        },
      },
    },
  ],
};

const withFixtureFeeds = <A>(
  scene: ShowcaseScene,
  use: (feeds: {
    readonly topology: ZeropsTopology.ZeropsTopology["Service"];
    readonly lifecycle: ZeropsLifecycle.ZeropsLifecycle["Service"];
    readonly agentAuth: ZeropsAgentAuth.ZeropsAgentAuth["Service"];
    readonly agentLogin: ZeropsAgentLogin.ZeropsAgentLogin["Service"];
  }) => Effect.Effect<A, never, Scope.Scope>,
) =>
  Effect.all({
    topology: ZeropsTopology.ZeropsTopology,
    lifecycle: ZeropsLifecycle.ZeropsLifecycle,
    agentAuth: ZeropsAgentAuth.ZeropsAgentAuth,
    agentLogin: ZeropsAgentLogin.ZeropsAgentLogin,
  }).pipe(Effect.flatMap(use), Effect.scoped, Effect.provide(makeFixtureZeropsLayer(scene)));

const advanceTestClock = (ms: number) =>
  TestClock.adjust(`${ms} millis`).pipe(Effect.andThen(Effect.yieldNow));

it.effect("subscribes with every scene snapshot as the latest value", () =>
  withFixtureFeeds(serviceMapScene, ({ topology, lifecycle, agentAuth, agentLogin }) =>
    Effect.gen(function* () {
      const topologySubscription = yield* topology.subscribe;
      const lifecycleSubscription = yield* lifecycle.subscribe(serviceMapScene.lifecycle.threadId);
      const authSubscription = yield* agentAuth.subscribe;
      const loginSubscription = yield* agentLogin.subscribe;

      assert.deepEqual(topologySubscription.latest, serviceMapScene.topology);
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

it.effect("publishes each scripted step after its relative delay", () => {
  const first = {
    ...serviceMapScene.topology,
    warnings: ["first scripted topology"],
  };
  const second = {
    ...serviceMapScene.topology,
    warnings: ["second scripted topology"],
  };
  const scene: ShowcaseScene = {
    ...serviceMapScene,
    steps: [
      { afterMs: 100, topology: first },
      { afterMs: 200, topology: second },
    ],
  };

  return withFixtureFeeds(scene, ({ topology }) =>
    Effect.gen(function* () {
      const subscription = yield* topology.subscribe;
      const published = yield* subscription.changes.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      yield* advanceTestClock(100);
      assert.deepEqual((yield* topology.latest).warnings, first.warnings);
      yield* advanceTestClock(200);

      assert.deepEqual(
        Array.from(yield* Fiber.join(published)).map((snapshot) => snapshot.warnings),
        [first.warnings, second.warnings],
      );
    }),
  );
});

it.effect("refresh republishes the current topology snapshot", () =>
  withFixtureFeeds(serviceMapScene, ({ topology }) =>
    Effect.gen(function* () {
      const subscription = yield* topology.subscribe;
      const published = yield* Stream.runHead(subscription.changes).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      const refreshed = yield* topology.refresh;
      const change = Option.getOrThrow(yield* Fiber.join(published));

      assert.deepEqual(refreshed, serviceMapScene.topology);
      assert.deepEqual(change, serviceMapScene.topology);
    }),
  ),
);

it.effect("updates readAt without publishing unchanged topology content", () => {
  const reread = {
    ...serviceMapScene.topology,
    readAt: DateTime.makeUnsafe("2026-08-30T12:00:01.000Z"),
  };
  const changed = {
    ...reread,
    warnings: ["content changed"],
  };
  const scene: ShowcaseScene = {
    ...serviceMapScene,
    steps: [
      { afterMs: 100, topology: reread },
      { afterMs: 100, topology: changed },
    ],
  };

  return withFixtureFeeds(scene, ({ topology }) =>
    Effect.gen(function* () {
      const subscription = yield* topology.subscribe;
      const firstPublished = yield* Stream.runHead(subscription.changes).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      yield* advanceTestClock(100);
      assert.deepEqual((yield* topology.latest).readAt, reread.readAt);
      yield* advanceTestClock(100);

      assert.deepEqual(Option.getOrThrow(yield* Fiber.join(firstPublished)).warnings, [
        "content changed",
      ]);
    }),
  );
});

it.effect("login follows the clock and rechecks auth when it succeeds", () =>
  withFixtureFeeds(serviceMapScene, ({ agentAuth, agentLogin }) =>
    Effect.gen(function* () {
      const authSubscription = yield* agentAuth.subscribe;
      const republishedAuth = yield* Stream.runHead(authSubscription.changes).pipe(
        Effect.forkChild,
      );

      const started = yield* agentLogin
        .start("codex", serviceMapScene.lifecycle.threadId)
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
      yield* agentLogin.start("claude-code", serviceMapScene.lifecycle.threadId).pipe(Effect.orDie);
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
        .start("codex", noZeropsScene.lifecycle.threadId)
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
        .start("codex", agentAuthAttentionScene.lifecycle.threadId)
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
        .start("codex", terminalLoginStepScene.lifecycle.threadId)
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
        .start("claude-code", absoluteLoginStepScene.lifecycle.threadId)
        .pipe(Effect.orDie);
      assert.equal(first.terminalId, "scripted-login-claude-code");

      yield* advanceTestClock(300);
      yield* advanceTestClock(2_700);
      assert.equal((yield* agentLogin.latest)["claude-code"], undefined);

      const restarted = yield* agentLogin
        .start("claude-code", absoluteLoginStepScene.lifecycle.threadId)
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

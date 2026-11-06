import {
  EnvironmentId,
  type ServerConfig,
  type ServerConfigStreamEvent,
  type ServerLifecycleWelcomePayload,
  WS_METHODS,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  makeEnvironmentServerConfigState,
  projectServerWelcome,
  resolveServerConfigValue,
} from "./server.ts";
import { applyServerConfigProjection } from "./serverConfigProjection.ts";

const CONFIG = {
  availableEditors: [],
  environment: { capabilities: {} },
  issues: [],
  keybindings: {},
  keybindingsConfigPath: null,
  observability: null,
  providers: [],
  settings: {},
} as unknown as ServerConfig;

const snapshotEvent = (config: ServerConfig): ServerConfigStreamEvent => ({
  version: 1,
  type: "snapshot",
  config,
});

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

function session(client: WsRpcProtocolClient): RpcSession {
  return {
    client,
    initialConfig: Effect.succeed(CONFIG),
    subscribeServerConfig: (input) => client.subscribeServerConfig(input),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

describe("server state projection", () => {
  it("applies every config category to the projected snapshot", () => {
    const snapshot = applyServerConfigProjection(Option.none(), {
      version: 1,
      type: "snapshot",
      config: CONFIG,
    });
    const settings = { ...CONFIG.settings };
    const projected = applyServerConfigProjection(snapshot, {
      version: 1,
      type: "settingsUpdated",
      payload: { settings },
    });

    const result = Option.getOrThrow(projected);
    expect(result.config.settings).toBe(settings);
    expect(result.latestEvent.type).toBe("settingsUpdated");

    const keybindings: ServerConfig["keybindings"] = [];
    const issues: ServerConfig["issues"] = [];
    const withKeybindings = Option.getOrThrow(
      applyServerConfigProjection(projected, {
        version: 1,
        type: "keybindingsUpdated",
        payload: { keybindings, issues },
      }),
    );
    expect(withKeybindings.config.keybindings).toBe(keybindings);
    expect(withKeybindings.config.issues).toBe(issues);
    expect(withKeybindings.latestEvent.type).toBe("keybindingsUpdated");

    const providers = [{ instanceId: "live" }] as unknown as ServerConfig["providers"];
    const withProviders = Option.getOrThrow(
      applyServerConfigProjection(Option.some(withKeybindings), {
        version: 1,
        type: "providerStatuses",
        payload: { providers },
      }),
    );
    expect(withProviders.config.providers).toBe(providers);
    expect(withProviders.latestEvent.type).toBe("providerStatuses");

    const update = { installed: "1", latest: "2", available: true, checkedAt: "now" };
    const withUpdate = Option.getOrThrow(
      applyServerConfigProjection(Option.some(withProviders), {
        version: 1,
        type: "mateUpdate",
        payload: { update },
      }),
    );
    expect(withUpdate.config.environment.update).toBe(update);
    expect(withUpdate.latestEvent.type).toBe("mateUpdate");

    const sources = [{ id: "live" }] as unknown as NonNullable<ServerConfig["usageLimitSources"]>;
    const withSources = Option.getOrThrow(
      applyServerConfigProjection(Option.some(withUpdate), {
        version: 1,
        type: "usageLimitSourcesUpdated",
        payload: { sources },
      }),
    );
    expect(withSources.config.usageLimitSources).toBe(sources);
    expect(withSources.latestEvent.type).toBe("usageLimitSourcesUpdated");
    expect(withSources.config.settings).toBe(settings);
  });

  it("retains welcome when a ready event follows in the same stream chunk", () => {
    const welcome = {
      environment: {} as ServerLifecycleWelcomePayload["environment"],
      cwd: "/repo",
      projectName: "repo",
    } as ServerLifecycleWelcomePayload;
    const [afterWelcome] = projectServerWelcome(Option.none(), {
      type: "welcome",
      payload: welcome,
    });
    const [afterReady, emitted] = projectServerWelcome(afterWelcome, {
      type: "ready",
      payload: {},
    });

    expect(Option.getOrThrow(afterReady)).toBe(welcome);
    expect(emitted).toEqual([]);
  });

  it("prefers an active session config over cache until a live event arrives", () => {
    const config = (source: string, serverVersion: string) =>
      ({
        ...CONFIG,
        environment: { serverVersion },
        settings: { source },
      }) as unknown as ServerConfig;
    const cached = config("cache", "0.0.29");
    const staleLive = config("stale-live", "0.0.29");
    const initial = config("session", "0.0.30");
    const live = config("live", "0.0.30");

    expect(
      resolveServerConfigValue(
        {
          config: cached,
          latestEvent: snapshotEvent(cached),
          source: "cache",
        },
        initial,
      ),
    ).toBe(initial);
    expect(
      resolveServerConfigValue(
        {
          config: staleLive,
          latestEvent: snapshotEvent(staleLive),
          source: "live",
        },
        initial,
      ),
    ).toBe(initial);
    expect(
      resolveServerConfigValue(
        {
          config: live,
          latestEvent: snapshotEvent(live),
          source: "live",
        },
        initial,
      ),
    ).toBe(live);
  });

  it.effect("starts from cached configuration and persists the live projection", () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<ServerConfigStreamEvent>();
      const client = {
        [WS_METHODS.subscribeServerConfig]: () => Stream.fromQueue(events),
      } as unknown as WsRpcProtocolClient;
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.some(session(client))),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
        credentialRotated: Effect.void,
        reportStreamDefect: () => Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const savedConfigs = yield* Queue.unbounded<ServerConfig>();
      const cache = Persistence.EnvironmentCacheStore.of({
        loadShell: () => Effect.succeedNone,
        saveShell: () => Effect.void,
        loadThread: () => Effect.succeedNone,
        saveThread: () => Effect.void,
        removeThread: () => Effect.void,
        loadServerConfig: () => Effect.succeedSome(CONFIG),
        saveServerConfig: (_environmentId, config) => Queue.offer(savedConfigs, config),
        loadVcsRefs: () => Effect.succeedNone,
        saveVcsRefs: () => Effect.void,
        removeVcsRefs: () => Effect.void,
        clearVcsRefs: () => Effect.void,
        clear: () => Effect.void,
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const state = yield* makeEnvironmentServerConfigState({}).pipe(
            Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
            Effect.provideService(Persistence.EnvironmentCacheStore, cache),
          );
          expect(Option.getOrThrow(yield* SubscriptionRef.get(state)).config).toBe(CONFIG);

          const providers = [{ instanceId: "live" }] as unknown as ServerConfig["providers"];
          yield* Queue.offer(events, {
            version: 1,
            type: "providerStatuses",
            payload: { providers },
          });
          const projected = yield* SubscriptionRef.changes(state).pipe(
            Stream.filter((value) =>
              Option.match(value, {
                onNone: () => false,
                onSome: (projection) => projection.latestEvent.type === "providerStatuses",
              }),
            ),
            Stream.runHead,
          );
          expect(Option.getOrThrow(Option.getOrThrow(projected)).config.providers).toBe(providers);
        }),
      );

      expect((yield* Queue.take(savedConfigs)).providers).toEqual([{ instanceId: "live" }]);
    }),
  );

  it.effect("does not rewrite cached configuration when no live update arrives", () =>
    Effect.gen(function* () {
      const client = {
        [WS_METHODS.subscribeServerConfig]: () => Stream.empty,
      } as unknown as WsRpcProtocolClient;
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.some(session(client))),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
        credentialRotated: Effect.void,
        reportStreamDefect: () => Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const savedConfigs = yield* Queue.unbounded<ServerConfig>();
      const cache = Persistence.EnvironmentCacheStore.of({
        loadShell: () => Effect.succeedNone,
        saveShell: () => Effect.void,
        loadThread: () => Effect.succeedNone,
        saveThread: () => Effect.void,
        removeThread: () => Effect.void,
        loadServerConfig: () => Effect.succeedSome(CONFIG),
        saveServerConfig: (_environmentId, config) => Queue.offer(savedConfigs, config),
        loadVcsRefs: () => Effect.succeedNone,
        saveVcsRefs: () => Effect.void,
        removeVcsRefs: () => Effect.void,
        clearVcsRefs: () => Effect.void,
        clear: () => Effect.void,
      });

      yield* Effect.scoped(
        makeEnvironmentServerConfigState({}).pipe(
          Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
          Effect.provideService(Persistence.EnvironmentCacheStore, cache),
        ),
      );

      expect(yield* Queue.poll(savedConfigs)).toEqual(Option.none());
    }),
  );
});

import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerConfig,
  type ServerConfig as ServerConfigType,
  ServerConfigStreamEvent,
  type ServerConfigStreamEvent as ServerConfigStreamEventType,
  WS_METHODS,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import * as Socket from "effect/socket/Socket";

import {
  ConnectionTransientError,
  PrimaryConnectionTarget,
  ZeropsMateConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as ConnectionDriver from "../connection/driver.ts";
import * as ConnectionResolver from "../connection/resolver.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import { connectionBannerCopy, presentConnectionState } from "../connection/presentation.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as Persistence from "../platform/persistence.ts";
import { makeMateImageWire } from "../data/adapters/mateImages.ts";
import * as Connectivity from "../connection/connectivity.ts";
import * as ConnectionWakeups from "../connection/wakeups.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import { ConnectionCredentialStore } from "../connection/credentialStore.ts";
import { ConnectionProfileStore } from "../connection/profileStore.ts";
import { ConnectionAdmissionRef, makeConnectionAdmission } from "../connection/admission.ts";
import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import { RemoteDpopAccessTokenStore } from "../authorization/tokenStore.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { remoteHttpClientLayer } from "./http.ts";
import * as RpcSession from "./session.ts";
import { applyServerConfigProjection } from "../state/serverConfigProjection.ts";

type SocketEventType = "open" | "message" | "close" | "error";
type SocketEvent = {
  readonly code?: number;
  readonly data?: unknown;
  readonly reason?: string;
  readonly type: SocketEventType;
};
type SocketListener = (event: SocketEvent) => void;

class TestWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = TestWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<SocketEventType, Set<SocketListener>>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: SocketEventType, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? new Set<SocketListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: SocketEventType, listener: SocketListener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    if (this.readyState === TestWebSocket.CLOSED) {
      return;
    }
    this.readyState = TestWebSocket.CLOSED;
    this.emit("close", { code, reason, type: "close" });
  }

  open() {
    this.readyState = TestWebSocket.OPEN;
    this.emit("open", { type: "open" });
  }

  serverMessage(data: string) {
    this.emit("message", { data, type: "message" });
  }

  private emit(type: SocketEventType, event: SocketEvent) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: "wss://environment.example.test/ws?wsTicket=test",
  httpAuthorization: null,
  target: TARGET,
};

const SERVER_CONFIG: ServerConfigType = {
  environment: {
    environmentId: TARGET.environmentId,
    label: TARGET.label,
    platform: {
      os: "darwin",
      arch: "arm64",
    },
    serverVersion: "0.0.0-test",
    capabilities: {
      repositoryIdentity: true,
      connectionProbe: true,
    },
  },
  auth: {
    policy: "loopback-browser",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie", "bearer-access-token"],
    sessionCookieName: "t3_session",
  },
  cwd: "/tmp/workspace",
  keybindingsConfigPath: "/tmp/workspace/keybindings.json",
  keybindings: [],
  issues: [],
  providers: [],
  availableEditors: [],
  observability: {
    logsDirectoryPath: "/tmp/logs",
    localTracingEnabled: false,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
    otlpLogsEnabled: false,
  },
  settings: DEFAULT_SERVER_SETTINGS,
};

const RpcRequest = Schema.TaggedStruct("Request", {
  id: Schema.Union([Schema.String, Schema.Number]),
  payload: Schema.Unknown,
  tag: Schema.String,
});
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const isRpcRequest = Schema.is(RpcRequest);
const isPing = Schema.is(Schema.TaggedStruct("Ping", {}));
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeServerConfig = Schema.encodeSync(ServerConfig);
const encodeServerConfigStreamEvent = Schema.encodeSync(ServerConfigStreamEvent);
const encodeDefect = Schema.encodeSync(Schema.Defect());
const ENCODED_SERVER_CONFIG = encodeServerConfig(SERVER_CONFIG);
const SOURCE_SERVER_CONFIG: ServerConfigType = {
  ...SERVER_CONFIG,
  environment: {
    ...SERVER_CONFIG.environment,
    capabilities: { ...SERVER_CONFIG.environment.capabilities, usageLimitSources: true },
  },
};
const SOURCE_EVENT: ServerConfigStreamEventType = {
  version: 1,
  type: "usageLimitSourcesUpdated",
  payload: {
    sources: [
      {
        id: UsageLimitSourceId.make("proxy"),
        kind: "cliproxy",
        label: "Proxy",
        checkedAt: "2026-09-04T00:00:00Z",
        accounts: [],
      },
    ],
  },
};

const publishConfigEvents = Effect.fn("TestRpcSessionFactory.publishConfigEvents")(function* (
  socket: TestWebSocket,
  events: ReadonlyArray<ServerConfigStreamEventType>,
) {
  const request = yield* awaitRequest(socket);
  socket.serverMessage(
    encodeJson({
      _tag: "Chunk",
      requestId: request.id,
      values: events.map((event) => encodeServerConfigStreamEvent(event)),
    }),
  );
});
const LEGACY_SERVER_CONFIG = {
  ...ENCODED_SERVER_CONFIG,
  environment: {
    ...ENCODED_SERVER_CONFIG.environment,
    capabilities: {
      repositoryIdentity: true,
    },
  },
};

const makeFactory = Effect.fn("TestRpcSessionFactory.make")(function* (
  options: RpcSession.RpcSessionOptions = {},
) {
  const sockets: TestWebSocket[] = [];
  const constructorLayer = Layer.succeed(Socket.WebSocketConstructor, (url) => {
    const socket = new TestWebSocket(url);
    sockets.push(socket);
    return socket as unknown as globalThis.WebSocket;
  });
  const layer = RpcSession.layerWithOptions(options).pipe(Layer.provide(constructorLayer));
  const factory = yield* RpcSession.RpcSessionFactory.pipe(Effect.provide(layer));
  return { factory, sockets };
});

const awaitSocket = Effect.fn("TestRpcSessionFactory.awaitSocket")(function* (
  sockets: ReadonlyArray<TestWebSocket>,
  index = 0,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const socket = sockets[index];
    if (socket) {
      return socket;
    }
    yield* Effect.yieldNow;
  }
  return yield* Effect.die(new Error("Expected the RPC protocol to create a websocket."));
});

const awaitRequest = Effect.fn("TestRpcSessionFactory.awaitRequest")(function* (
  socket: TestWebSocket,
  index = 0,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const request = socket.sent.map((message) => decodeJson(message)).filter(isRpcRequest)[index];
    if (request) {
      return request;
    }
    yield* Effect.yieldNow;
  }
  return yield* Effect.die(new Error("Expected the RPC protocol to send a request."));
});

const completeInitialConfig = Effect.fn("TestRpcSessionFactory.completeInitialConfig")(function* (
  socket: TestWebSocket,
  config: unknown = ENCODED_SERVER_CONFIG,
  payload: unknown = {},
) {
  const request = yield* awaitRequest(socket);
  expect(request).toMatchObject({
    _tag: "Request",
    tag: WS_METHODS.subscribeServerConfig,
    payload,
  });
  socket.serverMessage(
    encodeJson({
      _tag: "Chunk",
      requestId: request.id,
      values: [{ version: 1, type: "snapshot", config }],
    }),
  );
});

describe("RpcSessionFactory", () => {
  it.effect.each([
    {
      title:
        "An advancing Mate connection can finish after the former total setup deadline without requesting another ticket.",
      previousFailure: false,
      configurationArrives: true,
    },
    {
      title: "Connection progress does not clear the previous failure before the socket is ready.",
      previousFailure: true,
      configurationArrives: true,
    },
    {
      title:
        "A Mate that stops advancing before initial configuration releases its socket when setup patience expires.",
      previousFailure: false,
      configurationArrives: false,
    },
  ])("$title", ({ previousFailure, configurationArrives }) =>
    Effect.gen(function* () {
      const { factory, sockets } = yield* makeFactory();
      const target = new ZeropsMateConnectionTarget({
        environmentId: TARGET.environmentId,
        label: "Ada",
        orgId: "org-1",
        projectId: "project-ada",
        httpBaseUrl: "https://environment.example.test/mate",
      });
      const failure = new ConnectionTransientError({
        reason: "transport",
        detail: "Previous connection lost.",
      });
      let preparations = 0;
      const tickets: string[] = [];
      const driver = ConnectionDriver.layer.pipe(
        Layer.provide(
          Layer.succeed(ConnectionResolver.ConnectionResolver, {
            prepare: () =>
              Effect.suspend(() => {
                preparations++;
                if (previousFailure && preparations === 1) return Effect.fail(failure);
                const ticket = `ticket-${tickets.length + 1}`;
                tickets.push(ticket);
                return Effect.succeed({
                  ...PREPARED,
                  target,
                  firstFrame: JSON.stringify({ ticket }),
                });
              }),
          }),
        ),
        Layer.provide(Layer.succeed(RpcSession.RpcSessionFactory, factory)),
      );
      const admission = makeConnectionAdmission({ setTimer: () => () => undefined });
      admission.prefer(target.environmentId);
      const supervisor = yield* EnvironmentSupervisor.make(
        { target, profile: Option.none() },
        { initiallyDesired: true },
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            driver,
            Connectivity.layer({ status: Effect.succeed("online"), changes: Stream.never }),
            ConnectionWakeups.layer({ changes: Stream.never }),
          ),
        ),
        Effect.provideService(ConnectionAdmissionRef, admission),
      );
      const atState = (predicate: (state: SupervisorConnectionState) => boolean) =>
        SubscriptionRef.changes(supervisor.state).pipe(Stream.filter(predicate), Stream.runHead);
      if (previousFailure) {
        yield* atState((state) => state.phase === "backoff");
        yield* TestClock.adjust("2 seconds");
      }
      const socket = yield* awaitSocket(sockets);
      const expectedFailure = previousFailure ? failure : null;
      expect((yield* SubscriptionRef.get(supervisor.state)).lastFailure).toEqual(expectedFailure);
      yield* TestClock.adjust("10 seconds");
      socket.open();
      yield* atState((state) => state.stage === "synchronizing");
      yield* TestClock.adjust("6 seconds");
      const progressing = yield* SubscriptionRef.get(supervisor.state);
      expect(progressing.phase).toBe("connecting");
      expect(progressing.stage).toBe("synchronizing");
      expect(progressing.lastFailure).toEqual(expectedFailure);
      expect(presentConnectionState(progressing).error).toBe(
        previousFailure ? failure.message : null,
      );
      expect(socket.readyState).toBe(TestWebSocket.OPEN);
      expect(tickets).toEqual(["ticket-1"]);
      yield* TestClock.adjust("4 seconds");
      if (!configurationArrives) {
        yield* TestClock.adjust("5 seconds");
        yield* atState((state) => state.phase === "backoff");
        expect(socket.readyState).toBe(TestWebSocket.CLOSED);
        expect(tickets).toEqual(["ticket-1"]);
        expect(Option.isNone(yield* SubscriptionRef.get(supervisor.session))).toBe(true);
        return;
      }
      yield* completeInitialConfig(socket);
      yield* atState((state) => state.phase === "connected");
      const connected = yield* SubscriptionRef.get(supervisor.state);
      expect(connected.lastFailure).toBeNull();
      expect(connectionBannerCopy(presentConnectionState(connected), "Ada")).toBeNull();
      const session = Option.getOrThrow(yield* SubscriptionRef.get(supervisor.session));
      expect(yield* session.initialConfig).toEqual(SERVER_CONFIG);
      expect(tickets).toEqual(["ticket-1"]);
      expect(sockets).toHaveLength(1);
      expect(socket.sent[0]).toBe(JSON.stringify({ ticket: "ticket-1" }));
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect(
    "A Mate ticket is available to HTTP readers only after RPC readiness and is discarded on disconnect",
    () =>
      Effect.gen(function* () {
        const { factory, sockets } = yield* makeFactory();
        const issued: string[] = [];
        const target = new ZeropsMateConnectionTarget({
          environmentId: TARGET.environmentId,
          label: TARGET.label,
          orgId: "org-1",
          projectId: "project-1",
          httpBaseUrl: "https://environment.example.test/mate",
        });
        const unsupported = Effect.die("Ticket connections must not use legacy credentials.");
        const platform = Layer.mergeAll(
          Layer.succeed(ClientCapabilities.ClientPresentation, {
            metadata: { label: "Test Client", deviceType: "desktop", surface: "web" },
            scopes: [],
          }),
          Layer.succeed(ClientCapabilities.PrimaryEnvironmentAuth, { bearerToken: unsupported }),
          Layer.succeed(ClientCapabilities.SshEnvironmentGateway, {
            provision: () => unsupported,
            prepare: () => unsupported,
            disconnect: () => unsupported,
          }),
          Layer.succeed(ConnectionCredentialStore, {
            get: () => unsupported,
            put: () => unsupported,
            remove: () => unsupported,
          }),
          Layer.succeed(ConnectionProfileStore, {
            get: () => unsupported,
            put: () => unsupported,
            remove: () => unsupported,
          }),
          Layer.succeed(RemoteDpopAccessTokenStore, {
            get: () => unsupported,
            put: () => unsupported,
            remove: () => unsupported,
          }),
          Layer.succeed(ManagedRelayDpopSigner, {
            thumbprint: unsupported,
            createProof: () => unsupported,
          }),
          remoteHttpClientLayer(() => Promise.reject(new Error("Unexpected legacy HTTP request"))),
          Layer.succeed(ClientCapabilities.MateTicketIssuer, {
            issue: () =>
              Effect.sync(() => {
                const ticket = `ticket-${issued.length + 1}`;
                issued.push(ticket);
                return { ticket, origin: "https://environment.example.test" };
              }),
          }),
        );
        const resolver = ConnectionResolver.layer.pipe(
          Layer.provide(RemoteEnvironmentAuthorization.layer),
          Layer.provide(platform),
        );
        const driver = ConnectionDriver.layer.pipe(
          Layer.provide(resolver),
          Layer.provide(Layer.succeed(RpcSession.RpcSessionFactory, factory)),
        );
        const admission = makeConnectionAdmission({ setTimer: () => () => undefined });
        admission.prefer(target.environmentId);
        const registry = yield* EnvironmentRegistry.make.pipe(
          Effect.provide(
            Layer.mergeAll(
              driver,
              platform,
              Layer.succeed(Persistence.ConnectionTargetStore, { list: Effect.succeed([target]) }),
              Layer.succeed(Persistence.ConnectionRegistrationStore, {
                register: () => Effect.void,
                remove: () => Effect.void,
              }),
              Layer.succeed(Persistence.EnvironmentCacheStore, {
                loadShell: () => Effect.succeedNone,
                saveShell: () => Effect.void,
                loadThread: () => Effect.succeedNone,
                saveThread: () => Effect.void,
                removeThread: () => Effect.void,
                loadServerConfig: () => Effect.succeedNone,
                saveServerConfig: () => Effect.void,
                loadVcsRefs: () => Effect.succeedNone,
                saveVcsRefs: () => Effect.void,
                removeVcsRefs: () => Effect.void,
                clearVcsRefs: () => Effect.void,
                clear: () => Effect.void,
              }),
              Connectivity.layer({ status: Effect.succeed("online"), changes: Stream.never }),
              ConnectionWakeups.layer({ changes: Stream.never }),
            ),
          ),
          Effect.provideService(ConnectionAdmissionRef, admission),
        );
        const supervisor = yield* registry.run(
          target.environmentId,
          EnvironmentSupervisor.EnvironmentSupervisor,
        );
        const atState = (predicate: (state: SupervisorConnectionState) => boolean) =>
          SubscriptionRef.changes(supervisor.state).pipe(Stream.filter(predicate), Stream.runHead);
        yield* supervisor.connect;
        const socket = yield* awaitSocket(sockets);
        const openingPrepared = yield* SubscriptionRef.get(supervisor.prepared);
        socket.open();
        yield* awaitRequest(socket);
        yield* atState((state) => state.phase === "connecting" && state.stage === "synchronizing");
        expect(openingPrepared).toEqual(Option.none());
        expect(socket.sent[0]).toBe('{"ticket":"ticket-1"}');
        expect(yield* SubscriptionRef.get(supervisor.prepared)).toEqual(Option.none());
        yield* completeInitialConfig(socket, {
          ...ENCODED_SERVER_CONFIG,
          environment: {
            ...ENCODED_SERVER_CONFIG.environment,
            capabilities: {
              ...ENCODED_SERVER_CONFIG.environment.capabilities,
              contentAddressedImages: true,
              mateEngine: { protocol: 1 },
            },
          },
        });
        yield* atState((state) => state.phase === "connected");
        expect(Option.getOrThrow(yield* SubscriptionRef.get(supervisor.prepared))).toMatchObject({
          httpAuthorization: { _tag: "Bearer", token: "ticket-1" },
          contentAddressedImages: true,
          mateEngine: 1,
        });
        socket.close(1012, "restart");
        yield* atState((state) => state.phase !== "connected");
        expect(yield* SubscriptionRef.get(supervisor.prepared)).toEqual(Option.none());
        yield* supervisor.retryNow;
        const next = yield* awaitSocket(sockets, 1);
        next.open();
        yield* awaitRequest(next);
        yield* atState((state) => state.phase === "connecting" && state.stage === "synchronizing");
        expect(yield* SubscriptionRef.get(supervisor.prepared)).toEqual(Option.none());
        yield* completeInitialConfig(next);
        yield* atState((state) => state.phase === "connected");
        expect(next.sent[0]).toBe('{"ticket":"ticket-2"}');
        expect(
          Option.getOrThrow(yield* SubscriptionRef.get(supervisor.prepared)).httpAuthorization,
        ).toEqual({ _tag: "Bearer", token: "ticket-2" });
        expect(issued).toEqual(["ticket-1", "ticket-2"]);
        const imageRequests: Request[] = [];
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
          imageRequests.push(new Request(url, init));
          return Promise.resolve(new Response(new Blob(["image"], { type: "image/png" })));
        });
        yield* Effect.addFinalizer(() => Effect.sync(() => fetchSpy.mockRestore()));
        const imageRead = yield* Effect.forkChild(
          makeMateImageWire(registry, Option.none()).read({
            environmentId: target.environmentId,
            resource: { _tag: "attachment", attachmentId: "image", mimeType: "image/png" },
            rendition: "original",
          }),
        );
        const imageRequest = yield* awaitRequest(next, 1);
        expect(imageRequest.tag).toBe(WS_METHODS.assetsCreateUrl);
        next.serverMessage(
          encodeJson({
            _tag: "Exit",
            requestId: imageRequest.id,
            exit: {
              _tag: "Success",
              value: { relativeUrl: "/api/assets/images/test", expiresAt: 0 },
            },
          }),
        );
        yield* Fiber.join(imageRead);
        expect(imageRequests).toHaveLength(1);
        expect(imageRequests[0]?.url).toBe(
          "https://environment.example.test/mate/api/assets/images/test",
        );
        expect(imageRequests[0]?.headers.get("authorization")).toBe("Bearer ticket-2");
        expect(imageRequests[0]?.headers.get("dpop")).toBeNull();
        expect(imageRequests[0]?.credentials).toBe("omit");
      }),
  );

  it.effect("A Mate connection's first frame is the ticket, sent before any request", () =>
    Effect.gen(function* () {
      const { factory, sockets } = yield* makeFactory();
      const session = yield* factory.connect({
        ...PREPARED,
        socketUrl: "wss://environment.example.test",
        firstFrame: JSON.stringify({ ticket: "T-1" }),
      });
      const readyFiber = yield* Effect.forkChild(session.ready);
      const socket = yield* awaitSocket(sockets);

      socket.open();
      yield* completeInitialConfig(socket);
      yield* Fiber.join(readyFiber);

      expect(socket.url).toBe("wss://environment.example.test");
      expect(socket.sent[0]).toBe(JSON.stringify({ ticket: "T-1" }));
      expect(
        socket.sent
          .slice(1)
          .map((message) => decodeJson(message))
          .filter(isRpcRequest),
      ).toHaveLength(1);
    }),
  );

  it.effect("owns one scoped websocket attempt and exposes readiness and closure", () =>
    Effect.gen(function* () {
      const { factory, sockets } = yield* makeFactory();
      const session = yield* factory.connect(PREPARED);
      const readyFiber = yield* Effect.forkChild(session.ready);
      const socket = yield* awaitSocket(sockets);

      expect(socket.url).toBe(PREPARED.socketUrl);
      socket.open();
      yield* completeInitialConfig(socket);
      yield* Fiber.join(readyFiber);

      const config = yield* session.initialConfig;
      expect(config).toEqual(SERVER_CONFIG);
      expect(socket.sent.map((message) => decodeJson(message)).filter(isRpcRequest)).toHaveLength(
        1,
      );

      const probeFiber = yield* Effect.forkChild(session.probe);
      const probeRequest = yield* awaitRequest(socket, 1);
      expect(probeRequest).toMatchObject({
        _tag: "Request",
        tag: WS_METHODS.serverProbe,
        payload: {},
      });
      socket.serverMessage(
        encodeJson({
          _tag: "Exit",
          requestId: probeRequest.id,
          exit: {
            _tag: "Success",
            value: {},
          },
        }),
      );
      yield* Fiber.join(probeFiber);

      expect(
        socket.sent
          .map((message) => decodeJson(message))
          .filter(isRpcRequest)
          .map((request) => request.tag),
      ).toEqual([WS_METHODS.subscribeServerConfig, WS_METHODS.serverProbe]);

      socket.close(1012, "service restart");
      const error = yield* Effect.flip(session.closed);
      const configStreamError = yield* session
        .subscribeServerConfig({})
        .pipe(Stream.runDrain, Effect.flip);

      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error).toMatchObject({
        reason: "transport",
        message: "Test environment disconnected.",
      });
      expect(configStreamError).toMatchObject({ _tag: "RpcClientError" });
      yield* Effect.yieldNow;
      expect(sockets).toHaveLength(1);
    }),
  );

  it.effect("closes the websocket when the session scope is released", () =>
    Effect.gen(function* () {
      const { factory, sockets } = yield* makeFactory();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const session = yield* factory.connect(PREPARED);
          const readyFiber = yield* Effect.forkChild(session.ready);
          const socket = yield* awaitSocket(sockets);
          socket.open();
          yield* completeInitialConfig(socket);
          yield* Fiber.join(readyFiber);
        }),
      );

      expect(sockets[0]?.readyState).toBe(TestWebSocket.CLOSED);
    }),
  );

  it.effect("replays current config and broadcasts updates to every subscriber", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { factory, sockets } = yield* makeFactory();
        const session = yield* factory.connect(PREPARED);
        const readyFiber = yield* Effect.forkChild(session.ready);
        const socket = yield* awaitSocket(sockets);
        socket.open();
        yield* completeInitialConfig(socket);
        yield* Fiber.join(readyFiber);

        const collectTwo = session
          .subscribeServerConfig({})
          .pipe(Stream.take(2), Stream.runCollect);
        const firstSubscriber = yield* Effect.forkChild(collectTwo);
        const secondSubscriber = yield* Effect.forkChild(collectTwo);
        yield* Effect.yieldNow;

        const shortcut = {
          key: "k",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        };
        const request = yield* awaitRequest(socket);
        socket.serverMessage(
          encodeJson({
            _tag: "Chunk",
            requestId: request.id,
            values: [
              {
                version: 1,
                type: "keybindingsUpdated",
                payload: {
                  keybindings: [{ command: "terminal.toggle", shortcut }],
                  issues: [],
                },
              },
            ],
          }),
        );

        const firstEvents = Array.from(yield* Fiber.join(firstSubscriber));
        const secondEvents = Array.from(yield* Fiber.join(secondSubscriber));
        expect(firstEvents.map((event) => event.type)).toEqual(["snapshot", "keybindingsUpdated"]);
        expect(secondEvents).toEqual(firstEvents);

        const replay = yield* session.subscribeServerConfig({}).pipe(Stream.runHead);
        expect(replay).toMatchObject({
          _tag: "Some",
          value: {
            type: "snapshot",
            config: { keybindings: [{ command: "terminal.toggle", shortcut }] },
          },
        });
      }),
    ),
  );

  it.effect.each(
    Array.from([{ usageLimitSources: true }], (options) => ({
      title: `shares only a config subscription with the same opt-ins: ${JSON.stringify(options)}`,
      options,
    })),
  )("$title", ({ options }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { factory, sockets } = yield* makeFactory(options);
        const session = yield* factory.connect(PREPARED);
        const readyFiber = yield* Effect.forkChild(session.ready);
        const socket = yield* awaitSocket(sockets);
        socket.open();
        yield* completeInitialConfig(socket, ENCODED_SERVER_CONFIG, options);
        yield* Fiber.join(readyFiber);

        const shared = yield* session.subscribeServerConfig(options).pipe(Stream.runHead);
        expect(shared).toMatchObject({ _tag: "Some", value: { type: "snapshot" } });
        expect(socket.sent.map((message) => decodeJson(message)).filter(isRpcRequest)).toHaveLength(
          1,
        );

        const fallbackFiber = yield* session
          .subscribeServerConfig({})
          .pipe(Stream.runHead, Effect.forkChild);
        const fallbackRequest = yield* awaitRequest(socket, 1);
        expect(fallbackRequest).toMatchObject({
          tag: WS_METHODS.subscribeServerConfig,
          payload: {},
        });
        socket.serverMessage(
          encodeJson({
            _tag: "Chunk",
            requestId: fallbackRequest.id,
            values: [
              {
                version: 1,
                type: "snapshot",
                config: ENCODED_SERVER_CONFIG,
              },
            ],
          }),
        );
        expect(yield* Fiber.join(fallbackFiber)).toMatchObject({
          _tag: "Some",
          value: { type: "snapshot" },
        });
      }),
    ),
  );

  it.effect.each([{ usageLimitSources: true }])(
    "replays usage sources, removal, and capability downgrade with %j",
    (options) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { factory, sockets } = yield* makeFactory(options);
          const session = yield* factory.connect(PREPARED);
          const ready = yield* Effect.forkChild(session.ready);
          const socket = yield* awaitSocket(sockets);
          socket.open();
          yield* completeInitialConfig(socket, encodeServerConfig(SOURCE_SERVER_CONFIG), options);
          yield* Fiber.join(ready);
          const observed = yield* Queue.unbounded<ServerConfigStreamEventType>();
          yield* session.subscribeServerConfig(options).pipe(
            Stream.runForEach((event) => Queue.offer(observed, event)),
            Effect.forkChild,
          );
          expect((yield* Queue.take(observed)).type).toBe("snapshot");
          const events: ServerConfigStreamEventType[] = [
            SOURCE_EVENT,
            { version: 1, type: "usageLimitSourcesUpdated", payload: { sources: [] } },
            SOURCE_EVENT,
            { version: 1, type: "snapshot", config: SERVER_CONFIG },
          ];
          for (const event of events) {
            yield* publishConfigEvents(socket, [event]);
            expect(yield* Queue.take(observed)).toEqual(event);
            const started = yield* Deferred.make<void>();
            const replay = yield* session.subscribeServerConfig(options).pipe(
              Stream.tap(() => Deferred.succeed(started, undefined)),
              Stream.takeUntil((item) => item.type === "keybindingsUpdated"),
              Stream.runCollect,
              Effect.forkChild,
            );
            yield* Deferred.await(started);
            // A live end marker makes a missing or stale replay event fail without a timeout.
            const marker: ServerConfigStreamEventType = {
              version: 1,
              type: "keybindingsUpdated",
              payload: { keybindings: [], issues: [] },
            };
            yield* publishConfigEvents(socket, [marker]);
            expect(yield* Queue.take(observed)).toEqual(marker);
            const replayed = Array.from(yield* Fiber.join(replay));
            expect(replayed.slice(1)).toEqual([
              ...(event.type === "snapshot" ? [] : [event]),
              marker,
            ]);
            let projection = applyServerConfigProjection(Option.none(), {
              version: 1,
              type: "snapshot",
              config: SOURCE_SERVER_CONFIG,
            });
            projection = applyServerConfigProjection(projection, SOURCE_EVENT);
            for (const item of replayed) projection = applyServerConfigProjection(projection, item);
            expect(Option.getOrThrow(projection).config.usageLimitSources).toEqual(
              event.type === "usageLimitSourcesUpdated" && event.payload.sources.length > 0
                ? event.payload.sources
                : undefined,
            );
          }
          expect(
            socket.sent.map((message) => decodeJson(message)).filter(isRpcRequest),
          ).toHaveLength(1);
        }),
      ),
  );

  it.effect("closes the session when the config source dies", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { factory, sockets } = yield* makeFactory();
        const session = yield* factory.connect(PREPARED);
        const readyFiber = yield* Effect.forkChild(session.ready);
        const socket = yield* awaitSocket(sockets);
        socket.open();
        yield* completeInitialConfig(socket);
        yield* Fiber.join(readyFiber);

        const closedFiber = yield* session.closed.pipe(Effect.exit, Effect.forkChild);
        socket.serverMessage(
          encodeJson({
            _tag: "Defect",
            defect: encodeDefect(new Error("config stream died")),
          }),
        );

        const closed = yield* Fiber.join(closedFiber);
        expect(Exit.isFailure(closed)).toBe(true);
        if (Exit.isFailure(closed)) {
          expect(Cause.hasDies(closed.cause)).toBe(true);
        }
      }),
    ),
  );

  it.effect.each<{
    readonly event: ServerConfigStreamEventType;
    readonly expectedConfig: Partial<ServerConfigType>;
  }>([
    {
      event: {
        version: 1,
        type: "providerStatuses",
        payload: {
          providers: [
            {
              instanceId: ProviderInstanceId.make("codex"),
              driver: ProviderDriverKind.make("codex"),
              enabled: true,
              installed: true,
              version: "1.0.0",
              status: "ready",
              auth: { status: "authenticated" },
              checkedAt: "2026-08-27T00:00:00.000Z",
              models: [],
              slashCommands: [],
              skills: [],
            },
          ],
        },
      },
      expectedConfig: {
        providers: [
          {
            instanceId: ProviderInstanceId.make("codex"),
            driver: ProviderDriverKind.make("codex"),
            enabled: true,
            installed: true,
            version: "1.0.0",
            status: "ready",
            auth: { status: "authenticated" },
            checkedAt: "2026-08-27T00:00:00.000Z",
            models: [],
            slashCommands: [],
            skills: [],
          },
        ],
      },
    },
    {
      event: {
        version: 1,
        type: "settingsUpdated",
        payload: {
          settings: {
            ...DEFAULT_SERVER_SETTINGS,
            newWorktreesStartFromOrigin: !DEFAULT_SERVER_SETTINGS.newWorktreesStartFromOrigin,
          },
        },
      },
      expectedConfig: {
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          newWorktreesStartFromOrigin: !DEFAULT_SERVER_SETTINGS.newWorktreesStartFromOrigin,
        },
      },
    },
  ])(
    "preserves $event.type events and includes them in replay snapshots",
    ({ event, expectedConfig }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { factory, sockets } = yield* makeFactory();
          const session = yield* factory.connect(PREPARED);
          const readyFiber = yield* Effect.forkChild(session.ready);
          const socket = yield* awaitSocket(sockets);
          socket.open();
          yield* completeInitialConfig(socket);
          yield* Fiber.join(readyFiber);

          const subscriber = yield* session
            .subscribeServerConfig({})
            .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
          yield* Effect.yieldNow;

          const request = yield* awaitRequest(socket);
          socket.serverMessage(
            encodeJson({
              _tag: "Chunk",
              requestId: request.id,
              values: [encodeServerConfigStreamEvent(event)],
            }),
          );

          const events = Array.from(yield* Fiber.join(subscriber));
          expect(events[1]).toEqual(event);

          const replay = yield* session.subscribeServerConfig({}).pipe(Stream.runHead);
          expect(replay).toMatchObject({
            _tag: "Some",
            value: {
              type: "snapshot",
              config: expectedConfig,
            },
          });
        }),
      ),
  );

  it.effect("tolerates two missed pong windows before closing the session", () =>
    Effect.gen(function* () {
      const { factory, sockets } = yield* makeFactory();
      const session = yield* factory.connect(PREPARED);
      const readyFiber = yield* Effect.forkChild(session.ready);
      const closedFiber = yield* Effect.forkChild(Effect.flip(session.closed));
      const socket = yield* awaitSocket(sockets);

      socket.open();
      yield* completeInitialConfig(socket);
      yield* Fiber.join(readyFiber);

      yield* TestClock.adjust("15 seconds");
      expect(closedFiber.pollUnsafe()).toBeUndefined();
      expect(socket.sent.map((message) => decodeJson(message)).filter(isPing)).toEqual([
        { _tag: "Ping" },
        { _tag: "Ping" },
        { _tag: "Ping" },
      ]);

      yield* TestClock.adjust("5 seconds");
      const error = yield* Fiber.join(closedFiber);
      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error).toMatchObject({
        reason: "transport",
        detail: "Test environment stopped responding.",
      });
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  describe("a page whose own throttling may hold pongs back", () => {
    const connectWithVisibility = Effect.fn("TestRpcSessionFactory.connectWithVisibility")(
      function* () {
        const page = { hidden: false };
        const { factory, sockets } = yield* makeFactory({
          pingTimeoutPaused: () => page.hidden,
        });
        const session = yield* factory.connect(PREPARED);
        const readyFiber = yield* Effect.forkChild(session.ready);
        const closedFiber = yield* Effect.forkChild(Effect.flip(session.closed));
        const socket = yield* awaitSocket(sockets);
        socket.open();
        yield* completeInitialConfig(socket);
        yield* Fiber.join(readyFiber);
        const pings = () => socket.sent.map((message) => decodeJson(message)).filter(isPing).length;
        return { page, socket, closedFiber, pings };
      },
    );

    it.effect("a hidden tab whose pongs are processed late keeps its socket", () =>
      Effect.gen(function* () {
        const { page, socket, closedFiber } = yield* connectWithVisibility();

        page.hidden = true;
        yield* TestClock.adjust("10 minutes");
        expect(closedFiber.pollUnsafe()).toBeUndefined();

        // The late pong is processed when the person comes back.
        page.hidden = false;
        socket.serverMessage(encodeJson({ _tag: "Pong" }));
        yield* TestClock.adjust("15 seconds");
        expect(closedFiber.pollUnsafe()).toBeUndefined();
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    );

    it.effect("a socket that stops answering is still closed within 20 s while visible", () =>
      Effect.gen(function* () {
        const { closedFiber } = yield* connectWithVisibility();

        yield* TestClock.adjust("15 seconds");
        expect(closedFiber.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust("5 seconds");
        const error = yield* Fiber.join(closedFiber);
        expect(error).toMatchObject({ detail: "Test environment stopped responding." });
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    );

    it.effect("returning to a hidden tab checks the socket within 20 s", () =>
      Effect.gen(function* () {
        const { page, closedFiber, pings } = yield* connectWithVisibility();

        page.hidden = true;
        yield* TestClock.adjust("10 minutes");
        const pingsWhileHidden = pings();

        page.hidden = false;
        yield* TestClock.adjust("5 seconds");
        expect(pings()).toBe(pingsWhileHidden + 1);
        yield* TestClock.adjust("10 seconds");
        expect(closedFiber.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust("5 seconds");
        const error = yield* Fiber.join(closedFiber);
        expect(error).toMatchObject({ detail: "Test environment stopped responding." });
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    );
  });

  it.effect("keeps reading replies after closing a stream with a full buffer", () =>
    Effect.gen(function* () {
      const { factory, sockets } = yield* makeFactory();
      const session = yield* factory.connect(PREPARED);
      const readyFiber = yield* Effect.forkChild(session.ready);
      const socket = yield* awaitSocket(sockets);
      socket.open();
      yield* completeInitialConfig(socket);
      yield* Fiber.join(readyFiber);

      // The consumer takes one event and stops pulling, so the stream buffer fills.
      const consuming = yield* Deferred.make<void>();
      const streamFiber = yield* session.client[WS_METHODS.subscribeServerConfig]({}).pipe(
        Stream.runForEach(() =>
          Deferred.succeed(consuming, undefined).pipe(Effect.andThen(Effect.never)),
        ),
        Effect.forkChild,
      );
      const streamRequest = yield* awaitRequest(socket, 1);
      const snapshot = { version: 1, type: "snapshot", config: ENCODED_SERVER_CONFIG };
      socket.serverMessage(
        encodeJson({
          _tag: "Chunk",
          requestId: streamRequest.id,
          values: Array.from({ length: 64 }, () => snapshot),
        }),
      );
      yield* Deferred.await(consuming);
      yield* Fiber.interrupt(streamFiber);

      const probeFiber = yield* Effect.forkChild(session.probe);
      const probeRequest = yield* awaitRequest(socket, 2);
      expect(probeRequest).toMatchObject({ tag: WS_METHODS.serverProbe });
      socket.serverMessage(
        encodeJson({
          _tag: "Exit",
          requestId: probeRequest.id,
          exit: { _tag: "Success", value: {} },
        }),
      );
      yield* Fiber.join(probeFiber);
    }).pipe(Effect.scoped),
  );

  it.effect("reaches ready when a newer server sends unknown config members", () =>
    Effect.gen(function* () {
      const { factory, sockets } = yield* makeFactory();
      const session = yield* factory.connect(PREPARED);
      const readyFiber = yield* Effect.forkChild(session.ready);
      const socket = yield* awaitSocket(sockets);
      socket.open();

      const shortcut = {
        key: "p",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      };
      yield* completeInitialConfig(socket, {
        ...ENCODED_SERVER_CONFIG,
        keybindings: [
          { command: "someFuture.toggle", shortcut },
          { command: "terminal.toggle", shortcut },
        ],
        issues: [{ kind: "keybindings.future-issue", message: "From a newer server" }],
        availableEditors: ["some-future-editor", "zed"],
      });
      yield* Fiber.join(readyFiber);

      const config = yield* session.initialConfig;
      expect(config.keybindings).toEqual([{ command: "terminal.toggle", shortcut }]);
      expect(config.issues).toEqual([]);
      expect(config.availableEditors).toEqual(["zed"]);
    }),
  );

  it.effect("uses the legacy config RPC for probes when the server lacks the capability", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { factory, sockets } = yield* makeFactory();
        const session = yield* factory.connect(PREPARED);
        const readyFiber = yield* Effect.forkChild(session.ready);
        const socket = yield* awaitSocket(sockets);

        socket.open();
        yield* completeInitialConfig(socket, LEGACY_SERVER_CONFIG);
        yield* Fiber.join(readyFiber);

        const probeFiber = yield* Effect.forkChild(session.probe);
        const probeRequest = yield* awaitRequest(socket, 1);
        expect(probeRequest).toMatchObject({
          _tag: "Request",
          tag: WS_METHODS.serverGetConfig,
          payload: {},
        });
        socket.serverMessage(
          encodeJson({
            _tag: "Exit",
            requestId: probeRequest.id,
            exit: {
              _tag: "Success",
              value: LEGACY_SERVER_CONFIG,
            },
          }),
        );
        yield* Fiber.join(probeFiber);

        expect(
          socket.sent
            .map((message) => decodeJson(message))
            .filter(isRpcRequest)
            .map((request) => request.tag),
        ).toEqual([WS_METHODS.subscribeServerConfig, WS_METHODS.serverGetConfig]);
      }),
    ),
  );

  it.effect("fails readiness when the websocket never opens", () =>
    Effect.gen(function* () {
      const { factory, sockets } = yield* makeFactory();

      const error = yield* Effect.scoped(
        Effect.gen(function* () {
          const session = yield* factory.connect(PREPARED);
          const readyFiber = yield* Effect.forkChild(Effect.flip(session.ready));
          yield* awaitSocket(sockets);

          yield* TestClock.adjust("15 seconds");
          return yield* Fiber.join(readyFiber);
        }),
      );

      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error).toMatchObject({
        reason: "transport",
        message: "Test environment could not establish a WebSocket connection.",
      });
      expect(sockets[0]?.readyState).toBe(TestWebSocket.CLOSED);
    }).pipe(Effect.provide(TestClock.layer())),
  );
});

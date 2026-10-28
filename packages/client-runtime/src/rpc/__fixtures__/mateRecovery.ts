import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ServerConfig,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Socket from "effect/socket/Socket";
import * as ClientCapabilities from "../../platform/capabilities.ts";
import * as ConnectionResolver from "../../connection/resolver.ts";
import * as ConnectionDriver from "../../connection/driver.ts";
import * as EnvironmentSupervisor from "../../connection/supervisor.ts";
import * as Connectivity from "../../connection/connectivity.ts";
import * as ConnectionWakeups from "../../connection/wakeups.ts";
import { ConnectionCredentialStore } from "../../connection/credentialStore.ts";
import { ConnectionProfileStore } from "../../connection/profileStore.ts";
import { ConnectionAdmissionRef, passThroughAdmission } from "../../connection/admission.ts";
import { ZeropsMateConnectionTarget } from "../../connection/model.ts";
import * as RemoteEnvironmentAuthorization from "../../authorization/service.ts";
import { RemoteDpopAccessTokenStore } from "../../authorization/tokenStore.ts";
import { ManagedRelayDpopSigner } from "../../relay/managedRelay.ts";
import { remoteHttpClientLayer } from "../http.ts";
import * as RpcSession from "../session.ts";
import { mateTicketIssuer } from "../../data/adapters/hqMateTicket.ts";
import { makeHqApi } from "../../zerops/hq/client.ts";
type SocketEventType = "open" | "message" | "close" | "error";
type SocketEvent = {
  readonly code?: number;
  readonly data?: unknown;
  readonly reason?: string;
  readonly type: SocketEventType;
};
type SocketListener = (event: SocketEvent) => void;

export class TestWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = TestWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<SocketEventType, Set<SocketListener>>();

  readonly messages: Queue.Queue<string>;

  constructor(url: string, messages: Queue.Queue<string>) {
    this.url = url;
    this.messages = messages;
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
    Queue.offerUnsafe(this.messages, data);
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

const SERVER_CONFIG: ServerConfig = {
  environment: {
    environmentId: EnvironmentId.make("environment-1"),
    label: "Test Mate",
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

const decodeMessage = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const encodeHttpBody = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeMessage = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const encodeConfig = Schema.encodeEffect(ServerConfig);
const isRequest = Schema.is(
  Schema.TaggedStruct("Request", {
    id: Schema.Union([Schema.String, Schema.Number]),
    tag: Schema.String,
  }),
);

/** Actual ticket resolver, driver, socket protocol and readiness; only the remote endpoints are scripted. */
export const makeMateRecoveryHarness = Effect.fn("test.makeMateRecoveryHarness")(function* () {
  let attempts = 0;
  let hidden = false;
  const wakeups = yield* Queue.unbounded<ConnectionWakeups.ConnectionWakeup>();
  const sockets = yield* Queue.unbounded<TestWebSocket>();
  const factory = yield* RpcSession.RpcSessionFactory.pipe(
    Effect.provide(
      RpcSession.layerWithOptions({}).pipe(
        Layer.provide(
          Layer.succeed(Socket.WebSocketConstructor, (url) => {
            const socket = new TestWebSocket(url, Queue.unbounded<string>().pipe(Effect.runSync));
            Queue.offerUnsafe(sockets, socket);
            return socket as unknown as globalThis.WebSocket;
          }),
        ),
      ),
    ),
  );
  const target = new ZeropsMateConnectionTarget({
    environmentId: EnvironmentId.make("environment-1"),
    label: "Test Mate",
    orgId: "org-1",
    projectId: "project-1",
    httpBaseUrl: "https://environment.example.test/mate",
  });
  const hq = makeHqApi({
    address: "https://hq.example.test",
    orgId: target.orgId,
    accessToken: async () => "test-access",
    now: () => 0,
    openSocket: () => {
      throw new Error("This proof uses only the HQ ticket HTTP path.");
    },
    fetch: async (url) => {
      if (url.endsWith("/api/door"))
        return new Response(
          encodeHttpBody({
            session: "test-session",
            expiresAt: "2099-01-01T00:00:00Z",
            userId: "test-user",
          }),
          { status: 200 },
        );
      if (!url.endsWith(`/api/mates/${target.projectId}/ticket`))
        throw new Error("Unexpected HQ request.");
      attempts += 1;
      return new Response(
        encodeHttpBody(
          attempts === 1
            ? { code: "mate_not_connected", reason: "no-link" }
            : {
                ticket: `ticket-${attempts}`,
                expiresIn: 60,
                origin: "https://environment.example.test",
              },
        ),
        { status: attempts === 1 ? 409 : 200 },
      );
    },
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
    Layer.succeed(
      ClientCapabilities.MateTicketIssuer,
      mateTicketIssuer(() => hq),
    ),
  );
  const resolver = ConnectionResolver.layer.pipe(
    Layer.provide(RemoteEnvironmentAuthorization.layer),
    Layer.provide(platform),
  );
  const driver = ConnectionDriver.layer.pipe(
    Layer.provide(resolver),
    Layer.provide(Layer.succeed(RpcSession.RpcSessionFactory, factory)),
  );

  const supervisor = yield* EnvironmentSupervisor.make({ target, profile: Option.none() }).pipe(
    Effect.provide(
      Layer.mergeAll(
        driver,
        Connectivity.layer({ status: Effect.succeed("online"), changes: Stream.never }),
        ConnectionWakeups.layer({ changes: Stream.fromQueue(wakeups) }),
      ),
    ),
    Effect.provideService(ConnectionAdmissionRef, passThroughAdmission),
    Effect.provideService(EnvironmentSupervisor.MatePresence, {
      onScreen: () => true,
      hidden: () => hidden,
    }),
  );
  return {
    supervisor,
    target,
    attempts: () => attempts,
    socket: Queue.take(sockets),
    atState: (
      predicate: (state: import("../../connection/model.ts").SupervisorConnectionState) => boolean,
    ) => SubscriptionRef.changes(supervisor.state).pipe(Stream.filter(predicate), Stream.runHead),
    visibility: (value: boolean) =>
      Effect.gen(function* () {
        hidden = !value;
        const wake = ConnectionWakeups.connectionWakeupForSignal({ type: "visibility", hidden });
        if (wake !== null) yield* Queue.offer(wakeups, wake);
      }),
    initialConfig: (socket: TestWebSocket) =>
      Effect.gen(function* () {
        const request = yield* Stream.fromQueue(socket.messages).pipe(
          Stream.mapEffect((message) => decodeMessage(message)),
          Stream.filter(isRequest),
          Stream.filter((request) => request.tag === WS_METHODS.subscribeServerConfig),
          Stream.runHead,
        );
        socket.serverMessage(
          yield* encodeMessage({
            _tag: "Chunk",
            requestId: Option.getOrThrow(request).id,
            values: [
              {
                version: 1,
                type: "snapshot",
                config: yield* encodeConfig(SERVER_CONFIG),
              },
            ],
          }),
        );
      }),
  };
});

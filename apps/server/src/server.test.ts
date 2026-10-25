import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as NodeServices from "@effect/platform-node/NodeServices";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no KeyObject, generateKeyPairSync, or sign.
import * as NodeCrypto from "node:crypto";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { loadShowcaseScene } from "@t3tools/shared/showcaseScenes";

import {
  AuthAccessTokenType,
  AuthAdministrativeScopes,
  type AuthEnvironmentScope,
  AuthStandardClientScopes,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  EventId,
  GitCommandError,
  KeybindingRule,
  MessageId,
  MATE_ENGINE_PROTOCOLS,
  ExternalLauncherCommandNotFoundError,
  type OrchestrationShellStreamItem,
  type OrchestrationThreadActivity,
  type OrchestrationThreadShell,
  TerminalNotRunningError,
  type OrchestrationEvent,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  type ProviderAuthState,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstallState,
  ProviderSetupError,
  ResolvedKeybindingRule,
  ThreadId,
  TurnId,
  UsageLimitSourceId,
  WS_METHODS,
  WsRpcGroup,
  EditorId,
  ZeropsAgentLoginError,
  ZeropsDataConsoleError,
} from "@t3tools/contracts";
import {
  computeDpopAccessTokenHash,
  computeDpopJwkThumbprint,
  type DpopPublicJwk,
} from "@t3tools/shared/dpop";
import { RELAY_HEALTH_REQUEST_TYP, RELAY_MINT_REQUEST_TYP } from "@t3tools/shared/relayJwt";
import { loginTurnRefusal, turnRefusal } from "@t3tools/shared/zeropsAgentAuth";
import * as RelayClient from "@t3tools/shared/relayClient";
import { assert, it } from "@effect/vitest";
import { assertFailure, assertInclude, assertTrue } from "@effect/vitest/utils";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";
import { ChildProcessSpawner } from "effect/process";
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpServer,
} from "effect/http";
import { OtlpSerialization, OtlpTracer } from "effect/observability";
import { RpcClient, RpcSerialization } from "effect/rpc";
import * as NetAddress from "effect/net/NetAddress";
import * as Socket from "effect/socket/Socket";
import { vi } from "vite-plus/test";

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

import * as BackgroundPolicy from "./background/BackgroundPolicy.ts";
import * as ServerConfig from "./config.ts";
import { layerLoopbackTest } from "./testing/loopbackHttpServer.ts";
import { resolveZeropsEnvironment } from "./zerops/ZeropsEnvironment.ts";
import { HTTP_ROUTER_CONFIG, serveRoutes } from "./server.ts";
import { resolveAvailableEditorsForConfig, resolveFileManagerRevealKindForConfig } from "./ws.ts";
import * as GitManager from "./git/GitManager.ts";
import * as UsageLimitSources from "./usage/UsageLimitSources.ts";
import * as Keybindings from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import * as RemoteOpenTargets from "./environment/RemoteOpenTargets.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import { PersistenceSqlError } from "./persistence/Errors.ts";
import * as ProviderRegistry from "./provider/Services/ProviderRegistry.ts";
import * as ModelManifest from "./provider/ModelManifest.ts";
import * as ProviderService from "./provider/Services/ProviderService.ts";
import { ProviderAuthService } from "./provider/Services/ProviderAuthService.ts";
import { ProviderInstanceRegistry } from "./provider/Services/ProviderInstanceRegistry.ts";
import {
  AntigravityInstallation,
  AntigravityInstallationError,
} from "./provider/AntigravityInstallation.ts";
import type { ProviderInstance } from "./provider/ProviderDriver.ts";
import { ProviderAdapterRequestError } from "./provider/Errors.ts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  ProviderVersionCache,
} from "./provider/providerMaintenance.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ZeropsAgentAuth from "./zerops/ZeropsAgentAuth.ts";
import * as ZeropsAgentLoginModule from "./zerops/ZeropsAgentLogin.ts";
import * as ZeropsLoginsModule from "./zerops/ZeropsLogins.ts";
import * as ZeropsProjectSignersModule from "./zerops/ZeropsProjectSigners.ts";
import * as ZeropsSetupModule from "./zerops/ZeropsSetup.ts";
import * as ZeropsSignOutModule from "./zerops/ZeropsSignOut.ts";
import { ZeropsAutomation } from "./zerops/ZeropsAutomation.ts";
import * as ZeropsTurnAdmissionModule from "./zerops/ZeropsTurnAdmission.ts";
import { layer as providerInstancesLayer } from "./spi/providerInstances.ts";
import * as ZeropsBrowserStreamModule from "./zerops/ZeropsBrowserStream.ts";
import * as ZeropsMacStreamModule from "./zerops/ZeropsMacStream.ts";
import { ZeropsMateAttention } from "./zerops/ZeropsMateAttention.ts";
import * as ZeropsCliModule from "./zerops/ZeropsCli.ts";
import * as ZeropsDataConsoleModule from "./zerops/ZeropsDataConsole.ts";
import * as ZeropsGitRemoteProbeModule from "./zerops/ZeropsGitRemoteProbe.ts";
import type { CrewEngine } from "./zerops/crew/CrewEngine.ts";
import { crewLayerInert } from "./zerops/crew/crewLayer.ts";
import * as ZeropsCrewProposals from "./zerops/ZeropsCrewProposals.ts";
import { makeEngineWorld, mate as imageConversation } from "./engine/testing/pump/engineWorld.ts";
import { contentAssetsAt } from "./assets/ContentAssets.ts";
import sharp from "sharp";
import { ENGINE_MOVED, MateEngine } from "./engine/MateEngine.ts";
import * as ZeropsLifecycle from "./zerops/ZeropsLifecycle.ts";
import * as ZeropsMateKeyModule from "./zerops/ZeropsMateKey.ts";
import * as ZeropsOrgReadModule from "./zerops/ZeropsOrgRead.ts";
import * as ZeropsConnectionsModule from "./zerops/ZeropsConnections.ts";
import * as ZeropsTicketDoorModule from "./zerops/ZeropsTicketDoor.ts";
import * as ZeropsMateAccessListModule from "./zerops/ZeropsMateAccessList.ts";
import * as ZeropsMateUpdateModule from "./zerops/ZeropsMateUpdate.ts";
import { FIXTURE_ATTENTION, makeFixtureZeropsLayer } from "./zerops/ZeropsFixtureFeeds.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import * as ProjectCloneTracker from "./project/ProjectCloneTracker.ts";
import * as BrowserTraceCollector from "./observability/BrowserTraceCollector.ts";
import * as ProjectFaviconResolver from "./project/ProjectFaviconResolver.ts";
import * as T3ProjectFileLoader from "./project/T3ProjectFileLoader.ts";
import * as ProjectSetupScriptRunner from "./project/ProjectSetupScriptRunner.ts";
import * as RepositoryIdentityResolver from "./project/RepositoryIdentityResolver.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as WorkspaceEntries from "./workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./workspace/WorkspacePaths.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as VcsDriver from "./vcs/VcsDriver.ts";
import * as VcsStatusBroadcaster from "./vcs/VcsStatusBroadcaster.ts";
import * as VcsDriverRegistry from "./vcs/VcsDriverRegistry.ts";
import * as VcsProvisioningService from "./vcs/VcsProvisioningService.ts";
import * as GitWorkflowService from "./git/GitWorkflowService.ts";
import * as ReviewService from "./review/ReviewService.ts";
import * as SourceControlRepositoryService from "./sourceControl/SourceControlRepositoryService.ts";
import { REPLAY_MARKER_MAX_AGE } from "./auth/replayMarkers.ts";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import * as AssetSigningKey from "./assets/AssetSigningKey.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import * as CloudManagedEndpointRuntime from "./cloud/ManagedEndpointRuntime.ts";
import * as AgentAwarenessRelay from "./relay/AgentAwarenessRelay.ts";
import * as CloudCliTokenManager from "./cloud/CliTokenManager.ts";
import * as ProcessDiagnostics from "./diagnostics/ProcessDiagnostics.ts";
import * as ProcessResourceMonitor from "./diagnostics/ProcessResourceMonitor.ts";
import * as TraceDiagnostics from "./diagnostics/TraceDiagnostics.ts";
import * as DesktopTelemetryReceiver from "./resourceTelemetry/DesktopTelemetryReceiver.ts";
import * as NativeTelemetryClient from "./resourceTelemetry/NativeTelemetryClient.ts";
import * as ResourceAttribution from "./resourceTelemetry/ResourceAttribution.ts";
import * as ResourceTelemetry from "./resourceTelemetry/ResourceTelemetry.ts";
import * as Data from "effect/Data";

import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import { DEFAULT_SIGNAL_EXPORT, otlpSerializationLayer } from "@t3tools/shared/observability";
import * as OtelEnvironment from "@t3tools/shared/otelEnvironment";
import { engineHostDoubles } from "./engine/testing/hostDoubles.ts";
import { engineLayerInert } from "./engine/testing/inertEngine.ts";

const defaultProjectId = ProjectId.make("project-default");
const defaultThreadId = ThreadId.make("thread-default");
const defaultDesktopBootstrapToken = "test-desktop-bootstrap-token";
const defaultModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5-codex",
} as const;

const providerSetupInstanceId = ProviderInstanceId.make("antigravity-custom-profile");
const providerSetupDriver = ProviderDriverKind.make("antigravity");
const providerSetupInstallState: ProviderInstallState = {
  driver: providerSetupDriver,
  operationId: "install-operation",
  phase: "downloading",
  downloadedBytes: 128,
  totalBytes: 256,
  version: "test-release",
  installedVersion: null,
  canRemove: false,
  message: null,
};
const providerSetupAuthState: ProviderAuthState = {
  instanceId: providerSetupInstanceId,
  phase: "idle",
  flowId: null,
  authorizationUrl: null,
  expiresAt: null,
  message: null,
};
const providerSetupInstance: ProviderInstance = {
  instanceId: providerSetupInstanceId,
  driverKind: providerSetupDriver,
  enabled: false,
  displayName: "Google account",
  continuationIdentity: {
    driverKind: providerSetupDriver,
    continuationKey: providerSetupInstanceId,
  },
  get adapter(): never {
    throw new Error("Provider setup must not start a chat session.");
  },
  get snapshot(): never {
    throw new Error("Installation routing must not probe the provider.");
  },
  get textGeneration(): never {
    throw new Error("Provider setup must not generate text.");
  },
};

const makeLiveToolActivityEvent = (
  sequence: number,
  kind: "tool.updated" | "tool.completed" = "tool.updated",
  options: {
    readonly toolCallId?: string;
    readonly title?: string;
    readonly path?: string;
  } = {},
): Extract<OrchestrationEvent, { type: "thread.activity-appended" }> => {
  const { toolCallId = "call-edit", title = "Editing app.ts", path = "src/app.ts" } = options;
  const activity: OrchestrationThreadActivity = {
    id: EventId.make(`activity-${sequence}`),
    tone: "tool",
    kind,
    summary: title,
    payload: {
      itemType: "file_change",
      title,
      data: { toolCallId, path },
    },
    turnId: TurnId.make("turn-edit"),
    createdAt: "2026-01-01T00:00:01.000Z",
  };
  return {
    sequence,
    eventId: EventId.make(`event-tool-${sequence}`),
    aggregateKind: "thread",
    aggregateId: defaultThreadId,
    occurredAt: "2026-01-01T00:00:01.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.activity-appended",
    payload: { threadId: defaultThreadId, activity },
  };
};
const testEnvironmentDescriptor = {
  environmentId: EnvironmentId.make("environment-test"),
  label: "Test environment",
  platform: {
    os: "darwin" as const,
    arch: "arm64" as const,
  },
  serverVersion: "0.0.0-test",
  capabilities: {
    repositoryIdentity: true,
  },
};
const makeDefaultOrchestrationReadModel = () => {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    snapshotSequence: 0,
    updatedAt: now,
    projects: [
      {
        id: defaultProjectId,
        title: "Default Project",
        workspaceRoot: "/tmp/default-project",
        defaultModelSelection,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: defaultThreadId,
        projectId: defaultProjectId,
        title: "Default Thread",
        modelSelection: defaultModelSelection,
        interactionMode: "default" as const,
        runtimeMode: "full-access" as const,
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        latestTurn: null,
        messages: [],
        session: null,
        activities: [],
        proposedPlans: [],
        deletedAt: null,
      },
    ],
  };
};

const makeDefaultOrchestrationThreadShell = (
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell => {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: defaultThreadId,
    projectId: defaultProjectId,
    title: "Default Thread",
    modelSelection: defaultModelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
};

const browserOtlpTracingLayer = Layer.mergeAll(
  FetchHttpClient.layer,
  OtlpSerialization.layerJson,
  Layer.succeed(HttpClient.TracerDisabledWhen, () => true),
);

// Each real HTTP test server owns its own fixture issuer. This never exposes a
// product bootstrap endpoint or reaches the platform with a test credential.
const testAuthByPort = new Map<number, EnvironmentAuth.EnvironmentAuth["Service"]>();
const testAuth = Effect.gen(function* () {
  const server = yield* HttpServer.HttpServer;
  const auth = testAuthByPort.get((server.address as NetAddress.InetAddress).port);
  if (!auth) return yield* Effect.die(new Error("Missing test auth fixture"));
  return auth;
});

const testTicketStateByPort = new Map<
  number,
  {
    connections: ZeropsConnectionsModule.ZeropsConnections["Service"];
    tickets: ZeropsTicketDoorModule.ZeropsTicketDoor["Service"];
  }
>();
const testTicketState = Effect.gen(function* () {
  const server = yield* HttpServer.HttpServer;
  const state = testTicketStateByPort.get((server.address as NetAddress.InetAddress).port);
  if (!state) return yield* Effect.die(new Error("Missing ticket test fixture"));
  return state;
});
const ticketAuthTestLayer = EnvironmentAuth.zeropsLayer.pipe(
  Layer.provideMerge(
    ZeropsConnectionsModule.layer.pipe(
      Layer.provideMerge(ZeropsTicketDoorModule.layer),
      Layer.provideMerge(ZeropsMateAccessListModule.layer),
    ),
  ),
);

const makeAuthTestLayer = () =>
  EnvironmentAuth.layer.pipe(
    Layer.provide(SqlitePersistenceMemory),
    Layer.provide(ServerSecretStore.layer),
  );

const makeBrowserOtlpPayload = (spanName: string) =>
  Effect.gen(function* () {
    const collector = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const NodeHttp = await import("node:http");

        return await new Promise<{
          readonly close: () => Promise<void>;
          readonly firstRequest: Promise<{
            readonly body: string;
            readonly contentType: string | null;
          }>;
          readonly url: string;
        }>((resolve, reject) => {
          let resolveFirstRequest:
            | ((request: { readonly body: string; readonly contentType: string | null }) => void)
            | undefined;
          const firstRequest = new Promise<{
            readonly body: string;
            readonly contentType: string | null;
          }>((resolveRequest) => {
            resolveFirstRequest = resolveRequest;
          });

          const server = NodeHttp.createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on("data", (chunk) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            request.on("end", () => {
              resolveFirstRequest?.({
                body: Buffer.concat(chunks).toString("utf8"),
                contentType: request.headers["content-type"] ?? null,
              });
              resolveFirstRequest = undefined;
              response.statusCode = 204;
              response.end();
            });
          });

          server.on("error", reject);
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
              reject(new Error("Expected TCP collector address"));
              return;
            }

            resolve({
              url: `http://127.0.0.1:${address.port}/v1/traces`,
              firstRequest,
              close: () =>
                new Promise<void>((resolveClose, rejectClose) => {
                  server.close((error) => {
                    if (error) {
                      rejectClose(error);
                      return;
                    }
                    resolveClose();
                  });
                }),
            });
          });
        });
      }),
      ({ close }) => Effect.promise(close),
    );

    const runtime = ManagedRuntime.make(
      OtlpTracer.layer({
        url: collector.url,
        exportInterval: "10 millis",
        resource: {
          serviceName: "t3-web",
          attributes: {
            "service.runtime": "t3-web",
            "service.mode": "browser",
            "service.version": "test",
          },
        },
      }).pipe(Layer.provide(browserOtlpTracingLayer)),
    );

    try {
      yield* Effect.promise(() => runtime.runPromise(Effect.void.pipe(Effect.withSpan(spanName))));
    } finally {
      yield* Effect.promise(() => runtime.dispose());
    }

    const request = yield* Effect.raceFirst(
      Effect.promise(() => collector.firstRequest).pipe(Effect.orDie),
      Effect.sleep(Duration.seconds(1)).pipe(
        Effect.andThen(Effect.die(new Error("Timed out waiting for OTLP trace export"))),
      ),
    );
    return JSON.parse(request.body) as OtlpTracer.TraceData;
  });

/** What the agent auth feed reports outside a Zerops environment. */
const unavailableZeropsAgentAuth = {
  available: false,
  reason: "Not a Zerops environment",
  agents: [],
} as const;

/** What the agent login feed reports outside a Zerops environment — no session for either agent. */
const unavailableZeropsAgentLogin = {
  "claude-code": undefined,
  codex: undefined,
} as const;

const buildAppUnderTest = (options?: {
  ticketAuth?: boolean;
  config?: Partial<ServerConfig.ServerConfig["Service"]>;
  fixtureZeropsLayer?: Layer.Layer<
    | ZeropsLifecycle.ZeropsLifecycle
    | ZeropsAgentAuth.ZeropsAgentAuth
    | ZeropsAgentLoginModule.ZeropsAgentLogin
    | ZeropsSignOutModule.ZeropsSignOut
    | ZeropsLoginsModule.ZeropsLogins
    | ZeropsBrowserStreamModule.ZeropsBrowserStream
    | ZeropsMacStreamModule.ZeropsMacStream
    | ZeropsMateAttention
    | ZeropsCliModule.ZeropsCli
    | ZeropsMateUpdateModule.ZeropsMateUpdate
    | ZeropsDataConsoleModule.ZeropsDataConsole
    | ZeropsGitRemoteProbeModule.ZeropsGitRemoteProbe
    | ZeropsProjectSignersModule.ZeropsProjectSigners
    | ZeropsTurnAdmissionModule.ZeropsTurnAdmission
    | CrewEngine
    | ZeropsCrewProposals.ZeropsCrewProposals
    | MateEngine,
    never,
    | ServerConfig.ServerConfig
    | ProjectionSnapshotQuery.ProjectionSnapshotQuery
    | ProviderRegistry.ProviderRegistry
    | ProviderInstanceRegistry
  >;
  layers?: {
    mateEngine?: MateEngine["Service"];
    httpClient?: HttpClient.HttpClient;
    keybindings?: Partial<Keybindings.Keybindings["Service"]>;
    providerRegistry?: Partial<ProviderRegistry.ProviderRegistry["Service"]>;
    modelManifest?: Partial<ModelManifest.ModelManifest["Service"]>;
    usageLimitSources?: Partial<UsageLimitSources.UsageLimitSources["Service"]>;
    providerService?: Partial<ProviderService.ProviderService["Service"]>;
    providerAuth?: Partial<ProviderAuthService["Service"]>;
    providerInstanceRegistry?: Partial<ProviderInstanceRegistry["Service"]>;
    antigravityInstallation?: Partial<AntigravityInstallation["Service"]>;
    serverSettings?: Partial<ServerSettings.ServerSettingsService["Service"]>;
    externalLauncher?: Partial<ExternalLauncher.ExternalLauncher["Service"]>;
    vcsDriver?: Partial<VcsDriver.VcsDriver["Service"]>;
    vcsDriverRegistry?: Partial<VcsDriverRegistry.VcsDriverRegistry["Service"]>;
    gitVcsDriver?: Partial<GitVcsDriver.GitVcsDriver["Service"]>;
    gitManager?: Partial<GitManager.GitManager["Service"]>;
    sourceControlRepositoryService?: Partial<
      SourceControlRepositoryService.SourceControlRepositoryService["Service"]
    >;
    reviewService?: Partial<ReviewService.ReviewService["Service"]>;
    vcsStatusBroadcaster?: Partial<VcsStatusBroadcaster.VcsStatusBroadcaster["Service"]>;
    projectSetupScriptRunner?: Partial<
      ProjectSetupScriptRunner.ProjectSetupScriptRunner["Service"]
    >;
    terminalManager?: Partial<TerminalManager.TerminalManager["Service"]>;
    orchestrationEngine?: Partial<OrchestrationEngine.OrchestrationEngineService["Service"]>;
    projectionSnapshotQuery?: Partial<ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"]>;
    browserTraceCollector?: Partial<BrowserTraceCollector.BrowserTraceCollector["Service"]>;
    serverLifecycleEvents?: Partial<ServerLifecycleEvents.ServerLifecycleEvents["Service"]>;
    serverRuntimeStartup?: Partial<ServerRuntimeStartup.ServerRuntimeStartup["Service"]>;
    serverEnvironment?: Partial<ServerEnvironment.ServerEnvironment["Service"]>;
    repositoryIdentityResolver?: Partial<
      RepositoryIdentityResolver.RepositoryIdentityResolver["Service"]
    >;
    cloudManagedEndpointRuntime?: Partial<
      CloudManagedEndpointRuntime.CloudManagedEndpointRuntime["Service"]
    >;
    relayClient?: Partial<RelayClient.RelayClient["Service"]>;
    agentAwarenessRelay?: Partial<AgentAwarenessRelay.AgentAwarenessRelay["Service"]>;
    cloudCliTokenManager?: Partial<CloudCliTokenManager.CloudCliTokenManager["Service"]>;
    nativeTelemetryClient?: Partial<NativeTelemetryClient.NativeTelemetryClient["Service"]>;
    desktopTelemetryReceiver?: Partial<
      DesktopTelemetryReceiver.DesktopTelemetryReceiver["Service"]
    >;
    zeropsLifecycle?: Partial<ZeropsLifecycle.ZeropsLifecycle["Service"]>;
    zeropsAgentAuth?: Partial<ZeropsAgentAuth.ZeropsAgentAuth["Service"]>;
    zeropsAgentLogin?: Partial<ZeropsAgentLoginModule.ZeropsAgentLogin["Service"]>;
    zeropsBrowserStream?: Partial<ZeropsBrowserStreamModule.ZeropsBrowserStream["Service"]>;
    zeropsMacStream?: Partial<ZeropsMacStreamModule.ZeropsMacStream["Service"]>;
    zeropsCli?: Partial<ZeropsCliModule.ZeropsCli["Service"]>;
    zeropsMateUpdate?: Partial<ZeropsMateUpdateModule.ZeropsMateUpdate["Service"]>;
    zeropsDataConsole?: Partial<ZeropsDataConsoleModule.ZeropsDataConsole["Service"]>;
    zeropsGitRemoteProbe?: Partial<ZeropsGitRemoteProbeModule.ZeropsGitRemoteProbe["Service"]>;
    /** A Mate's setup; absent unless a test sets it, as on a server older than it. */
    zeropsSetup?: Partial<ZeropsSetupModule.ZeropsSetup["Service"]>;
  };
}) =>
  Effect.gen(function* () {
    if (
      options?.fixtureZeropsLayer !== undefined &&
      (options.layers?.zeropsLifecycle !== undefined ||
        options.layers?.zeropsAgentAuth !== undefined ||
        options.layers?.zeropsAgentLogin !== undefined)
    ) {
      return yield* Effect.die(
        new Error("fixtureZeropsLayer cannot be combined with per-feed Zerops layer overrides"),
      );
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const tempBaseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-router-test-" });
    const baseDir = options?.config?.baseDir ?? tempBaseDir;
    const devUrl = options?.config?.devUrl;
    const derivedPaths = yield* ServerConfig.deriveServerPaths(baseDir, devUrl);
    const config: ServerConfig.ServerConfig["Service"] = {
      logLevel: "Info",
      traceMinLevel: "Info",
      traceTimingEnabled: true,
      traceBatchWindowMs: 200,
      traceMaxBytes: 10 * 1024 * 1024,
      traceMaxFiles: 10,
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpLogsUrl: undefined,
      otlpTracesExport: DEFAULT_SIGNAL_EXPORT,
      otlpMetricsExport: DEFAULT_SIGNAL_EXPORT,
      otlpLogsExport: DEFAULT_SIGNAL_EXPORT,
      otlpServiceName: "t3-server",
      otelEnvironment: OtelEnvironment.none,
      mode: "desktop",
      port: 0,
      host: "127.0.0.1",
      cwd: process.cwd(),
      baseDir,
      homeDir: `${baseDir}/home`,
      ...derivedPaths,
      staticDir: undefined,
      devUrl,
      devAllowedOrigins: [],
      zerops: undefined,
      zeropsFixtures: undefined,
      zeropsCrew: false,
      noBrowser: true,
      startupPresentation: "browser",
      desktopBootstrapToken: defaultDesktopBootstrapToken,
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
      basePath: "",
      ...options?.config,
    };
    const layerConfig = ServerConfig.layer(config);
    const storedAuth = makeAuthTestLayer();
    const authLayer: Layer.Layer<
      Layer.Success<typeof EnvironmentAuth.zeropsLayer>,
      Layer.Error<typeof ticketAuthTestLayer> | Layer.Error<typeof storedAuth>,
      Layer.Services<typeof ticketAuthTestLayer> | Layer.Services<typeof storedAuth>
    > = options?.ticketAuth ? ticketAuthTestLayer : storedAuth;

    const defaultVcsDriver: VcsDriver.VcsDriver["Service"] = {
      capabilities: {
        kind: "git",
        supportsWorktrees: true,
        supportsBookmarks: false,
        supportsAtomicSnapshot: false,
        supportsPushDefaultRemote: true,
        ignoreClassifier: "native",
      },
      execute: () =>
        Effect.succeed({
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
      detectRepository: () => Effect.succeed(null),
      isInsideWorkTree: () => Effect.succeed(false),
      listWorkspaceFiles: () =>
        Effect.succeed({
          paths: [],
          truncated: false,
          freshness: {
            source: "live-local",
            observedAt: TEST_EPOCH,
            expiresAt: Option.none(),
          },
        }),
      listRemotes: () =>
        Effect.succeed({
          remotes: [],
          freshness: {
            source: "live-local",
            observedAt: TEST_EPOCH,
            expiresAt: Option.none(),
          },
        }),
      filterIgnoredPaths: (_cwd, relativePaths) => Effect.succeed(relativePaths),
      initRepository: () => Effect.void,
      ...options?.layers?.vcsDriver,
    };
    const vcsDriverRegistryLayer = Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
      get: () => Effect.succeed(defaultVcsDriver),
      detect: (input) =>
        defaultVcsDriver.detectRepository(input.cwd).pipe(
          Effect.filterOrElse(
            (repository) => repository !== null,
            () =>
              defaultVcsDriver.isInsideWorkTree(input.cwd).pipe(
                Effect.map((isInsideWorkTree) =>
                  isInsideWorkTree
                    ? {
                        kind: "git" as const,
                        rootPath: input.cwd,
                        metadataPath: null,
                        freshness: {
                          source: "live-local" as const,
                          observedAt: TEST_EPOCH,
                          expiresAt: Option.none(),
                        },
                      }
                    : null,
                ),
              ),
          ),
          Effect.map((repository) =>
            repository
              ? ({
                  kind: repository.kind,
                  repository,
                  driver: defaultVcsDriver,
                } satisfies VcsDriverRegistry.VcsDriverHandle)
              : null,
          ),
        ),
      resolve: (input) =>
        Effect.succeed({
          kind:
            input.requestedKind === "auto" || !input.requestedKind ? "git" : input.requestedKind,
          repository: {
            kind:
              input.requestedKind === "auto" || !input.requestedKind ? "git" : input.requestedKind,
            rootPath: input.cwd,
            metadataPath: null,
            freshness: {
              source: "live-local",
              observedAt: TEST_EPOCH,
              expiresAt: Option.none(),
            },
          },
          driver: defaultVcsDriver,
        }),
      ...options?.layers?.vcsDriverRegistry,
    });
    const gitVcsDriverLayer = Layer.mock(GitVcsDriver.GitVcsDriver)({
      ...options?.layers?.gitVcsDriver,
    });
    // Worktrees go through GitManager, which adds the submodule setting; a
    // test that stubs only the driver's createWorktree still reaches it.
    const driverCreateWorktree = options?.layers?.gitVcsDriver?.createWorktree;
    const gitManagerLayer = Layer.mock(GitManager.GitManager)({
      ...(driverCreateWorktree ? { createWorktree: driverCreateWorktree } : {}),
      ...options?.layers?.gitManager,
    });
    const workspaceEntriesLayer = WorkspaceEntries.layer.pipe(
      Layer.provide(WorkspacePaths.layer),
      Layer.provideMerge(vcsDriverRegistryLayer),
    );
    const workspaceAndProjectServicesLayer = Layer.mergeAll(
      WorkspacePaths.layer,
      workspaceEntriesLayer,
      WorkspaceFileSystem.layer.pipe(
        Layer.provide(WorkspacePaths.layer),
        Layer.provide(workspaceEntriesLayer),
      ),
      ProjectFaviconResolver.layer.pipe(
        Layer.provide(WorkspacePaths.layer),
        Layer.provide(T3ProjectFileLoader.layer),
      ),
    );
    const gitWorkflowLayer = GitWorkflowService.layer.pipe(
      Layer.provideMerge(vcsDriverRegistryLayer),
      Layer.provideMerge(gitVcsDriverLayer),
      Layer.provideMerge(gitManagerLayer),
    );
    const vcsProvisioningLayer = VcsProvisioningService.layer.pipe(
      Layer.provide(vcsDriverRegistryLayer),
    );
    const reviewLayer = options?.layers?.reviewService
      ? Layer.mock(ReviewService.ReviewService)({
          ...options.layers.reviewService,
        })
      : ReviewService.layer.pipe(
          Layer.provideMerge(gitVcsDriverLayer),
          Layer.provide(vcsDriverRegistryLayer),
        );
    const vcsStatusBroadcasterLayer = options?.layers?.vcsStatusBroadcaster
      ? Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
          ...options.layers.vcsStatusBroadcaster,
        })
      : VcsStatusBroadcaster.layer.pipe(Layer.provide(gitWorkflowLayer));
    // One projection for the routes and for D6's gate, which reads a
    // thread's agent from it.
    const projectionSnapshotQueryLayer = Layer.mock(
      ProjectionSnapshotQuery.ProjectionSnapshotQuery,
    )({
      getUserInputActivity: () => Effect.die("unused"),
      getCommandReadModel: () => Effect.succeed(makeDefaultOrchestrationReadModel()),
      getSnapshot: () => Effect.succeed(makeDefaultOrchestrationReadModel()),
      getShellSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 0,
          projects: [],
          threads: [],
          updatedAt: "1970-01-01T00:00:00.000Z",
        }),
      getArchivedShellSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 0,
          projects: [],
          threads: [],
          updatedAt: "1970-01-01T00:00:00.000Z",
        }),
      searchThreads: () => Effect.succeed({ matches: [] }),
      getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
      getProjectWorkspaceRootById: () => Effect.succeedNone,
      getProjectShellById: () => Effect.succeedNone,
      getThreadShellById: () => Effect.succeedNone,
      getThreadDetailById: () => Effect.succeedNone,
      getThreadDetailSnapshot: () => Effect.succeedNone,
      getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
      getEventReplayStats: ({ fromSequenceExclusive, toSequenceInclusive }) =>
        Effect.succeed({
          eventCount: Math.max(0, toSequenceInclusive - fromSequenceExclusive),
          payloadBytes: 0,
        }),
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
      ...options?.layers?.projectionSnapshotQuery,
    });
    // One registry for the routes and for D6's gate, which reads an
    // instance's driver from it.
    const providerRegistryLayer = Layer.mock(ProviderRegistry.ProviderRegistry)({
      getProviders: Effect.succeed([]),
      refresh: () => Effect.succeed([]),
      refreshInstance: () => Effect.succeed([]),
      getProviderMaintenanceCapabilitiesForInstance: (_instanceId, provider) =>
        Effect.succeed(
          makeManualOnlyProviderMaintenanceCapabilities({ provider, packageName: null }),
        ),
      setProviderMaintenanceActionState: () => Effect.succeed([]),
      streamChanges: Stream.empty,
      ...options?.layers?.providerRegistry,
    });
    const resourceTelemetryLayer = ResourceTelemetry.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          NativeTelemetryClient.layerTest(options?.layers?.nativeTelemetryClient),
          DesktopTelemetryReceiver.layerTest(options?.layers?.desktopTelemetryReceiver),
          ResourceAttribution.layer,
        ),
      ),
    );
    const servedRoutesLayer = serveRoutes({
      disableListenLog: true,
      disableLogger: true,
      routerConfig: HTTP_ROUTER_CONFIG,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(Keybindings.Keybindings)({
            loadConfigState: Effect.succeed({
              keybindings: [],
              issues: [],
            }),
            streamChanges: Stream.empty,
            ...options?.layers?.keybindings,
          }),
          Layer.mock(UsageLimitSources.UsageLimitSources)({
            current: Effect.succeed([]),
            streamChanges: Stream.make([]),
            refresh: Effect.void,
            ...options?.layers?.usageLimitSources,
          }),
        ),
      ),
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ModelManifest.ModelManifest)({
            forceRefresh: Effect.succeed(ModelManifest.BUNDLED_MODEL_MANIFEST),
            ...options?.layers?.modelManifest,
          }),
          providerRegistryLayer,
          Layer.mock(ProviderService.ProviderService)({
            uploadFeedback: () => Effect.die("Provider feedback is not stubbed in this test"),
            ...options?.layers?.providerService,
          }),
          Layer.mock(ProviderAuthService)({
            ...options?.layers?.providerAuth,
          }),
          Layer.mock(ProviderInstanceRegistry)({
            getInstance: () => Effect.undefined,
            listInstances: Effect.succeed([]),
            ...options?.layers?.providerInstanceRegistry,
          }),
          Layer.mock(AntigravityInstallation)({
            managedDirectory: "unused-test-antigravity-runtime",
            ...options?.layers?.antigravityInstallation,
          }),
        ),
      ),
      Layer.provide(
        Layer.mock(ServerSettings.ServerSettingsService)({
          start: Effect.void,
          ready: Effect.void,
          getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
          updateSettings: () => Effect.succeed(DEFAULT_SERVER_SETTINGS),
          streamChanges: Stream.empty,
          ...options?.layers?.serverSettings,
        }),
      ),
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ExternalLauncher.ExternalLauncher)({
            resolveAvailableEditors: () => Effect.succeed([]),
            resolveFileManagerRevealKind: () => Effect.undefined,
            ...options?.layers?.externalLauncher,
          }),
          Layer.mock(RemoteOpenTargets.RemoteOpenTargets)({
            resolveTargets: () => Effect.succeed([]),
          }),
        ),
      ),
      Layer.provide(
        Layer.mock(ProcessDiagnostics.ProcessDiagnostics)({
          read: Effect.succeed({
            serverPid: process.pid,
            readAt: TEST_EPOCH,
            processCount: 0,
            totalRssBytes: 0,
            totalCpuPercent: 0,
            processes: [],
            error: Option.none(),
          }),
          signal: (input) =>
            Effect.succeed({
              pid: input.pid,
              signal: input.signal,
              signaled: true,
              message: Option.none(),
            }),
        }),
      ),
      Layer.provide(
        Layer.mock(ProcessResourceMonitor.ProcessResourceMonitor)({
          readHistory: (input) =>
            Effect.succeed({
              readAt: TEST_EPOCH,
              windowMs: input.windowMs,
              bucketMs: input.bucketMs,
              sampleIntervalMs: 5_000,
              retainedSampleCount: 0,
              totalCpuSecondsApprox: 0,
              buckets: [],
              topProcesses: [],
              error: Option.none(),
            }),
        }),
      ),
      Layer.provide(
        Layer.mock(TraceDiagnostics.TraceDiagnostics)({
          read: () =>
            Effect.succeed({
              traceFilePath: "",
              scannedFilePaths: [],
              readAt: TEST_EPOCH,
              recordCount: 0,
              parseErrorCount: 0,
              firstSpanAt: Option.none(),
              lastSpanAt: Option.none(),
              failureCount: 0,
              interruptionCount: 0,
              slowSpanThresholdMs: 1_000,
              slowSpanCount: 0,
              logLevelCounts: {},
              topSpansByCount: [],
              slowestSpans: [],
              commonFailures: [],
              latestFailures: [],
              latestWarningAndErrorLogs: [],
              partialFailure: Option.none(),
              error: Option.none(),
            }),
        }),
      ),
      Layer.provide(gitManagerLayer),
      Layer.provide(gitVcsDriverLayer),
      Layer.provide(gitWorkflowLayer),
      Layer.provide(reviewLayer),
      Layer.provide(vcsProvisioningLayer),
      Layer.provide(
        Layer.mock(SourceControlRepositoryService.SourceControlRepositoryService)({
          ...options?.layers?.sourceControlRepositoryService,
        }),
      ),
      Layer.provideMerge(vcsStatusBroadcasterLayer),
      Layer.provide(
        Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
          runForThread: () => Effect.succeed({ status: "no-script" as const }),
          ...options?.layers?.projectSetupScriptRunner,
        }),
      ),
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(TerminalManager.TerminalManager)({
            ...options?.layers?.terminalManager,
          }),
          ProjectCloneTracker.layer.pipe(
            Layer.provide(
              Layer.mock(SourceControlRepositoryService.SourceControlRepositoryService)({
                ...options?.layers?.sourceControlRepositoryService,
              }),
            ),
          ),
        ),
      ),
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
            readEvents: () => Stream.empty,
            readThreadEvents: () => Stream.empty,
            getThreadReplayStats: () =>
              Effect.succeed({
                eventCount: 0,
                payloadBytes: 0,
                hasCreateEvent: false,
              }),
            dispatch: () => Effect.succeed({ sequence: 0 }),
            streamDomainEvents: Stream.empty,
            latestSequence: Effect.succeed(0),
            ...options?.layers?.orchestrationEngine,
          }),
        ),
      ),
      Layer.provide(projectionSnapshotQueryLayer),
    );

    const appLayer = servedRoutesLayer.pipe(
      Layer.provide(resourceTelemetryLayer),
      Layer.provide(
        Layer.mock(BrowserTraceCollector.BrowserTraceCollector)({
          record: () => Effect.void,
          ...options?.layers?.browserTraceCollector,
        }),
      ),
      Layer.provide(
        Layer.mergeAll(
          otlpSerializationLayer(config.otlpTracesExport.protocol),
          // The door (`zerops/http.ts`) requires these directly, outside
          // the fixture/feeds bundle the next `Layer.provide` supplies: a
          // test machine has no live env store either, so the reader
          // answers the boot snapshot (`undefined`, same as `config.zerops`
          // being unset), the member list has no key to be read with, no HQ
          // sends who the project opens for, and the status starts `"unknown"`.
          ZeropsMateAccessListModule.layer.pipe(
            Layer.provideMerge(
              ZeropsOrgReadModule.layer.pipe(
                Layer.provideMerge(
                  Layer.succeed(
                    ZeropsMateKeyModule.ZeropsMateKey,
                    ZeropsMateKeyModule.snapshotOnlyReader(undefined),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      Layer.provide(
        options?.fixtureZeropsLayer?.pipe(
          Layer.provide(
            Layer.mergeAll(
              projectionSnapshotQueryLayer,
              providerRegistryLayer,
              Layer.mock(ProviderInstanceRegistry)({ getInstance: () => Effect.undefined }),
            ),
          ),
        ) ??
          Layer.mergeAll(
            // A test machine is not a Zerops environment, which is exactly the
            // shape the real feeds report there: unavailable, no errors. Mocked
            // rather than built so the suite does not spawn a doomed child
            // process per test.
            Layer.mock(ZeropsLifecycle.ZeropsLifecycle)({
              get: (threadId) => Effect.succeed({ threadId, recentTools: [] }),
              subscribe: (threadId) =>
                Effect.succeed({
                  latest: { threadId, recentTools: [] },
                  changes: Stream.empty,
                }),
              ingest: () => Effect.void,
              ...options?.layers?.zeropsLifecycle,
            }),
            // A test machine is not a Zerops environment, which is exactly the
            // shape the real feeds report there: unavailable, no errors. Mocked
            // rather than built so the suite never touches a real credential
            // directory or the zembed env store. `ZeropsAgentLogin` (S7
            // follow-up F8) mirrors `ZeropsAgentAuth`'s own shape — no active
            // session for either agent, with `start`/`cancel` failing the same
            // way the real feed would outside a Zerops environment. All four
            // mocks form one fallback layer so fixture injection replaces them
            // atomically.
            Layer.mock(ZeropsAgentAuth.ZeropsAgentAuth)({
              latest: Effect.succeed(unavailableZeropsAgentAuth),
              changes: Stream.empty,
              subscribe: Effect.succeed({
                latest: unavailableZeropsAgentAuth,
                changes: Stream.empty,
              }),
              recheckNow: () => Effect.void,
              ...options?.layers?.zeropsAgentAuth,
            }),
            Layer.mock(ZeropsAgentLoginModule.ZeropsAgentLogin)({
              latest: Effect.succeed(unavailableZeropsAgentLogin),
              changes: Stream.empty,
              subscribe: Effect.succeed({
                latest: unavailableZeropsAgentLogin,
                changes: Stream.empty,
              }),
              start: () =>
                Effect.fail(
                  new ZeropsAgentLoginError({
                    reason: "unavailable",
                    detail: "This environment does not offer a server-driven login.",
                  }),
                ),
              cancel: () =>
                Effect.fail(
                  new ZeropsAgentLoginError({
                    reason: "unavailable",
                    detail: "This environment does not offer a server-driven login.",
                  }),
                ),
              ...options?.layers?.zeropsAgentLogin,
            }),
            // Same "unavailable" shape start/cancel report outside a Zerops
            // environment — sign-out is a real action against a container
            // this test suite never has.
            Layer.succeed(ZeropsSignOutModule.ZeropsSignOut, ZeropsSignOutModule.unavailable),
            // No logins beyond the two defaults outside a Zerops environment,
            // and none to add, sign out or remove — the real services' own
            // answer there.
            Layer.effect(ZeropsLoginsModule.ZeropsLogins, ZeropsLoginsModule.unavailable),
            // A test machine saw nobody sign anything in, and signs nothing out.
            Layer.mock(ZeropsProjectSignersModule.ZeropsProjectSigners)({
              signers: Effect.succeed({}),
              turnRefusal: ({ agent, subject }) =>
                Effect.succeed(turnRefusal({ agent, signer: undefined, subject })),
              loginRefusal: ({ state, token, subject }) =>
                Effect.succeed(
                  loginTurnRefusal({
                    state,
                    token,
                    signer: undefined,
                    subject,
                  }),
                ),
            }),
            // A test machine has no agent-browser daemon — mocked to
            // `no-browser` so the suite never opens a real socket or reads
            // `~/.agent-browser/default.stream`.
            Layer.mock(ZeropsBrowserStreamModule.ZeropsBrowserStream)({
              subscribe: Effect.succeed(Stream.make({ type: "state", status: "no-browser" })),
              ...options?.layers?.zeropsBrowserStream,
            }),
            // A test machine pairs no Mac: the suite never reads a pairing or spawns ssh.
            Layer.mock(ZeropsMacStreamModule.ZeropsMacStream)({
              subscribe: Effect.succeed(
                Stream.make({ type: "state", status: "not-paired", inUse: false }),
              ),
              sendInput: () => Effect.void,
              ...options?.layers?.zeropsMacStream,
            }),
            Layer.mock(ZeropsMateAttention)({
              healthCurrent: Effect.succeed(Option.none()),
              healthChanges: Stream.empty,
              current: Effect.succeed(FIXTURE_ATTENTION),
              changes: Stream.make(FIXTURE_ATTENTION),
            }),
            // A test machine has no `zcp` binary — mocked so the suite never
            // spawns a doomed child process, matching MU-3: outside a Zerops
            // environment ZeropsMateUpdate holds nothing.
            Layer.mock(ZeropsCliModule.ZeropsCli)({
              mateStatus: () => Effect.die("ZeropsCli mock: mateStatus is unreachable"),
              mateUpdate: () => Effect.die("ZeropsCli mock: mateUpdate is unreachable"),
              ...options?.layers?.zeropsCli,
            }),
            Layer.mock(ZeropsMateUpdateModule.ZeropsMateUpdate)({
              current: Effect.succeed(undefined),
              refresh: Effect.void,
              ...options?.layers?.zeropsMateUpdate,
            }),
            // A test machine has no `zcp` data console engine to spawn —
            // mocked to `idle`/`session_unavailable` so the suite never
            // spawns a real process.
            Layer.mock(ZeropsDataConsoleModule.ZeropsDataConsole)({
              subscribe: Effect.succeed(Stream.make({ status: "idle" })),
              call: () =>
                Effect.fail(
                  new ZeropsDataConsoleError({
                    code: "session_unavailable",
                    message: "the data console is unavailable",
                  }),
                ),
              ...options?.layers?.zeropsDataConsole,
            }),
            // A test machine has no checkout and no remote; the probe answers
            // what an unreachable one answers rather than running git.
            Layer.mock(ZeropsGitRemoteProbeModule.ZeropsGitRemoteProbe)({
              probe: () =>
                Effect.succeed({
                  reachable: false,
                  remote: "origin",
                  refCount: 0,
                  detail: "no remote in the test harness",
                }),
              ...options?.layers?.zeropsGitRemoteProbe,
            }),
            // Crew mode off, as outside a Zerops project: the crew RPCs answer
            // `off` and refuse the rest.
            crewLayerInert,
            // No crew is proposed here: no harness test asks for one.
            Layer.mock(ZeropsCrewProposals.ZeropsCrewProposals)({}),
            // An ordinary Mate: no HQ says it is automated.
            Layer.mock(ZeropsAutomation)({ automated: Effect.succeed(false) }),
            // The Mate engine inert, whatever the switch says: its doors are V1's to close.
            options?.layers?.mateEngine
              ? Layer.succeed(MateEngine, options.layers.mateEngine)
              : engineLayerInert,
            options?.layers?.zeropsSetup === undefined
              ? Layer.empty
              : Layer.mock(ZeropsSetupModule.ZeropsSetup)(options.layers.zeropsSetup),
          ).pipe((zeropsMocks) =>
            // D6's gate, live, over the agent-auth and signers mocked above:
            // with no agents reported, it admits every turn.
            ZeropsTurnAdmissionModule.layer.pipe(
              Layer.provideMerge(zeropsMocks),
              Layer.provide(
                Layer.mergeAll(
                  projectionSnapshotQueryLayer,
                  providerInstancesLayer.pipe(
                    Layer.provide(providerRegistryLayer),
                    Layer.provide(
                      Layer.mock(ProviderInstanceRegistry)({
                        getInstance: () => Effect.undefined,
                        ...options?.layers?.providerInstanceRegistry,
                      }),
                    ),
                  ),
                ),
              ),
            ),
          ),
      ),
      Layer.provide(
        Layer.mock(ServerLifecycleEvents.ServerLifecycleEvents)({
          publish: (event) => Effect.succeed({ ...(event as any), sequence: 1 }),
          snapshot: Effect.succeed({ sequence: 0, events: [] }),
          stream: Stream.empty,
          ...options?.layers?.serverLifecycleEvents,
        }),
      ),
      Layer.provide(
        Layer.mock(ServerRuntimeStartup.ServerRuntimeStartup)({
          awaitCommandReady: Effect.void,
          markHttpListening: Effect.void,
          enqueueCommand: (effect) => effect,
          ...options?.layers?.serverRuntimeStartup,
        }),
      ),
      Layer.provide(
        Layer.mock(BackgroundPolicy.BackgroundPolicy)({
          reportClientActivity: () => Effect.void,
          removeRpcClient: () => Effect.void,
          reportHostPowerState: () => Effect.void,
          snapshot: Effect.succeed({
            hostPower: {
              source: "unknown",
              idle: "unknown",
              idleSeconds: null,
              locked: "unknown",
              suspended: false,
              onBattery: "unknown",
              lowPowerMode: "unknown",
              thermalState: "unknown",
              stale: true,
              updatedAt: TEST_EPOCH,
            },
            leases: [],
            activeForegroundLeaseCount: 0,
            activeScopeKeys: [],
            shouldRunOpportunisticWork: false,
            updatedAt: TEST_EPOCH,
          }),
          streamChanges: Stream.empty,
          subscribe: Effect.succeed({
            latest: {
              hostPower: {
                source: "unknown",
                idle: "unknown",
                idleSeconds: null,
                locked: "unknown",
                suspended: false,
                onBattery: "unknown",
                lowPowerMode: "unknown",
                thermalState: "unknown",
                stale: true,
                updatedAt: TEST_EPOCH,
              },
              leases: [],
              activeForegroundLeaseCount: 0,
              activeScopeKeys: [],
              shouldRunOpportunisticWork: false,
              updatedAt: TEST_EPOCH,
            },
            changes: Stream.empty,
          }),
          hasDemand: () => Effect.succeed(false),
          shouldRunScopeWork: () => Effect.succeed(false),
          shouldRunOpportunisticWork: Effect.succeed(false),
        }),
      ),
      Layer.provide(
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(testEnvironmentDescriptor.environmentId),
          getDescriptor: Effect.succeed(testEnvironmentDescriptor),
          ...options?.layers?.serverEnvironment,
        }),
      ),
      Layer.provide(
        Layer.mock(RepositoryIdentityResolver.RepositoryIdentityResolver)({
          resolve: () => Effect.succeed(null),
          ...options?.layers?.repositoryIdentityResolver,
        }),
      ),
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(
            CloudManagedEndpointRuntime.CloudManagedEndpointRuntime,
            CloudManagedEndpointRuntime.CloudManagedEndpointRuntime.of({
              applyConfig: () => Effect.succeed({ status: "disabled" }),
              ...options?.layers?.cloudManagedEndpointRuntime,
            }),
          ),
          Layer.mock(AgentAwarenessRelay.AgentAwarenessRelay)({
            requestCatchUp: () => Effect.void,
            ...options?.layers?.agentAwarenessRelay,
          }),
        ),
      ),
      Layer.provide(
        Layer.succeed(
          RelayClient.RelayClient,
          RelayClient.RelayClient.of({
            resolve: Effect.succeed({
              status: "missing",
              version: RelayClient.CLOUDFLARED_VERSION,
            }),
            install: Effect.die("unused relay-client install"),
            installWithProgress: () => Effect.die("unused relay-client install"),
            ...options?.layers?.relayClient,
          }),
        ),
      ),
      Layer.provide(
        Layer.mock(CloudCliTokenManager.CloudCliTokenManager)({
          get: Effect.die(new Error("Unexpected T3 Connect CLI authorization request.")),
          getExisting: Effect.succeedNone,
          hasCredential: Effect.succeed(false),
          clear: Effect.void,
          ...options?.layers?.cloudCliTokenManager,
        }),
      ),
      Layer.provideMerge(authLayer),
      Layer.provideMerge(AssetSigningKey.layer.pipe(Layer.provideMerge(ServerSecretStore.layer))),
      Layer.provide(workspaceAndProjectServicesLayer),
      Layer.provideMerge(
        options?.layers?.httpClient === undefined
          ? FetchHttpClient.layer
          : Layer.succeed(HttpClient.HttpClient, options.layers.httpClient),
      ),
      Layer.provide(layerConfig),
    );

    const context = yield* Layer.build(appLayer);
    const server = yield* HttpServer.HttpServer;
    const port = (server.address as NetAddress.InetAddress).port;
    testAuthByPort.set(port, Context.get(context, EnvironmentAuth.EnvironmentAuth));
    if (options?.ticketAuth)
      testTicketStateByPort.set(port, {
        connections: Option.getOrThrow(
          Context.getOption(context, ZeropsConnectionsModule.ZeropsConnections),
        ),
        tickets: Option.getOrThrow(
          Context.getOption(context, ZeropsTicketDoorModule.ZeropsTicketDoor),
        ),
      });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        testAuthByPort.delete(port);
        testTicketStateByPort.delete(port);
      }),
    );
    return config;
  });

const parseAuthorizationFromWsUrl = (
  wsUrl: string,
): { readonly cookie: string | null; readonly url: string } => {
  const next = new URL(wsUrl);
  const cookie = next.hash.startsWith("#cookie=")
    ? decodeURIComponent(next.hash.slice("#cookie=".length))
    : null;
  next.hash = "";
  return {
    cookie,
    url: next.toString(),
  };
};

const wsRpcProtocolLayer = (
  wsUrl: string,
  onMessage?: (message: string) => void,
  ticket?: string,
) => {
  const { cookie, url } = parseAuthorizationFromWsUrl(wsUrl);
  const webSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) => {
      // Socket.makeWebSocket only ever passes its `protocols` option here.
      const socket = new NodeSocket.NodeWS.WebSocket(
        socketUrl,
        protocols as string | string[] | undefined,
        ticket
          ? { origin: "https://mate.zerops.io" }
          : cookie
            ? { headers: { authorization: cookie } }
            : undefined,
      );
      if (ticket) socket.once("open", () => socket.send(JSON.stringify({ ticket })));
      if (onMessage) socket.on("message", (data) => onMessage(data.toString()));
      return socket as unknown as globalThis.WebSocket;
    },
  );

  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(url).pipe(Layer.provide(webSocketConstructorLayer))),
    Layer.provide(RpcSerialization.layerJson),
  );
};

const makeWsRpcClient = RpcClient.make(WsRpcGroup);
type WsRpcClient =
  typeof makeWsRpcClient extends Effect.Effect<infer Client, any, any> ? Client : never;

const withWsRpcClient = <A, E, R>(
  wsUrl: string,
  f: (client: WsRpcClient) => Effect.Effect<A, E, R>,
  onMessage?: (message: string) => void,
  ticket?: string,
) =>
  makeWsRpcClient.pipe(
    Effect.flatMap(f),
    Effect.provide(wsRpcProtocolLayer(wsUrl, onMessage, ticket)),
  );

const withFirstWsAckHeld = (
  wsUrl: string,
  held: Deferred.Deferred<void>,
  release: Deferred.Deferred<void>,
) => {
  let holdNextAck = true;
  return Layer.effect(RpcClient.Protocol)(
    Effect.map(RpcClient.Protocol, (protocol) =>
      RpcClient.Protocol.of({
        ...protocol,
        send: (clientId, request, transferables) => {
          const send = protocol.send(clientId, request, transferables);
          if (request._tag !== "Ack" || !holdNextAck) {
            return send;
          }
          holdNextAck = false;
          return Deferred.succeed(held, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(send),
          );
        },
      }),
    ),
  ).pipe(Layer.provide(wsRpcProtocolLayer(wsUrl)));
};

const appendAuthorizationToWsUrl = (url: string, sessionCookieHeader: string) => {
  const isAbsoluteUrl = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url);
  const next = new URL(url, "http://localhost");
  next.hash = `cookie=${encodeURIComponent(sessionCookieHeader)}`;
  return isAbsoluteUrl ? next.toString() : `${next.pathname}${next.search}${next.hash}`;
};

const getHttpServerUrl = (pathname = "") =>
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer;
    const address = server.address as NetAddress.InetAddress;
    return `http://127.0.0.1:${address.port}${pathname}`;
  });

const exchangeAccessToken = (
  credential = defaultDesktopBootstrapToken,
  options?: {
    readonly headers?: Record<string, string>;
    readonly scope?: string;
    readonly clientMetadata?: {
      readonly label?: string;
      readonly deviceType?: string;
      readonly os?: string;
    };
  },
) =>
  Effect.gen(function* () {
    if (credential === defaultDesktopBootstrapToken)
      credential = (yield* issueFixtureGrant()).credential;
    const tokenUrl = yield* getHttpServerUrl("/oauth/token");
    const response = yield* fetchEffect(tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...options?.headers,
      },
      body: new URLSearchParams({
        grant_type: AuthTokenExchangeGrantType,
        subject_token: credential,
        subject_token_type: AuthEnvironmentBootstrapTokenType,
        requested_token_type: AuthAccessTokenType,
        scope:
          options?.scope ??
          "orchestration:read orchestration:operate terminal:operate review:write relay:read access:read access:write relay:write",
        ...(options?.clientMetadata?.label ? { client_label: options.clientMetadata.label } : {}),
        ...(options?.clientMetadata?.deviceType
          ? { client_device_type: options.clientMetadata.deviceType }
          : {}),
        ...(options?.clientMetadata?.os ? { client_os: options.clientMetadata.os } : {}),
      }).toString(),
    });
    const body = yield* responseJsonEffect<{
      readonly access_token?: string;
      readonly issued_token_type?: string;
      readonly token_type?: string;
      readonly expires_in?: number;
      readonly scope?: string;
      readonly _tag?: string;
      readonly code?: string;
      readonly reason?: string;
      readonly traceId?: string;
    }>(response);
    return {
      response,
      body,
    };
  });

const makeDpopProof = (input: {
  readonly method: string;
  readonly url: string;
  readonly iat: number;
  readonly accessToken?: string;
  readonly jti?: string;
  readonly privateKey?: NodeCrypto.KeyObject;
  readonly publicJwk?: DpopPublicJwk;
}) => {
  const keyPair =
    input.privateKey && input.publicJwk
      ? { privateKey: input.privateKey, publicJwk: input.publicJwk }
      : (() => {
          const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ec", {
            namedCurve: "P-256",
          });
          return { privateKey, publicJwk: publicKey.export({ format: "jwk" }) as DpopPublicJwk };
        })();
  const header = Buffer.from(
    JSON.stringify({
      typ: "dpop+jwt",
      alg: "ES256",
      jwk: keyPair.publicJwk,
    }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      htm: input.method,
      htu: input.url,
      jti: input.jti ?? "proof-1",
      iat: input.iat,
      ...(input.accessToken ? { ath: computeDpopAccessTokenHash(input.accessToken) } : {}),
    }),
  ).toString("base64url");
  const signature = NodeCrypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: keyPair.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return {
    proof: `${header}.${payload}.${signature}`,
    thumbprint: computeDpopJwkThumbprint(keyPair.publicJwk),
    privateKey: keyPair.privateKey,
    publicJwk: keyPair.publicJwk,
  };
};

const makeCloudMintCredentialRequest = (input: {
  readonly privateKey: string;
  readonly environmentId: EnvironmentId;
  readonly clientProofKeyThumbprint: string;
  readonly issuer?: string;
  readonly audience?: string;
  readonly subject?: string;
  readonly jti?: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly scope?: ReadonlyArray<"environment:connect">;
}) => {
  const payload = {
    iss: input.issuer ?? "https://relay.example.test",
    aud: input.audience ?? `t3-env:${input.environmentId}`,
    sub: input.subject ?? "user_123",
    jti: input.jti ?? "cloud-mint-jti-1",
    environmentId: input.environmentId,
    clientProofKeyThumbprint: input.clientProofKeyThumbprint,
    cnf: {
      jkt: input.clientProofKeyThumbprint,
    },
    nonce: input.nonce,
    iat: Math.floor(DateTime.makeUnsafe(input.issuedAt).epochMilliseconds / 1_000),
    exp: Math.floor(DateTime.makeUnsafe(input.expiresAt).epochMilliseconds / 1_000),
    scope: input.scope ?? ["environment:connect"],
  } as const;
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", typ: RELAY_MINT_REQUEST_TYP }),
  ).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${encodedPayload}`;
  return {
    proof: `${signingInput}.${NodeCrypto.sign(null, Buffer.from(signingInput), input.privateKey).toString("base64url")}`,
  };
};

const makeCloudEnvironmentHealthRequest = (input: {
  readonly privateKey: string;
  readonly environmentId: EnvironmentId;
  readonly issuer?: string;
  readonly audience?: string;
  readonly subject?: string;
  readonly jti?: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly scope?: ReadonlyArray<"environment:status">;
}) => {
  const payload = {
    iss: input.issuer ?? "https://relay.example.test",
    aud: input.audience ?? `t3-env:${input.environmentId}`,
    sub: input.subject ?? "user_123",
    jti: input.jti ?? "cloud-health-jti-1",
    environmentId: input.environmentId,
    nonce: input.nonce,
    iat: Math.floor(DateTime.makeUnsafe(input.issuedAt).epochMilliseconds / 1_000),
    exp: Math.floor(DateTime.makeUnsafe(input.expiresAt).epochMilliseconds / 1_000),
    scope: input.scope ?? ["environment:status"],
  } as const;
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", typ: RELAY_HEALTH_REQUEST_TYP }),
  ).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${encodedPayload}`;
  return {
    proof: `${signingInput}.${NodeCrypto.sign(null, Buffer.from(signingInput), input.privateKey).toString("base64url")}`,
  };
};

const decodeCompactJwtPayload = <A>(token: string): A => {
  const encodedPayload = token.split(".")[1];
  if (!encodedPayload) {
    throw new Error("JWT does not contain a payload.");
  }
  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as A;
};

class AuthenticationGetterError extends Data.TaggedError("AuthenticationGetterError")<{
  readonly message: string;
}> {}

class TestHttpRequestError extends Data.TaggedError("TestHttpRequestError")<{
  readonly cause: unknown;
}> {}

const testRequestUrl = (input: Parameters<typeof fetch>[0]): string => {
  const value = input.toString();
  if (!/^https?:\/\//i.test(value)) {
    return value;
  }
  const url = new URL(value);
  return `${url.pathname}${url.search}`;
};

const fetchEffect = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const request = HttpClientRequest.make((init?.method ?? "GET") as "GET" | "POST")(
    testRequestUrl(input),
    {
      headers: init?.headers as Record<string, string> | undefined,
    },
  ).pipe(
    typeof init?.body === "string"
      ? HttpClientRequest.bodyText(
          init.body,
          (init.headers as Record<string, string> | undefined)?.["content-type"] ??
            "application/json",
        )
      : (request) => request,
  );
  const effect = HttpClient.execute(request);
  return (
    init?.redirect === "manual"
      ? effect.pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }))
      : effect
  ).pipe(Effect.mapError((cause) => new TestHttpRequestError({ cause })));
};

const jsonRequestBody = (value: unknown): string => {
  return JSON.stringify(value);
};

const responseJsonEffect = <A>(response: HttpClientResponse.HttpClientResponse) =>
  response.json.pipe(
    Effect.map((json) => json as A),
    Effect.mapError((cause) => new TestHttpRequestError({ cause })),
  );

const responseOk = (response: HttpClientResponse.HttpClientResponse) =>
  response.status >= 200 && response.status < 300;

const issueFixtureSession = (
  scopes: ReadonlyArray<AuthEnvironmentScope> = AuthAdministrativeScopes,
) =>
  testAuth.pipe(
    Effect.flatMap((auth) => auth.issueSession({ subject: "zerops-user:test", scopes })),
  );
const issueFixtureGrant = (
  scopes: ReadonlyArray<AuthEnvironmentScope> = AuthAdministrativeScopes,
) =>
  testAuth.pipe(
    Effect.flatMap((auth) =>
      auth.createPairingLink({ method: "zerops-throwaway", subject: "zerops-user:test", scopes }),
    ),
  );

const getAuthenticatedAuthorizationHeader = (credential = defaultDesktopBootstrapToken) =>
  getAuthenticatedBearerSessionToken(credential).pipe(Effect.map((token) => `Bearer ${token}`));

const getAuthenticatedBearerSessionToken = (credential = defaultDesktopBootstrapToken) =>
  Effect.gen(function* () {
    if (credential === defaultDesktopBootstrapToken) {
      const auth = yield* testAuth;
      return (yield* auth.issueSession({
        subject: "zerops-user:test",
        scopes: AuthAdministrativeScopes,
      })).token;
    }
    const { response, body } = yield* exchangeAccessToken(credential);
    if (!responseOk(response)) {
      return yield* new AuthenticationGetterError({
        message: `Expected bearer bootstrap response to succeed, got ${response.status}`,
      });
    }

    if (!body.access_token) {
      return yield* new AuthenticationGetterError({
        message: "Expected token exchange response to include an access token.",
      });
    }

    return body.access_token;
  });

const splitHeaderTokens = (value: string | null | undefined) =>
  (value ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .toSorted();

const assertBrowserApiCorsResponseHeaders = (
  headers: Readonly<Record<string, string | undefined>>,
  options?: {
    readonly origin?: string;
    readonly credentials?: boolean;
  },
) => {
  assert.equal(headers["access-control-allow-origin"], options?.origin ?? "*");
  assert.equal(
    headers["access-control-allow-credentials"],
    options?.credentials ? "true" : undefined,
  );
};

const assertBrowserApiCorsPreflightHeaders = (
  headers: Readonly<Record<string, string | undefined>>,
  options?: {
    readonly origin?: string;
    readonly credentials?: boolean;
  },
) => {
  assertBrowserApiCorsResponseHeaders(headers, options);
  assert.deepEqual(splitHeaderTokens(headers["access-control-allow-methods"] ?? null), [
    "GET",
    "HEAD",
    "OPTIONS",
    "POST",
  ]);
  assert.deepEqual(splitHeaderTokens(headers["access-control-allow-headers"]), [
    "authorization",
    "b3",
    "content-type",
    "dpop",
    "if-none-match",
    "if-range",
    "range",
    "traceparent",
  ]);
};
const crossOriginClientOrigin = "http://remote-client.test:3773";

const zeropsTestEnvironment = (publicOrigin?: string) =>
  resolveZeropsEnvironment({
    projectId: "TEST000000000000000023",
    apiHost: undefined,
    publicOrigin,
    // A test server links to no HQ that answers: never production's.
    hqOrigin: "http://127.0.0.1:9",
  });

/**
 * The link-proof endpoint only exists on a server that is running inside a
 * Zerops project and knows its own public origin: the handler resolves both
 * BEFORE it validates the caller's endpoint origin. A test that wants to
 * reach the origin rules must therefore model that server — and the Zerops
 * door issues no cookie sessions, so it authenticates with a bearer token.
 */
const zeropsLinkProofEnvironment = () =>
  zeropsTestEnvironment("https://zcp-26a7-8080.prg1.zerops.app");

const getWsServerUrl = (
  pathname = "",
  options?: { authenticated?: boolean; credential?: string },
) =>
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer;
    const address = server.address as NetAddress.InetAddress;
    const baseUrl = `ws://127.0.0.1:${address.port}${pathname}`;
    if (options?.authenticated === false) {
      return baseUrl;
    }
    return appendAuthorizationToWsUrl(
      baseUrl,
      yield* getAuthenticatedAuthorizationHeader(options?.credential),
    );
  });

it.layer(NodeServices.layer)("server router seam", (it) => {
  it.effect(
    "an exact first-frame HQ ticket opens RPC and authorizes HTTP only for its live connection",
    () =>
      Effect.gen(function* () {
        const config = yield* buildAppUnderTest({
          ticketAuth: true,
          config: { zerops: zeropsTestEnvironment() },
          layers: { terminalManager: { closeOpenedBy: () => Effect.succeed(0) } },
        });
        const { connections, tickets } = yield* testTicketState;
        yield* connections.heard({
          type: "access",
          version: 1,
          full: true,
          viewAt: "1970-01-01T00:00:00.000Z",
          members: [{ userId: "owner", role: "OWNER", visibility: "open" }],
        });
        const ticket = "ticket-on-the-first-frame";
        yield* tickets.heard({
          type: "ticket",
          ticket,
          userId: "owner",
          sessionId: "hq-owner",
          expiresIn: 60,
        });
        const before = yield* HttpClient.get("/api/auth/session", {
          headers: { authorization: `Bearer ${ticket}` },
        });
        assert.deepInclude(yield* before.json, { authenticated: false });
        const wsUrl = yield* getWsServerUrl("/ws", { authenticated: false });
        yield* withWsRpcClient(
          wsUrl,
          (client) =>
            Effect.gen(function* () {
              const remote = yield* client[WS_METHODS.serverGetConfig]({});
              assert.equal(remote.cwd, config.cwd);
              const active = yield* HttpClient.get("/api/auth/session", {
                headers: { authorization: `Bearer ${ticket}` },
              });
              assert.deepInclude(yield* active.json, { authenticated: true });
              yield* connections.closeSession("hq-owner");
              const ended = yield* HttpClient.get("/api/auth/session", {
                headers: { authorization: `Bearer ${ticket}` },
              });
              assert.deepInclude(yield* ended.json, { authenticated: false });
            }),
          undefined,
          ticket,
        ).pipe(Effect.scoped);
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("refuses a foreign Origin before upgrading the ticket WebSocket (MS1-5)", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { zerops: zeropsTestEnvironment() } });
      const url = yield* getWsServerUrl("/ws", { authenticated: false });
      const status = yield* Effect.callback<number | undefined, Error>((resume) => {
        const socket = new NodeSocket.NodeWS.WebSocket(url, {
          origin: "https://foreign.example.test",
        });
        socket.once("unexpected-response", (_request, response) => {
          response.resume();
          resume(Effect.succeed(response.statusCode));
        });
        socket.once("open", () => resume(Effect.succeed(101)));
        socket.once("error", (error) => resume(Effect.fail(error)));
        return Effect.sync(() => socket.terminate());
      });
      assert.equal(status, 403);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("serves no client bundle from a Zerops Mate even when static files exist (C-6)", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "mate-no-client-" });
      yield* fileSystem.writeFileString(
        path.join(staticDir, "index.html"),
        "<html>retired-client</html>",
      );
      yield* buildAppUnderTest({ config: { staticDir, zerops: zeropsTestEnvironment() } });
      for (const route of ["/", "/mate/", "/thread/example"]) {
        const response = yield* HttpClient.get(route);
        assert.equal(response.status, 404, route);
        assert.notInclude(yield* response.text, "retired-client", route);
      }
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("parks HTTP ingress until command readiness", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-router-gate-" });
      yield* fileSystem.writeFileString(path.join(staticDir, "index.html"), "ready");
      const entered = yield* Deferred.make<void>();
      const ready = yield* Deferred.make<void>();
      const completed = yield* Deferred.make<void>();

      yield* buildAppUnderTest({
        config: { staticDir },
        layers: {
          serverRuntimeStartup: {
            awaitCommandReady: Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(ready)),
            ),
          },
        },
      });
      const request = yield* HttpClient.get("/").pipe(
        Effect.tap(() => Deferred.succeed(completed, undefined)),
        Effect.forkChild,
      );
      yield* Deferred.await(entered);
      assert.isFalse(yield* Deferred.isDone(completed));

      yield* Deferred.succeed(ready, undefined);
      assert.equal((yield* Fiber.join(request)).status, 200);
      assert.isTrue(yield* Deferred.isDone(completed));
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("serves static index content for GET / when staticDir is configured", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-router-static-" });
      const indexPath = path.join(staticDir, "index.html");
      yield* fileSystem.writeFileString(indexPath, "<html>router-static-ok</html>");

      yield* buildAppUnderTest({ config: { staticDir } });

      const response = yield* HttpClient.get("/");
      assert.equal(response.status, 200);
      assert.include(yield* response.text, "router-static-ok");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  // The SPA catch-all answers 200 text/html for anything it does not recognise,
  // which turns a misrouted API call into "the app loads and nothing works".
  // Server routes never fall through to the shell.
  it.effect("refuses to answer unmatched server routes with the SPA shell", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-router-shell-" });
      yield* fileSystem.writeFileString(
        path.join(staticDir, "index.html"),
        "<html>router-static-ok</html>",
      );
      yield* buildAppUnderTest({ config: { staticDir } });

      for (const route of ["/api/nope", "/oauth/nope", "/.well-known/nope", "/ws/nope"]) {
        const response = yield* HttpClient.get(route);
        assert.equal(response.status, 404, route);
        assert.include(response.headers["content-type"], "application/json", route);
      }

      // An app route still gets the shell — that is what the catch-all is for.
      const appRoute = yield* HttpClient.get("/thread/42");
      assert.equal(appRoute.status, 200);
      assert.include(yield* appRoute.text, "router-static-ok");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  // The recommended proxy block strips the prefix. One written without its
  // trailing slash forwards it instead, and every route then misses — so the
  // server names that mistake rather than serving the shell over it.
  it.effect("names a forwarded base path instead of answering with the shell", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-router-prefix-" });
      yield* fileSystem.writeFileString(
        path.join(staticDir, "index.html"),
        "<html>router-static-ok</html>",
      );
      yield* buildAppUnderTest({ config: { staticDir, basePath: "/mate" } });

      const response = yield* HttpClient.get("/mate/.well-known/t3/environment");
      assert.equal(response.status, 404);
      assert.include(response.headers["content-type"], "application/json");
      assert.include(yield* response.text, "/mate");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("treats a prefix-shaped path as an app route when no prefix is configured", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-router-noprefix-",
      });
      yield* fileSystem.writeFileString(
        path.join(staticDir, "index.html"),
        "<html>router-static-ok</html>",
      );
      yield* buildAppUnderTest({ config: { staticDir } });

      const response = yield* HttpClient.get("/mate/thread/42");
      assert.equal(response.status, 200);
      assert.include(yield* response.text, "router-static-ok");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  // The immutable-cache fast path shares handleStaticAndDevRequest with the
  // SPA shell, so the base-path guard above must still run before it: an
  // asset request that still carries the configured prefix is the same
  // reverse-proxy misconfiguration as an HTML route, not a cache-friendly hit.
  it.effect("keeps the base-path guard in front of the immutable asset cache path", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-router-prefix-assets-",
      });
      yield* fileSystem.makeDirectory(path.join(staticDir, "assets"));
      yield* fileSystem.makeDirectory(path.join(staticDir, ".vite"));
      yield* fileSystem.writeFileString(
        path.join(staticDir, ".vite", "manifest.json"),
        `{"index.html": { "file": "assets/index-AbCd0123.js", "isEntry": true } }`,
      );
      yield* fileSystem.writeFileString(path.join(staticDir, "index.html"), "<html>app</html>");
      yield* fileSystem.writeFileString(
        path.join(staticDir, "assets", "index-AbCd0123.js"),
        "export const app = true;",
      );
      yield* buildAppUnderTest({ config: { staticDir, basePath: "/mate" } });

      // Reaches the app the way nginx forwards it after stripping the prefix:
      // no base path on the wire, served with the immutable cache header.
      const stripped = yield* HttpClient.get("/assets/index-AbCd0123.js");
      assert.equal(stripped.status, 200);
      assert.equal(stripped.headers["cache-control"], "public, max-age=31536000, immutable");

      // A request that still carries the prefix (a proxy_pass missing its
      // trailing slash) never reaches the asset cache path at all.
      const forwarded = yield* HttpClient.get("/mate/assets/index-AbCd0123.js");
      assert.equal(forwarded.status, 404);
      assert.include(forwarded.headers["content-type"], "application/json");
      assert.isUndefined(forwarded.headers["cache-control"]);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("revalidates static files without sending unchanged bodies", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-static-cache-" });
      const assetPath = path.join(staticDir, "app.js");
      yield* fileSystem.writeFileString(assetPath, 'export const build = "first";');
      yield* buildAppUnderTest({ config: { staticDir } });

      const initial = yield* HttpClient.get("/app.js");
      assert.equal(initial.status, 200);
      assert.equal(initial.headers["cache-control"], "no-cache");
      assert.include(yield* initial.text, "first");
      const etag = initial.headers.etag;
      assert.isDefined(etag);
      assert.isDefined(initial.headers["last-modified"]);

      for (const headers of [
        { "if-none-match": etag! },
        { "if-none-match": `"older", ${etag!.replace(/^W\//, "")}` },
        { "if-none-match": "*" },
        { "if-modified-since": initial.headers["last-modified"]! },
      ]) {
        const response = yield* HttpClient.get("/app.js", { headers });
        assert.equal(response.status, 304);
        assert.equal(response.headers.etag, etag);
        assert.equal(response.headers["cache-control"], "no-cache");
        assert.equal(yield* response.text, "");
      }

      const mismatched = yield* HttpClient.get("/app.js", {
        headers: {
          "if-none-match": '"another-build"',
          "if-modified-since": initial.headers["last-modified"]!,
        },
      });
      assert.equal(mismatched.status, 200);
      assert.include(yield* mismatched.text, "first");

      yield* fileSystem.writeFileString(assetPath, 'export const build = "the next build";');
      const changed = yield* HttpClient.get("/app.js", { headers: { "if-none-match": etag! } });
      assert.equal(changed.status, 200);
      assert.notEqual(changed.headers.etag, etag);
      assert.include(yield* changed.text, "next build");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("serves changed HTML with the same size and timestamp", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-static-html-" });
      const indexPath = path.join(staticDir, "index.html");
      const modifiedAt = DateTime.toDateUtc(DateTime.makeUnsafe("1985-10-26T08:15:00.000Z"));
      yield* fileSystem.writeFileString(indexPath, "<html>old build</html>");
      yield* fileSystem.utimes(indexPath, modifiedAt, modifiedAt);
      yield* buildAppUnderTest({ config: { staticDir } });

      const initial = yield* HttpClient.get("/");
      assert.equal(yield* initial.text, "<html>old build</html>");
      const previousEtag = initial.headers.etag ?? '"previous-html"';
      const nextHtml = "<html>new build</html>";
      yield* fileSystem.writeFileString(indexPath, nextHtml);
      yield* fileSystem.utimes(indexPath, modifiedAt, modifiedAt);

      for (const [resource, headers] of [
        ["/", { "if-none-match": previousEtag }],
        ["/threads/example", { "if-modified-since": modifiedAt.toUTCString() }],
        ["/", { "if-none-match": "*" }],
      ] as const) {
        const response = yield* HttpClient.get(resource, { headers });
        assert.equal(response.status, 200);
        assert.equal(yield* response.text, nextHtml);
        assert.equal(response.headers["cache-control"], "no-cache");
        assert.isUndefined(response.headers.etag);
        assert.isUndefined(response.headers["last-modified"]);
      }

      const head = yield* HttpClient.head("/", {
        headers: { "if-none-match": previousEtag, "accept-encoding": "identity" },
      });
      assert.equal(head.status, 200);
      assert.equal(head.headers["content-length"], String(Buffer.byteLength(nextHtml)));
      assert.equal(yield* head.text, "");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("caches hashed static assets without freezing mutable files or SPA fallbacks", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-static-hashes-" });
      yield* fileSystem.makeDirectory(path.join(staticDir, "assets"));
      yield* fileSystem.makeDirectory(path.join(staticDir, ".vite"));
      yield* fileSystem.writeFileString(
        path.join(staticDir, ".vite", "manifest.json"),
        `{
          "index.html": { "file": "assets/index-AbCd0123.js", "isEntry": true },
          "large.js": { "file": "assets/large-aBcD9876.js" }
        }`,
      );
      yield* fileSystem.writeFileString(path.join(staticDir, "index.html"), "<html>app</html>");
      yield* fileSystem.writeFileString(
        path.join(staticDir, "assets", "index-AbCd0123.js"),
        "export const app = true;",
      );
      yield* fileSystem.writeFileString(path.join(staticDir, "assets", "config.json"), "{}");
      const largeAsset = "export const value = 123;\n".repeat(8192);
      yield* fileSystem.writeFileString(
        path.join(staticDir, "assets", "large-aBcD9876.js"),
        largeAsset,
      );
      yield* buildAppUnderTest({ config: { staticDir } });

      const asset = yield* HttpClient.get("/assets/index-AbCd0123.js");
      assert.equal(asset.status, 200);
      assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable");
      assert.equal(yield* asset.text, "export const app = true;");

      const head = yield* HttpClient.head("/assets/index-AbCd0123.js", {
        headers: { "accept-encoding": "identity" },
      });
      assert.equal(head.status, 200);
      assert.equal(head.headers.etag, asset.headers.etag);
      assert.equal(head.headers["content-length"], String("export const app = true;".length));
      assert.equal(yield* head.text, "");

      const compressed = yield* HttpClient.get("/assets/large-aBcD9876.js", {
        headers: { "accept-encoding": "gzip" },
      });
      assert.equal(compressed.headers["content-encoding"], "gzip");
      assert.equal(compressed.headers.vary, "Accept-Encoding");
      assert.equal(yield* compressed.text, largeAsset);
      const compressedHead = yield* HttpClient.head("/assets/large-aBcD9876.js", {
        headers: { "accept-encoding": "gzip" },
      });
      assert.equal(compressedHead.status, 200);
      assert.equal(compressedHead.headers["content-encoding"], "gzip");
      assert.equal(compressedHead.headers.vary, "Accept-Encoding");
      assert.equal(compressedHead.headers.etag, compressed.headers.etag);
      assert.equal(compressedHead.headers["content-length"], compressed.headers["content-length"]);
      assert.equal(yield* compressedHead.text, "");
      const unchanged = yield* HttpClient.get("/assets/large-aBcD9876.js", {
        headers: { "accept-encoding": "identity", "if-none-match": compressed.headers.etag! },
      });
      assert.equal(unchanged.status, 304);
      assert.equal(unchanged.headers.vary, "Accept-Encoding");
      assert.equal(yield* unchanged.text, "");

      for (const resource of [
        "/assets/config.json",
        "/threads/example",
        "/assets/old-ZyXw9876.js",
      ]) {
        const response = yield* HttpClient.get(resource);
        assert.equal(response.status, 200);
        assert.equal(response.headers["cache-control"], "no-cache");
        assert.equal(
          yield* response.text,
          resource.endsWith("config.json") ? "{}" : "<html>app</html>",
        );
      }
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect.each(
    Array.from(
      [
        { label: "missing", contents: null },
        { label: "nonmatching", contents: '{"other.js":{"file":"assets/other-AbCd0123.js"}}' },
        { label: "malformed", contents: "{not-json" },
      ],
      (manifest) => ({
        title: `revalidates hash-like static filenames with a ${manifest.label} manifest`,
        manifest,
      }),
    ),
  )("$title", ({ manifest }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-static-mutable-",
      });
      yield* fileSystem.makeDirectory(path.join(staticDir, "assets"));
      if (manifest.contents !== null) {
        yield* fileSystem.makeDirectory(path.join(staticDir, ".vite"));
        yield* fileSystem.writeFileString(
          path.join(staticDir, ".vite", "manifest.json"),
          manifest.contents,
        );
      }
      const filePath = path.join(staticDir, "assets", "config-20260904.js");
      yield* fileSystem.writeFileString(filePath, "first config");
      yield* buildAppUnderTest({ config: { staticDir } });

      const initial = yield* HttpClient.get("/assets/config-20260904.js");
      assert.equal(initial.headers["cache-control"], "no-cache");
      assert.equal(yield* initial.text, "first config");

      yield* fileSystem.writeFileString(filePath, "replacement config");
      const changed = yield* HttpClient.get("/assets/config-20260904.js", {
        headers: { "if-none-match": initial.headers.etag! },
      });
      assert.equal(changed.status, 200);
      assert.equal(changed.headers["cache-control"], "no-cache");
      assert.notEqual(changed.headers.etag, initial.headers.etag);
      assert.equal(yield* changed.text, "replacement config");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("binds static metadata and bytes to one file across atomic replacement", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-static-replace-" });
      const beforeOpenPath = path.join(staticDir, "before-open.txt");
      const afterOpenPath = path.join(staticDir, "after-open.txt");
      const afterOpenSnapshotPath = path.join(staticDir, "after-open-snapshot.txt");
      const windowsHost = HostProcessPlatform.defaultValue() === "win32";
      const original = "original bytes";
      const replacement = "replacement bytes with a different size";
      for (const filePath of [beforeOpenPath, afterOpenPath]) {
        yield* fileSystem.writeFileString(filePath, original);
        yield* fileSystem.writeFileString(`${filePath}.next`, replacement);
      }
      if (windowsHost) {
        // Windows cannot replace an open destination, so model the race with its original handle.
        yield* fileSystem.writeFileString(afterOpenSnapshotPath, original);
      }
      const replaced = new Set<string>();
      const replaceOnce = Effect.fnUntraced(function* (filePath: string) {
        if (replaced.has(filePath)) return;
        replaced.add(filePath);
        yield* fileSystem.rename(`${filePath}.next`, filePath);
      });
      const replacingFileSystem = FileSystem.FileSystem.of({
        ...fileSystem,
        stat: (filePath) =>
          fileSystem
            .stat(filePath)
            .pipe(
              Effect.tap(() => (filePath === beforeOpenPath ? replaceOnce(filePath) : Effect.void)),
            ),
        open: (filePath, options) =>
          fileSystem
            .open(
              filePath === afterOpenPath && windowsHost ? afterOpenSnapshotPath : filePath,
              options,
            )
            .pipe(
              Effect.tap(() => (filePath === afterOpenPath ? replaceOnce(filePath) : Effect.void)),
            ),
      });
      yield* buildAppUnderTest({ config: { staticDir } }).pipe(
        Effect.provideService(FileSystem.FileSystem, replacingFileSystem),
      );

      for (const [name, expected] of [
        ["before-open.txt", replacement],
        ["after-open.txt", original],
      ] as const) {
        const response = yield* HttpClient.get(`/${name}`, {
          headers: { "accept-encoding": "identity" },
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers["content-length"], String(expected.length));
        assert.isTrue(response.headers.etag?.startsWith(`W/"${expected.length.toString(16)}-`));
        assert.equal(yield* response.text, expected);
        assert.isTrue(replaced.has(path.join(staticDir, name)));
        assert.equal(yield* fileSystem.readFileString(path.join(staticDir, name)), replacement);
      }
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("closes static file handles after GET, HEAD, 304, and request cancellation", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-static-close-" });
      const filePath = path.join(staticDir, "app.txt");
      const body = "file content\n".repeat(1024);
      yield* fileSystem.writeFileString(filePath, body);
      const closed = yield* Queue.unbounded<FileSystem.File>();
      const blocked = yield* Deferred.make<void>();
      const active = new Set<FileSystem.File>();
      let blockAfterOpen = false;
      let bodyReads = 0;
      const trackedFileSystem = FileSystem.FileSystem.of({
        ...fileSystem,
        open: (candidate, options) =>
          Effect.gen(function* () {
            if (candidate !== filePath) return yield* fileSystem.open(candidate, options);
            let opened: FileSystem.File | undefined;
            // Registered first, so this signal runs after the real descriptor-close finalizer.
            yield* Effect.addFinalizer(() =>
              Effect.gen(function* () {
                if (opened === undefined) return;
                active.delete(opened);
                yield* Queue.offer(closed, opened);
              }),
            );
            const file = yield* fileSystem.open(candidate, options);
            opened = file;
            active.add(file);
            if (blockAfterOpen) {
              yield* Deferred.succeed(blocked, undefined);
              return yield* Effect.never;
            }
            return new Proxy(file, {
              get(target, key) {
                if (key === "readAlloc") {
                  return (size: number) => {
                    bodyReads += 1;
                    return target.readAlloc(size);
                  };
                }
                return Reflect.get(target, key, target);
              },
            });
          }),
      });
      yield* buildAppUnderTest({ config: { staticDir } }).pipe(
        Effect.provideService(FileSystem.FileSystem, trackedFileSystem),
      );

      const get = yield* HttpClient.get("/app.txt");
      assert.equal(yield* get.text, body);
      yield* Queue.take(closed);
      assert.equal(active.size, 0);
      assert.isAbove(bodyReads, 0);
      const readsAfterGet = bodyReads;

      const head = yield* HttpClient.head("/app.txt", { headers: { "accept-encoding": "gzip" } });
      assert.equal(head.status, 200);
      assert.equal(head.headers["content-encoding"], "gzip");
      assert.equal(yield* head.text, "");
      yield* Queue.take(closed);
      assert.equal(active.size, 0);
      assert.equal(bodyReads, readsAfterGet);

      const unchanged = yield* HttpClient.get("/app.txt", {
        headers: { "if-none-match": get.headers.etag! },
      });
      assert.equal(unchanged.status, 304);
      yield* Queue.take(closed);
      assert.equal(active.size, 0);
      assert.equal(bodyReads, readsAfterGet);

      blockAfterOpen = true;
      const cancelled = yield* HttpClient.get("/app.txt").pipe(Effect.forkChild);
      yield* Deferred.await(blocked);
      assert.equal(active.size, 1);
      yield* Fiber.interrupt(cancelled);
      yield* Queue.take(closed);
      assert.equal(active.size, 0);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("redirects to dev URL when configured", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: { devUrl: new URL("http://127.0.0.1:5173") },
      });

      const url = yield* getHttpServerUrl("/foo/bar?token=test-token");
      const response = yield* fetchEffect(url, { redirect: "manual" });

      assert.equal(response.status, 302);
      assert.equal(response.headers.location, "http://127.0.0.1:5173/foo/bar?token=test-token");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("serves the public environment descriptor without requiring auth", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const url = yield* getHttpServerUrl("/.well-known/t3/environment");
      const response = yield* fetchEffect(url);
      const body = yield* responseJsonEffect<typeof testEnvironmentDescriptor>(response);

      assert.equal(response.status, 200);
      assert.deepEqual(body, testEnvironmentDescriptor);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  const setupDocument = {
    version: 1 as const,
    at: "2026-10-01T12:00:00Z",
    steps: [{ id: "container" as const, state: "done", at: "2026-10-01T11:50:00Z" }],
  };

  it.effect("serves a Mate's setup to any origin, without auth", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: { zerops: zeropsTestEnvironment() },
        layers: { zeropsSetup: { document: Effect.succeed(setupDocument) } },
      });
      const response = yield* fetchEffect(yield* getHttpServerUrl("/setup.json"), {
        headers: { origin: "https://somewhere-else.test" },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers["access-control-allow-origin"], "*");
      assert.deepEqual(yield* responseJsonEffect<typeof setupDocument>(response), setupDocument);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("answers 404 for the setup outside a Zerops project, as an older Mate does", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        layers: { zeropsSetup: { document: Effect.succeed(setupDocument) } },
      });
      const response = yield* fetchEffect(yield* getHttpServerUrl("/setup.json"));
      assert.equal(response.status, 404);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  // D6 over HTTP: the dispatch route admits a turn as the caller's session,
  // exactly as the socket does, and says so as a refusal, not a failure.

  it.effect(
    "An engine-native archived conversation is listed without a legacy projection row",
    () =>
      Effect.gen(function* () {
        const w = yield* makeEngineWorld({ driver: "codex" });
        yield* w.boot;
        yield* w.tell({ _tag: "Send", text: "Native archive witness" });
        yield* w.tell({ _tag: "Archive" });
        const engine = yield* w.engine;
        assert.deepEqual(
          yield* w.within(
            Effect.flatMap(
              SqlClient.SqlClient,
              (sql) => sql`SELECT name FROM sqlite_master WHERE name = 'projection_threads'`,
            ),
          ),
          [],
        );
        yield* buildAppUnderTest({
          config: {},
          layers: { mateEngine: yield* w.engine },
        });
        const wsUrl = yield* getWsServerUrl("/ws");
        yield* withWsRpcClient(wsUrl, (client) =>
          Effect.gen(function* () {
            const snapshot = yield* client[WS_METHODS.engineGetArchivedShellSnapshot]({
              protocol: MATE_ENGINE_PROTOCOLS[0]!,
            });
            assert.deepEqual(
              snapshot.threads.map(({ id, title }) => ({ id, title })),
              [{ id: ThreadId.make(imageConversation), title: "Native archive witness" }],
              "ASSERTION: the engine archive lists a native conversation without a legacy projection row",
            );
            assert.isNotNull(snapshot.threads[0]?.archivedAt);
            // Decision: server read only; P2 (open archived row read-only) stays card archive-row-open (owner).
            assert.isTrue((yield* engine.conversation(imageConversation))?.archived);
            assert.deepEqual(
              snapshot.projects.flatMap((project) =>
                snapshot.threads
                  .filter((thread) => thread.projectId === project.id)
                  .map(({ id }) => id),
              ),
              [ThreadId.make(imageConversation)],
              "ASSERTION: Settings can group the native archived row under its project",
            );
          }),
        );
        yield* w.shutdown;
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "engine archive membership replaces parked V1 membership and keeps project metadata",
    () =>
      Effect.gen(function* () {
        const w = yield* makeEngineWorld({ driver: "codex" });
        yield* w.boot;
        yield* w.tell({ _tag: "Send", text: "Engine archive membership" });
        const config = yield* buildAppUnderTest({
          config: {},
          layers: {
            mateEngine: yield* w.engine,
            projectionSnapshotQuery: {
              getArchivedShellSnapshot: () =>
                Effect.die("The engine archive must not read V1 rows"),
            },
          },
        });
        const wsUrl = yield* getWsServerUrl("/ws");
        yield* withWsRpcClient(wsUrl, (client) =>
          Effect.gen(function* () {
            for (const archived of [true, false, true]) {
              yield* w.tell({ _tag: archived ? "Archive" : "Unarchive" });
              const snapshot = yield* client[WS_METHODS.engineGetArchivedShellSnapshot]({
                protocol: MATE_ENGINE_PROTOCOLS[0]!,
              });
              assert.deepEqual(
                snapshot.threads.map(({ id }) => id),
                archived ? [ThreadId.make(imageConversation)] : [],
              );
              assert.deepEqual(
                snapshot.projects.map(({ id, title, workspaceRoot }) => ({
                  id,
                  title,
                  workspaceRoot,
                })),
                archived ? [{ id: "mate-engine", title: "Mate", workspaceRoot: config.cwd }] : [],
              );
              if (archived) assert.equal(snapshot.threads[0]?.projectId, "mate-engine");
            }
          }),
        );
        yield* w.shutdown;
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "an engine screenshot resolves through the asset RPC and serves its protected bytes",
    () =>
      Effect.gen(function* () {
        const w = yield* makeEngineWorld({ driver: "codex" });
        yield* w.boot;
        yield* w.tell({ _tag: "Send", text: "Check the page" });
        const config = yield* buildAppUnderTest({
          config: {},
          layers: { mateEngine: yield* w.engine },
        });
        const bytes = yield* Effect.promise(() =>
          sharp({ create: { width: 120, height: 80, channels: 4, background: "blue" } })
            .png()
            .toBuffer(),
        );
        const image = yield* Effect.promise(() =>
          contentAssetsAt(config.stateDir).ingestBytes(bytes, {
            threadId: ThreadId.make(`${imageConversation}/s/1`),
            ownerId: "browser",
            name: "screenshot.png",
            provenance: "capture",
          }),
        );
        const wsUrl = yield* getWsServerUrl("/ws");
        yield* withWsRpcClient(wsUrl, (client) =>
          Effect.gen(function* () {
            const result = yield* client[WS_METHODS.assetsCreateUrl]({
              resource: {
                _tag: "media-file",
                threadId: ThreadId.make(imageConversation),
                path: `mate-asset:${image.id}`,
              },
              imageMode: "reference",
              preview: { width: 60, height: 40 },
            }).pipe(Effect.result);
            assert.equal(
              result._tag,
              "Success",
              "ASSERTION: engine screenshot metadata resolves over the real asset RPC",
            );
            if (result._tag !== "Success") return;
            const response = yield* HttpClient.get(result.success.relativeUrl, {
              headers: { authorization: yield* getAuthenticatedAuthorizationHeader() },
            });
            assert.equal(
              response.status,
              200,
              "ASSERTION: the real asset route serves an engine screenshot",
            );
            assert.isAbove((yield* response.arrayBuffer).byteLength, 0);
          }),
        );
        yield* w.shutdown;
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    'refuses a V1 command over the socket, before admission, once the Mate engine owns the conversation: "This Mate moved to its new engine. Reload or update this app to keep talking to it."',
    () =>
      Effect.gen(function* () {
        const dispatched: Array<string> = [];
        yield* buildAppUnderTest({
          config: {},
          layers: {
            orchestrationEngine: {
              dispatch: (command) =>
                Effect.sync(() => void dispatched.push(command.type)).pipe(
                  Effect.as({ sequence: 1 }),
                ),
            },
          },
        });

        const wsUrl = yield* getWsServerUrl("/ws");
        const refused = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
              type: "thread.turn.start",
              commandId: CommandId.make("cmd-engine-moved"),
              threadId: defaultThreadId,
              message: {
                messageId: MessageId.make("msg-engine-moved"),
                role: "user",
                text: "hello",
                attachments: [],
              },
              runtimeMode: "full-access",
              interactionMode: "default",
              createdAt: "2026-10-07T10:00:00.000Z",
            }).pipe(Effect.flip),
          ),
        );

        assert.equal(
          refused.message,
          "This Mate moved to its new engine. Reload or update this app to keep talking to it.",
        );
        assert.deepEqual(dispatched, []);
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("refuses to clone a project into V1 once the Mate engine owns the conversation", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parentDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-engine-clone-" });
      const touched: Array<string> = [];
      yield* buildAppUnderTest({
        config: {},
        layers: {
          orchestrationEngine: {
            dispatch: (command) =>
              Effect.sync(() => void touched.push(command.type)).pipe(Effect.as({ sequence: 1 })),
          },
          sourceControlRepositoryService: {
            prepareClone: (input) =>
              Effect.sync(() => void touched.push("prepareClone")).pipe(
                Effect.as({
                  destinationPath: input.destinationPath,
                  remoteUrl: input.remoteUrl ?? "",
                  cloneUrl: input.remoteUrl ?? "",
                  repository: null,
                }),
              ),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const refused = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectCloneStart]({
            projectId: ProjectId.make("project-engine-clone"),
            title: "t3code",
            createdAt: "2026-10-07T10:00:00.000Z",
            remoteUrl: "git@github.com:octocat/t3code.git",
            destinationPath: path.join(parentDir, "t3code"),
          }).pipe(Effect.flip),
        ),
      );

      assert.equal(refused.message, ENGINE_MOVED);
      assert.deepEqual(touched, []);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "a send refused because the Mate engine owns the conversation claims none of its uploads",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* buildAppUnderTest({ config: {} });
        const wsUrl = yield* getWsServerUrl("/ws");
        const upload = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.attachmentsCreateUploadUrl]({
              name: "screenshot.png",
              mimeType: "image/png",
              sizeBytes: 6,
            }),
          ),
        );
        const uploaded = yield* HttpClient.post(upload.relativeUrl, {
          body: HttpBody.uint8Array(new Uint8Array([1, 2, 3, 4, 5, 6]), "image/png"),
        });
        assert.equal(uploaded.status, 204);

        const response = yield* fetchEffect(
          yield* getHttpServerUrl("/api/orchestration/dispatch"),
          {
            method: "POST",
            headers: {
              authorization: yield* getAuthenticatedAuthorizationHeader(),
              "content-type": "application/json",
            },
            body: jsonRequestBody({
              type: "thread.turn.start",
              commandId: CommandId.make("cmd-http-engine-moved-upload"),
              threadId: defaultThreadId,
              message: {
                messageId: MessageId.make("msg-http-engine-moved-upload"),
                role: "user",
                text: "hello",
                attachments: [
                  {
                    type: "image",
                    id: upload.attachmentId,
                    name: "screenshot.png",
                    mimeType: "image/png",
                    sizeBytes: 6,
                  },
                ],
              },
              runtimeMode: "full-access",
              interactionMode: "default",
              createdAt: "2026-10-07T10:00:00.000Z",
            }),
          },
        );

        assert.equal(response.status, 403);
        // Refused before the claim: no copy under a thread, only the pending upload the sweep
        // collects, exactly as after any other failed send.
        assert.deepEqual(yield* fileSystem.readDirectory(config.attachmentsDir), [
          `${upload.attachmentId}.png`,
        ]);
        assert.isTrue(
          yield* fileSystem.exists(path.join(config.attachmentsDir, `${upload.attachmentId}.png`)),
        );
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("refuses a V1 command over HTTP once the Mate engine owns the conversation", () =>
    Effect.gen(function* () {
      const dispatched: Array<string> = [];
      yield* buildAppUnderTest({
        config: {},
        layers: {
          orchestrationEngine: {
            dispatch: (command) =>
              Effect.sync(() => void dispatched.push(command.type)).pipe(
                Effect.as({ sequence: 1 }),
              ),
          },
        },
      });

      const response = yield* fetchEffect(yield* getHttpServerUrl("/api/orchestration/dispatch"), {
        method: "POST",
        headers: {
          authorization: yield* getAuthenticatedAuthorizationHeader(),
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-http-engine-moved"),
          threadId: defaultThreadId,
          message: {
            messageId: MessageId.make("msg-http-engine-moved"),
            role: "user",
            text: "hello",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: "2026-10-07T10:00:00.000Z",
        }),
      });
      const body = yield* responseJsonEffect<{ readonly reason?: string }>(response);

      assert.equal(response.status, 403);
      assert.equal(body.reason, "engine_moved");
      assert.deepEqual(dispatched, []);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("compresses large JSON responses through the composed routes", () =>
    Effect.gen(function* () {
      const descriptor = {
        ...testEnvironmentDescriptor,
        label: "Test environment".repeat(100),
      };
      yield* buildAppUnderTest({
        layers: {
          serverEnvironment: {
            getDescriptor: Effect.succeed(descriptor),
          },
        },
      });

      const url = yield* getHttpServerUrl("/.well-known/t3/environment");
      const response = yield* fetchEffect(url, {
        headers: {
          "accept-encoding": "gzip",
        },
      });
      const body = yield* responseJsonEffect<typeof descriptor>(response);

      assert.equal(response.status, 200);
      assert.equal(response.headers["content-encoding"], "gzip");
      assert.equal(response.headers.vary, "Accept-Encoding");
      assert.deepEqual(body, descriptor);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("includes CORS headers on public environment descriptor responses", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const url = yield* getHttpServerUrl("/.well-known/t3/environment");
      const response = yield* fetchEffect(url, {
        headers: {
          origin: crossOriginClientOrigin,
        },
      });
      const body = yield* responseJsonEffect<typeof testEnvironmentDescriptor>(response);

      assert.equal(response.status, 200);
      assertBrowserApiCorsResponseHeaders(response.headers);
      assert.deepEqual(body, testEnvironmentDescriptor);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("reports unauthenticated session state without requiring auth", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const url = yield* getHttpServerUrl("/api/auth/session");
      const response = yield* fetchEffect(url);
      const body = yield* responseJsonEffect<{
        readonly authenticated: boolean;
        readonly auth: {
          readonly policy: string;
          readonly bootstrapMethods: ReadonlyArray<string>;
          readonly sessionMethods: ReadonlyArray<string>;
          readonly sessionCookieName: string;
        };
      }>(response);

      assert.equal(response.status, 200);
      assert.equal(body.authenticated, false);
      assert.equal(body.auth.policy, "desktop-managed-local");
      assert.deepEqual(body.auth.bootstrapMethods, []);
      assert.deepEqual(body.auth.sessionMethods, ["bearer-access-token", "dpop-access-token"]);
      // Desktop, so port-scoped: instances scan for a free port and share
      // 127.0.0.1, and cookies are not scoped by port.
      assert.isTrue(body.auth.sessionCookieName.startsWith("t3_session_"));
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("exchanges a bootstrap grant for a scoped bearer access token", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { zerops: zeropsTestEnvironment() } });

      const { response: tokenResponse, body: tokenBody } = yield* exchangeAccessToken();

      assert.equal(tokenResponse.status, 200);
      assert.equal(tokenBody.issued_token_type, AuthAccessTokenType);
      assert.equal(tokenBody.token_type, "Bearer");
      assert.equal(
        tokenBody.scope,
        "orchestration:read orchestration:operate terminal:operate review:write relay:read access:read access:write relay:write",
      );
      assert.equal(typeof tokenBody.access_token, "string");

      const sessionUrl = yield* getHttpServerUrl("/api/auth/session");
      const sessionResponse = yield* fetchEffect(sessionUrl, {
        headers: {
          authorization: `Bearer ${tokenBody.access_token ?? ""}`,
        },
      });
      const sessionBody = yield* responseJsonEffect<{
        readonly authenticated: boolean;
        readonly sessionMethod?: string;
        readonly scopes?: ReadonlyArray<string>;
      }>(sessionResponse);

      assert.equal(sessionResponse.status, 200);
      assert.equal(sessionBody.authenticated, true);
      assert.equal(sessionBody.sessionMethod, "bearer-access-token");
      assert.deepEqual(sessionBody.scopes, [
        "orchestration:read",
        "orchestration:operate",
        "terminal:operate",
        "review:write",
        "relay:read",
        "access:read",
        "access:write",
        "relay:write",
      ]);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("persists token exchange client display metadata for authorized-client listings", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: {
          host: "0.0.0.0",
          zerops: zeropsTestEnvironment(),
        },
      });

      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const pairingBody = yield* issueFixtureGrant(AuthStandardClientScopes);

      const { response } = yield* exchangeAccessToken(pairingBody.credential, {
        headers: {
          "user-agent": "undici",
        },
        scope: "orchestration:read orchestration:operate terminal:operate review:write",
        clientMetadata: {
          label: "T3 Code Mobile",
          deviceType: "mobile",
          os: "iOS",
        },
      });

      const clientsResponse = yield* HttpClient.get("/api/auth/clients", {
        headers: {
          authorization: ownerCookie,
        },
      });
      const clients = (yield* clientsResponse.json) as ReadonlyArray<{
        readonly current: boolean;
        readonly client: {
          readonly label?: string;
          readonly deviceType: string;
          readonly ipAddress?: string;
          readonly os?: string;
          readonly userAgent?: string;
        };
      }>;
      const mobileClient = clients.find((client) => !client.current);

      assert.equal(response.status, 200);
      assert.equal(clientsResponse.status, 200);
      assert.deepInclude(mobileClient?.client, {
        label: "T3 Code Mobile",
        deviceType: "mobile",
        os: "iOS",
        ipAddress: "127.0.0.1",
        userAgent: "undici",
      });
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "exchanges a bootstrap credential for a DPoP-bound access token without bearer downgrade",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest({ config: { zerops: zeropsTestEnvironment() } });

        const credential = yield* issueFixtureGrant(AuthStandardClientScopes);
        const tokenUrl = yield* getHttpServerUrl("/oauth/token");
        const now = yield* DateTime.now;
        const tokenProof = makeDpopProof({
          method: "POST",
          url: tokenUrl,
          iat: Math.floor(now.epochMilliseconds / 1_000),
          jti: "token-exchange-proof",
        });
        const tokenResponse = yield* fetchEffect(tokenUrl, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            dpop: tokenProof.proof,
          },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
            subject_token: credential.credential,
            subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
            requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
            scope: "orchestration:read orchestration:operate terminal:operate review:write",
          }).toString(),
        });
        const token = yield* responseJsonEffect<{
          readonly access_token: string;
          readonly token_type: string;
        }>(tokenResponse);

        assert.equal(tokenResponse.status, 200);
        assert.equal(tokenResponse.headers["cache-control"], "no-store");
        assert.equal(token.token_type, "DPoP");

        const sessionUrl = yield* getHttpServerUrl("/api/auth/session");
        const bearerResponse = yield* fetchEffect(sessionUrl, {
          headers: { authorization: `Bearer ${token.access_token}` },
        });
        const bearerState = yield* responseJsonEffect<{ readonly authenticated: boolean }>(
          bearerResponse,
        );
        assert.equal(bearerState.authenticated, false);

        const sessionProof = makeDpopProof({
          method: "GET",
          url: sessionUrl,
          iat: Math.floor(now.epochMilliseconds / 1_000),
          jti: "session-proof",
          accessToken: token.access_token,
          privateKey: tokenProof.privateKey,
          publicJwk: tokenProof.publicJwk,
        });
        const dpopResponse = yield* fetchEffect(sessionUrl, {
          headers: {
            authorization: `DPoP ${token.access_token}`,
            dpop: sessionProof.proof,
          },
        });
        const dpopState = yield* responseJsonEffect<{
          readonly authenticated: boolean;
          readonly sessionMethod?: string;
        }>(dpopResponse);
        assert.equal(dpopState.authenticated, true);
        assert.equal(dpopState.sessionMethod, "dpop-access-token");
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects token exchange DPoP proofs bound to spoofed forwarded hosts", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { zerops: zeropsTestEnvironment() } });

      const credential = yield* issueFixtureGrant(AuthStandardClientScopes);
      const tokenUrl = yield* getHttpServerUrl("/oauth/token");
      const spoofedUrl = new URL(tokenUrl);
      spoofedUrl.hostname = "environment.example.test";
      const now = yield* DateTime.now;
      const dpop = makeDpopProof({
        method: "POST",
        url: spoofedUrl.href,
        iat: Math.floor(now.epochMilliseconds / 1_000),
      });

      const bootstrap = yield* exchangeAccessToken(credential.credential, {
        headers: {
          dpop: dpop.proof,
          "x-forwarded-host": spoofedUrl.host,
        },
        scope: "orchestration:read orchestration:operate terminal:operate review:write",
      });

      assert.equal(bootstrap.response.status, 401);
      assert.equal(bootstrap.body._tag, "EnvironmentAuthInvalidError");
      assert.equal(bootstrap.body.code, "auth_invalid");
      assert.equal(bootstrap.body.reason, "invalid_credential");
      assert.equal(typeof bootstrap.body.traceId, "string");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects replayed DPoP proofs across token exchanges", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { zerops: zeropsTestEnvironment() } });

      const firstCredential = yield* issueFixtureGrant(AuthStandardClientScopes);
      const secondCredential = yield* issueFixtureGrant(AuthStandardClientScopes);
      const tokenUrl = yield* getHttpServerUrl("/oauth/token");
      const now = yield* DateTime.now;
      const dpop = makeDpopProof({
        method: "POST",
        url: tokenUrl,
        iat: Math.floor(now.epochMilliseconds / 1_000),
      });

      const firstBootstrap = yield* exchangeAccessToken(firstCredential.credential, {
        headers: {
          dpop: dpop.proof,
        },
        scope: "orchestration:read orchestration:operate terminal:operate review:write",
      });
      const replayBootstrap = yield* exchangeAccessToken(secondCredential.credential, {
        headers: {
          dpop: dpop.proof,
        },
        scope: "orchestration:read orchestration:operate terminal:operate review:write",
      });

      assert.equal(firstBootstrap.response.status, 200);
      assert.equal(replayBootstrap.response.status, 401);
      assert.equal(replayBootstrap.body._tag, "EnvironmentAuthInvalidError");
      assert.equal(replayBootstrap.body.code, "auth_invalid");
      assert.equal(replayBootstrap.body.reason, "invalid_credential");
      assert.equal(typeof replayBootstrap.body.traceId, "string");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects a DPoP replay by time alone once its marker can be pruned", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { zerops: zeropsTestEnvironment() } });

      const tokenUrl = yield* getHttpServerUrl("/oauth/token");
      const acceptedAt = yield* DateTime.now;
      // The longest-lived proof: `iat` at the 5 s future skew the verifier allows.
      const dpop = makeDpopProof({
        method: "POST",
        url: tokenUrl,
        iat: Math.floor(acceptedAt.epochMilliseconds / 1_000) + 5,
      });
      // Fixture grants are single-use, so each exchange carries a fresh one.
      const exchange = Effect.gen(function* () {
        const credential = yield* issueFixtureGrant(AuthStandardClientScopes);
        return yield* exchangeAccessToken(credential.credential, {
          headers: { dpop: dpop.proof },
          scope: "orchestration:read orchestration:operate terminal:operate review:write",
        });
      });

      assert.equal((yield* exchange).response.status, 200);
      assert.equal((yield* exchange).response.status, 401);
      // Once the marker can be pruned, the proof is past its time window.
      yield* TestClock.setTime(
        acceptedAt.epochMilliseconds + Duration.toMillis(REPLAY_MARKER_MAX_AGE),
      );
      assert.equal((yield* exchange).response.status, 401);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("ignores forwarded host headers when validating token exchange DPoP URLs", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { zerops: zeropsTestEnvironment() } });

      const credential = yield* issueFixtureGrant(AuthStandardClientScopes);
      const tokenUrl = yield* getHttpServerUrl("/oauth/token");
      const now = yield* DateTime.now;
      const dpop = makeDpopProof({
        method: "POST",
        url: tokenUrl,
        iat: Math.floor(now.epochMilliseconds / 1_000),
      });

      const bootstrap = yield* exchangeAccessToken(credential.credential, {
        headers: {
          dpop: dpop.proof,
          "x-forwarded-host": "environment.example.test",
        },
        scope: "orchestration:read orchestration:operate terminal:operate review:write",
      });

      assert.equal(bootstrap.response.status, 200);
      assert.equal(bootstrap.body.token_type, "DPoP");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects cloud link proofs for non-loopback managed endpoint origins", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { zerops: zeropsLinkProofEnvironment() } });

      const bearer = yield* getAuthenticatedBearerSessionToken();
      const linkProofUrl = yield* getHttpServerUrl("/api/connect/link-proof");
      const linkProofResponse = yield* fetchEffect(linkProofUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          challenge: "relay-link-challenge",
          relayIssuer: "https://relay.example.test",
          endpoint: {
            httpBaseUrl: "https://environment.example.test/",
            wsBaseUrl: "wss://environment.example.test/ws",
            providerKind: "manual",
          },
          origin: {
            localHttpHost: "192.168.1.42",
            localHttpPort: 3773,
          },
        }),
      });
      const body = yield* responseJsonEffect<{
        readonly _tag?: string;
        readonly message?: string;
      }>(linkProofResponse);

      assert.equal(linkProofResponse.status, 400);
      assert.equal(body._tag, "EnvironmentHttpBadRequestError");
      assert.equal(body.message, "Invalid managed endpoint origin.");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects cloud link proofs for unsupported endpoint providers", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { zerops: zeropsLinkProofEnvironment() } });

      const bearer = yield* getAuthenticatedBearerSessionToken();
      const linkProofUrl = yield* getHttpServerUrl("/api/connect/link-proof");
      const serverPort = Number(new URL(linkProofUrl).port);
      const linkProofResponse = yield* fetchEffect(linkProofUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          challenge: "relay-link-challenge",
          relayIssuer: "https://relay.example.test",
          endpoint: {
            httpBaseUrl: linkProofUrl.replace("/api/connect/link-proof", ""),
            wsBaseUrl: linkProofUrl
              .replace("http://", "ws://")
              .replace("/api/connect/link-proof", "/ws"),
            // "manual" and "cloudflare_tunnel" are supported; "t3_relay" is not.
            providerKind: "t3_relay",
          },
          origin: {
            localHttpHost: "127.0.0.1",
            localHttpPort: serverPort,
          },
        }),
      });
      const body = yield* responseJsonEffect<{
        readonly _tag?: string;
        readonly message?: string;
      }>(linkProofResponse);

      assert.equal(linkProofResponse.status, 400);
      assert.equal(body._tag, "EnvironmentHttpBadRequestError");
      assert.equal(body.message, "Invalid managed endpoint origin.");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects cloud link proofs requested through a public managed endpoint", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const linkProofUrl = yield* getHttpServerUrl("/api/connect/link-proof");
      const serverPort = Number(new URL(linkProofUrl).port);
      const linkProofResponse = yield* HttpClient.post("/api/connect/link-proof", {
        headers: {
          authorization: yield* getAuthenticatedAuthorizationHeader(),
          "content-type": "application/json",
          host: "environment.example.test",
          "x-forwarded-host": "environment.example.test",
          "x-forwarded-proto": "https",
        },
        body: HttpBody.text(
          jsonRequestBody({
            challenge: "relay-link-challenge",
            relayIssuer: "https://relay.example.test",
            endpoint: {
              httpBaseUrl: "https://environment.example.test/",
              wsBaseUrl: "wss://environment.example.test/ws",
              providerKind: "manual",
            },
            origin: {
              localHttpHost: "127.0.0.1",
              localHttpPort: serverPort,
            },
          }),
          "application/json",
        ),
      });
      const body = (yield* linkProofResponse.json) as {
        readonly _tag?: string;
        readonly message?: string;
      };

      assert.equal(linkProofResponse.status, 400);
      assert.equal(body._tag, "EnvironmentHttpBadRequestError");
      assert.equal(body.message, "Invalid managed endpoint origin.");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "rejects cloud link proofs when a public request spoofs loopback forwarded headers",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest();

        const linkProofUrl = yield* getHttpServerUrl("/api/connect/link-proof");
        const serverPort = Number(new URL(linkProofUrl).port);
        const linkProofResponse = yield* HttpClient.post("/api/connect/link-proof", {
          headers: {
            authorization: yield* getAuthenticatedAuthorizationHeader(),
            "content-type": "application/json",
            host: "environment.example.test",
            "x-forwarded-host": `127.0.0.1:${serverPort}`,
            "x-forwarded-proto": "http",
          },
          body: HttpBody.text(
            jsonRequestBody({
              challenge: "relay-link-challenge",
              relayIssuer: "https://relay.example.test",
              endpoint: {
                httpBaseUrl: "https://environment.example.test/",
                wsBaseUrl: "wss://environment.example.test/ws",
                providerKind: "manual",
              },
              origin: {
                localHttpHost: "127.0.0.1",
                localHttpPort: serverPort,
              },
            }),
            "application/json",
          ),
        });
        const body = (yield* linkProofResponse.json) as {
          readonly _tag?: string;
          readonly message?: string;
        };

        assert.equal(linkProofResponse.status, 400);
        assert.equal(body._tag, "EnvironmentHttpBadRequestError");
        assert.equal(body.message, "Invalid managed endpoint origin.");
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects cloud link proofs with malformed forwarded request hosts", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const linkProofUrl = yield* getHttpServerUrl("/api/connect/link-proof");
      const serverPort = Number(new URL(linkProofUrl).port);
      const linkProofResponse = yield* HttpClient.post("/api/connect/link-proof", {
        headers: {
          authorization: yield* getAuthenticatedAuthorizationHeader(),
          "content-type": "application/json",
          host: "bad host",
          "x-forwarded-host": "bad host",
          "x-forwarded-proto": "https",
        },
        body: HttpBody.text(
          jsonRequestBody({
            challenge: "relay-link-challenge",
            relayIssuer: "https://relay.example.test",
            endpoint: {
              httpBaseUrl: "https://environment.example.test/",
              wsBaseUrl: "wss://environment.example.test/ws",
              providerKind: "manual",
            },
            origin: {
              localHttpHost: "127.0.0.1",
              localHttpPort: serverPort,
            },
          }),
          "application/json",
        ),
      });
      const body = (yield* linkProofResponse.json) as {
        readonly _tag?: string;
        readonly message?: string;
      };

      assert.equal(linkProofResponse.status, 400);
      assert.equal(body._tag, "EnvironmentHttpBadRequestError");
      assert.equal(body.message, "Invalid managed endpoint origin.");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects local cloud link proofs for a different loopback port", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { zerops: zeropsLinkProofEnvironment() } });

      const bearer = yield* getAuthenticatedBearerSessionToken();
      const linkProofUrl = yield* getHttpServerUrl("/api/connect/link-proof");
      const serverPort = Number(new URL(linkProofUrl).port);
      const linkProofResponse = yield* fetchEffect(linkProofUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          challenge: "relay-link-challenge",
          relayIssuer: "https://relay.example.test",
          endpoint: {
            httpBaseUrl: "https://environment.example.test/",
            wsBaseUrl: "wss://environment.example.test/ws",
            providerKind: "manual",
          },
          origin: {
            localHttpHost: "127.0.0.1",
            localHttpPort: serverPort === 65_535 ? serverPort - 1 : serverPort + 1,
          },
        }),
      });
      const body = yield* responseJsonEffect<{
        readonly _tag?: string;
        readonly message?: string;
      }>(linkProofResponse);

      assert.equal(linkProofResponse.status, 400);
      assert.equal(body._tag, "EnvironmentHttpBadRequestError");
      assert.equal(body.message, "Invalid managed endpoint origin.");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("allows standard clients to read managed relay configuration state", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const pairedCookie = `Bearer ${(yield* issueFixtureSession(AuthStandardClientScopes)).token}`;
      const linkStateUrl = yield* getHttpServerUrl("/api/connect/link-state");
      const response = yield* fetchEffect(linkStateUrl, {
        headers: { authorization: pairedCookie },
      });
      const body = yield* responseJsonEffect<{
        readonly linked?: boolean;
        readonly publishAgentActivity?: boolean;
      }>(response);

      assert.equal(response.status, 200);
      assert.equal(body.linked, false);
      assert.equal(body.publishAgentActivity, false);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "reports relay client status and streams installation progress over environment RPC",
    () =>
      Effect.gen(function* () {
        const installedRelayClient = {
          status: "available" as const,
          executablePath: "/tmp/t3/tools/cloudflared",
          source: "managed" as const,
          version: RelayClient.CLOUDFLARED_VERSION,
        };
        yield* buildAppUnderTest({
          layers: {
            relayClient: {
              resolve: Effect.succeed({
                status: "missing",
                version: RelayClient.CLOUDFLARED_VERSION,
              }),
              install: Effect.succeed(installedRelayClient),
              installWithProgress: (report) =>
                report({ type: "progress", stage: "checking" }).pipe(
                  Effect.andThen(report({ type: "progress", stage: "downloading" })),
                  Effect.as(installedRelayClient),
                ),
            },
          },
        });

        const wsUrl = yield* getWsServerUrl("/ws");
        const status = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) => client[WS_METHODS.cloudGetRelayClientStatus]({})),
        );
        const installEvents = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.cloudInstallRelayClient]({}).pipe(Stream.runCollect),
          ),
        );

        assert.equal(status.status, "missing");
        assert.deepEqual(Array.from(installEvents), [
          { type: "progress", stage: "checking" },
          { type: "progress", stage: "downloading" },
          { type: "complete", status: installedRelayClient },
        ]);
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("requires relay write scope to update agent activity publication", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const preferencesUrl = yield* getHttpServerUrl("/api/connect/preferences");
      const ownerResponse = yield* fetchEffect(preferencesUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({ publishAgentActivity: true }),
      });
      const ownerBody = yield* responseJsonEffect<{
        readonly publishAgentActivity?: boolean;
      }>(ownerResponse);
      assert.equal(ownerResponse.status, 200);
      assert.equal(ownerBody.publishAgentActivity, true);

      const pairedCookie = `Bearer ${(yield* issueFixtureSession(AuthStandardClientScopes)).token}`;
      const pairedResponse = yield* fetchEffect(preferencesUrl, {
        method: "POST",
        headers: {
          authorization: pairedCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({ publishAgentActivity: false }),
      });
      const pairedBody = yield* responseJsonEffect<{
        readonly _tag?: string;
        readonly requiredScope?: string;
      }>(pairedResponse);
      assert.equal(pairedResponse.status, 403);
      assert.equal(pairedBody._tag, "EnvironmentScopeRequiredError");
      assert.equal(pairedBody.requiredScope, "relay:write");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("wakes the agent awareness relay when this server links or changes publishing", () =>
    Effect.gen(function* () {
      let catchUpRequests = 0;
      yield* buildAppUnderTest({
        layers: {
          agentAwarenessRelay: {
            requestCatchUp: () =>
              Effect.sync(() => {
                catchUpRequests += 1;
              }),
          },
        },
      });

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const authorization = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigResponse = yield* fetchEffect(
        yield* getHttpServerUrl("/api/connect/relay-config"),
        {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: jsonRequestBody({
            relayUrl: "https://relay.example.test",
            cloudUserId: "user_123",
            environmentCredential: "t3env_test_credential",
            cloudMintPublicKey: cloudKeyPair.publicKey,
            endpointRuntime: null,
          }),
        },
      );
      assert.equal(relayConfigResponse.status, 200);
      assert.equal(catchUpRequests, 1);

      const preferencesResponse = yield* fetchEffect(
        yield* getHttpServerUrl("/api/connect/preferences"),
        {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: jsonRequestBody({ publishAgentActivity: true }),
        },
      );
      assert.equal(preferencesResponse.status, 200);
      assert.equal(catchUpRequests, 2);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects relay config with an invalid cloud mint public key", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://relay.example.test",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: "not-a-public-key",
          endpointRuntime: null,
        }),
      });
      const body = yield* responseJsonEffect<{
        readonly _tag?: string;
        readonly message?: string;
      }>(relayConfigResponse);

      assert.equal(relayConfigResponse.status, 400);
      assert.equal(body._tag, "EnvironmentHttpBadRequestError");
      assert.equal(body.message, "Cloud mint public key must be a valid Ed25519 public key.");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects relay config with insecure relay metadata or empty credentials", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const postRelayConfig = (body: {
        readonly relayUrl: string;
        readonly relayIssuer?: string;
        readonly cloudUserId: string;
        readonly environmentCredential: string;
      }) =>
        fetchEffect(relayConfigUrl, {
          method: "POST",
          headers: {
            authorization: ownerCookie,
            "content-type": "application/json",
          },
          body: jsonRequestBody({
            ...body,
            cloudMintPublicKey: cloudKeyPair.publicKey,
            endpointRuntime: null,
          }),
        });

      const insecureRelayUrl = yield* postRelayConfig({
        relayUrl: "http://relay.example.test",
        cloudUserId: "user_123",
        environmentCredential: "t3env_test_credential",
      });
      const insecureRelayIssuer = yield* postRelayConfig({
        relayUrl: "https://relay.example.test",
        cloudUserId: "user_123",
        relayIssuer: "http://relay.example.test",
        environmentCredential: "t3env_test_credential",
      });
      const nonOriginRelayUrl = yield* postRelayConfig({
        relayUrl: "https://relay.example.test/path",
        cloudUserId: "user_123",
        environmentCredential: "t3env_test_credential",
      });
      const emptyCredential = yield* postRelayConfig({
        relayUrl: "https://relay.example.test",
        cloudUserId: "user_123",
        environmentCredential: "   ",
      });
      const insecureRelayUrlBody = yield* responseJsonEffect<{ readonly message?: string }>(
        insecureRelayUrl,
      );
      const insecureRelayIssuerBody = yield* responseJsonEffect<{ readonly message?: string }>(
        insecureRelayIssuer,
      );
      const nonOriginRelayUrlBody = yield* responseJsonEffect<{ readonly message?: string }>(
        nonOriginRelayUrl,
      );
      const emptyCredentialBody = yield* responseJsonEffect<{ readonly message?: string }>(
        emptyCredential,
      );

      assert.equal(insecureRelayUrl.status, 400);
      assert.equal(insecureRelayUrlBody.message, "Relay URL must be a secure absolute HTTPS URL.");
      assert.equal(insecureRelayIssuer.status, 400);
      assert.equal(
        insecureRelayIssuerBody.message,
        "Relay issuer must be a secure absolute HTTPS URL.",
      );
      assert.equal(nonOriginRelayUrl.status, 400);
      assert.equal(nonOriginRelayUrlBody.message, "Relay URL must be a secure absolute HTTPS URL.");
      assert.equal(emptyCredential.status, 400);
      assert.equal(emptyCredentialBody.message, "Relay environment credential is required.");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects relay config replacement from a different cloud account", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const postRelayConfig = (cloudUserId: string, environmentCredential: string) =>
        fetchEffect(relayConfigUrl, {
          method: "POST",
          headers: {
            authorization: ownerCookie,
            "content-type": "application/json",
          },
          body: jsonRequestBody({
            relayUrl: "https://relay.example.test",
            cloudUserId,
            environmentCredential,
            cloudMintPublicKey: cloudKeyPair.publicKey,
            endpointRuntime: null,
          }),
        });

      const firstResponse = yield* postRelayConfig("user_123", "t3env_first_credential");
      const replacementResponse = yield* postRelayConfig("user_456", "t3env_second_credential");
      const replacementBody = yield* responseJsonEffect<{
        readonly _tag?: string;
        readonly message?: string;
      }>(replacementResponse);

      assert.equal(firstResponse.status, 200);
      assert.equal(replacementResponse.status, 409);
      assert.equal(replacementBody._tag, "EnvironmentHttpConflictError");
      assert.equal(
        replacementBody.message,
        "This environment is already linked to a different cloud account. Unlink it before switching accounts.",
      );
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("reports local cloud link state from persisted relay config", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const linkStateUrl = yield* getHttpServerUrl("/api/connect/link-state");
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");

      const initialResponse = yield* fetchEffect(linkStateUrl, {
        headers: {
          authorization: ownerCookie,
        },
      });
      const initialBody = yield* responseJsonEffect<{
        readonly linked?: boolean;
        readonly cloudUserId?: string | null;
      }>(initialResponse);
      assert.equal(initialResponse.status, 200);
      assert.equal(initialBody.linked, false);
      assert.equal(initialBody.cloudUserId, null);

      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://transport.example.test",
          relayIssuer: "https://relay.example.test",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: null,
        }),
      });
      assert.equal(relayConfigResponse.status, 200);

      const linkedResponse = yield* fetchEffect(linkStateUrl, {
        headers: {
          authorization: ownerCookie,
        },
      });
      const linkedBody = yield* responseJsonEffect<{
        readonly linked?: boolean;
        readonly cloudUserId?: string | null;
        readonly relayUrl?: string | null;
        readonly relayIssuer?: string | null;
      }>(linkedResponse);

      assert.equal(linkedResponse.status, 200);
      assert.equal(linkedBody.linked, true);
      assert.equal(linkedBody.cloudUserId, "user_123");
      assert.equal(linkedBody.relayUrl, "https://transport.example.test");
      assert.equal(linkedBody.relayIssuer, "https://relay.example.test");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("does not expose internal cloud reconciliation over HTTP", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const reconcileUrl = yield* getHttpServerUrl("/api/connect/reconcile");
      const response = yield* fetchEffect(reconcileUrl, {
        method: "POST",
      });

      assert.equal(response.status, 404);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("unlinks local cloud state and disables the managed endpoint runtime", () =>
    Effect.gen(function* () {
      const appliedRuntimeConfigs: Array<unknown> = [];
      yield* buildAppUnderTest({
        layers: {
          cloudManagedEndpointRuntime: {
            applyConfig: (config) => {
              appliedRuntimeConfigs.push(config);
              if (!config) {
                return Effect.succeed({ status: "disabled" });
              }
              return Effect.succeed({
                status: "running",
                providerKind: "cloudflare_tunnel",
                pid: 123,
                ...(config.tunnelId ? { tunnelId: config.tunnelId } : {}),
                ...(config.tunnelName ? { tunnelName: config.tunnelName } : {}),
              });
            },
          },
        },
      });

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const unlinkUrl = yield* getHttpServerUrl("/api/connect/unlink");
      const linkStateUrl = yield* getHttpServerUrl("/api/connect/link-state");

      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://transport.example.test",
          relayIssuer: "https://relay.example.test",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: {
            providerKind: "cloudflare_tunnel",
            connectorToken: "connector-token",
            tunnelId: "tunnel-id",
            tunnelName: "tunnel-name",
          },
        }),
      });
      assert.equal(relayConfigResponse.status, 200);

      const unlinkResponse = yield* fetchEffect(unlinkUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
        },
      });
      const unlinkBody = yield* responseJsonEffect<{
        readonly ok?: boolean;
        readonly endpointRuntimeStatus?: { readonly status?: string };
      }>(unlinkResponse);
      assert.equal(unlinkResponse.status, 200);
      assert.equal(unlinkBody.ok, true);
      assert.equal(unlinkBody.endpointRuntimeStatus?.status, "disabled");

      const linkStateResponse = yield* fetchEffect(linkStateUrl, {
        headers: {
          authorization: ownerCookie,
        },
      });
      const linkStateBody = yield* responseJsonEffect<{
        readonly linked?: boolean;
        readonly cloudUserId?: string | null;
        readonly relayUrl?: string | null;
        readonly relayIssuer?: string | null;
      }>(linkStateResponse);
      assert.equal(linkStateResponse.status, 200);
      assert.equal(linkStateBody.linked, false);
      assert.equal(linkStateBody.cloudUserId, null);
      assert.equal(linkStateBody.relayUrl, null);
      assert.equal(linkStateBody.relayIssuer, null);
      assert.deepEqual(appliedRuntimeConfigs, [
        {
          providerKind: "cloudflare_tunnel",
          connectorToken: "connector-token",
          tunnelId: "tunnel-id",
          tunnelName: "tunnel-name",
        },
        null,
      ]);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects replayed cloud mint requests atomically", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://relay.example.test",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: null,
        }),
      });
      assert.equal(relayConfigResponse.status, 200);

      const now = yield* DateTime.now;
      const request = makeCloudMintCredentialRequest({
        privateKey: cloudKeyPair.privateKey,
        environmentId: testEnvironmentDescriptor.environmentId,
        clientProofKeyThumbprint: "client-proof-key-thumbprint",
        nonce: "cloud-mint-nonce-1",
        issuedAt: DateTime.formatIso(now),
        expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
      });
      const mintUrl = yield* getHttpServerUrl("/api/connect/mint-credential");
      const postMint = () =>
        fetchEffect(mintUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: jsonRequestBody(request),
        });

      const firstResponse = yield* postMint();
      const replayResponse = yield* postMint();
      const replayBody = yield* responseJsonEffect<{
        readonly _tag?: string;
        readonly message?: string;
      }>(replayResponse);

      assert.equal(firstResponse.status, 200);
      assert.equal(replayResponse.status, 409);
      assert.equal(replayBody._tag, "EnvironmentHttpConflictError");
      assert.equal(replayBody.message, "Cloud mint request was already consumed.");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("serves the documented T3 Connect mint credential endpoint", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://relay.example.test",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: null,
        }),
      });
      assert.equal(relayConfigResponse.status, 200);

      const now = yield* DateTime.now;
      const request = makeCloudMintCredentialRequest({
        privateKey: cloudKeyPair.privateKey,
        environmentId: testEnvironmentDescriptor.environmentId,
        clientProofKeyThumbprint: "client-proof-key-thumbprint",
        jti: "cloud-mint-jti-documented-endpoint",
        nonce: "cloud-mint-nonce-documented-endpoint",
        issuedAt: DateTime.formatIso(now),
        expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
      });
      const mintUrl = yield* getHttpServerUrl("/api/t3-connect/mint-credential");
      const response = yield* fetchEffect(mintUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: jsonRequestBody(request),
      });

      assert.equal(response.status, 200);
      const body = yield* responseJsonEffect<{
        readonly credential?: string;
        readonly proof?: string;
      }>(response);
      assert.equal(typeof body.credential, "string");
      assert.equal(typeof body.proof, "string");
      assert.equal(
        decodeCompactJwtPayload<{ readonly requestNonce?: string }>(body.proof!).requestNonce,
        "cloud-mint-nonce-documented-endpoint",
      );
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("serves signed T3 Connect environment health checks", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://relay.example.test",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: null,
        }),
      });
      assert.equal(relayConfigResponse.status, 200);

      const now = yield* DateTime.now;
      const request = makeCloudEnvironmentHealthRequest({
        privateKey: cloudKeyPair.privateKey,
        environmentId: testEnvironmentDescriptor.environmentId,
        jti: "cloud-health-jti-documented-endpoint",
        nonce: "cloud-health-nonce-documented-endpoint",
        issuedAt: DateTime.formatIso(now),
        expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
      });
      const healthUrl = yield* getHttpServerUrl("/api/t3-connect/health");
      const response = yield* fetchEffect(healthUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: jsonRequestBody(request),
      });

      assert.equal(response.status, 200);
      const body = yield* responseJsonEffect<{
        readonly status?: string;
        readonly descriptor?: { readonly environmentId?: string };
        readonly proof?: string;
      }>(response);
      assert.equal(body.status, "online");
      assert.equal(body.descriptor?.environmentId, testEnvironmentDescriptor.environmentId);
      assert.equal(typeof body.proof, "string");
      assert.equal(
        decodeCompactJwtPayload<{ readonly requestNonce?: string }>(body.proof!).requestNonce,
        "cloud-health-nonce-documented-endpoint",
      );
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects replayed cloud health requests atomically", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://relay.example.test",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: null,
        }),
      });
      assert.equal(relayConfigResponse.status, 200);

      const now = yield* DateTime.now;
      const request = makeCloudEnvironmentHealthRequest({
        privateKey: cloudKeyPair.privateKey,
        environmentId: testEnvironmentDescriptor.environmentId,
        jti: "cloud-health-jti-replay",
        nonce: "cloud-health-nonce-replay",
        issuedAt: DateTime.formatIso(now),
        expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
      });
      const healthUrl = yield* getHttpServerUrl("/api/t3-connect/health");
      const postHealth = () =>
        fetchEffect(healthUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: jsonRequestBody(request),
        });

      const firstResponse = yield* postHealth();
      const replayResponse = yield* postHealth();
      const replayBody = yield* responseJsonEffect<{
        readonly _tag?: string;
        readonly message?: string;
      }>(replayResponse);

      assert.equal(firstResponse.status, 200);
      assert.equal(replayResponse.status, 409);
      assert.equal(replayBody._tag, "EnvironmentHttpConflictError");
      assert.equal(replayBody.message, "Cloud health request was already consumed.");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects cloud replays by time alone once their markers can be pruned", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerAuthorization = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigResponse = yield* fetchEffect(
        yield* getHttpServerUrl("/api/connect/relay-config"),
        {
          method: "POST",
          headers: { authorization: ownerAuthorization, "content-type": "application/json" },
          body: jsonRequestBody({
            relayUrl: "https://relay.example.test",
            cloudUserId: "user_123",
            environmentCredential: "t3env_test_credential",
            cloudMintPublicKey: cloudKeyPair.publicKey,
            endpointRuntime: null,
          }),
        },
      );
      assert.equal(relayConfigResponse.status, 200);

      const acceptedAt = yield* DateTime.now;
      // The longest-lived proofs: `iat` at the 60 s future skew the handlers
      // allow, and the 5 minute maximum lifetime.
      const issuedAt = DateTime.add(acceptedAt, { minutes: 1 });
      const proofTimes = {
        issuedAt: DateTime.formatIso(issuedAt),
        expiresAt: DateTime.formatIso(DateTime.add(issuedAt, { minutes: 5 })),
      };
      const requests = [
        [
          "/api/t3-connect/health",
          makeCloudEnvironmentHealthRequest({
            privateKey: cloudKeyPair.privateKey,
            environmentId: testEnvironmentDescriptor.environmentId,
            nonce: "cloud-health-nonce-pruned",
            ...proofTimes,
          }),
        ],
        [
          "/api/t3-connect/mint-credential",
          makeCloudMintCredentialRequest({
            privateKey: cloudKeyPair.privateKey,
            environmentId: testEnvironmentDescriptor.environmentId,
            clientProofKeyThumbprint: "client-proof-key-thumbprint",
            nonce: "cloud-mint-nonce-pruned",
            ...proofTimes,
          }),
        ],
      ] as const;
      const postAll = Effect.forEach(requests, ([pathname, request]) =>
        Effect.gen(function* () {
          const response = yield* fetchEffect(yield* getHttpServerUrl(pathname), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: jsonRequestBody(request),
          });
          return response.status;
        }),
      );

      assert.deepStrictEqual(yield* postAll, [200, 200]);
      // While the proofs are fresh, only the replay markers reject them (409).
      assert.deepStrictEqual(yield* postAll, [409, 409]);
      // Once the markers can be pruned, the time checks reject the proofs by themselves (401).
      yield* TestClock.setTime(
        acceptedAt.epochMilliseconds + Duration.toMillis(REPLAY_MARKER_MAX_AGE),
      );
      assert.deepStrictEqual(yield* postAll, [401, 401]);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "validates cloud proofs against the configured relay issuer, not the transport URL",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest();

        const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
          privateKeyEncoding: { format: "pem", type: "pkcs8" },
          publicKeyEncoding: { format: "pem", type: "spki" },
        });
        const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
        const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
        const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
          method: "POST",
          headers: {
            authorization: ownerCookie,
            "content-type": "application/json",
          },
          body: jsonRequestBody({
            relayUrl: "https://transport.example.test",
            cloudUserId: "user_123",
            relayIssuer: "https://relay.example.test",
            environmentCredential: "t3env_test_credential",
            cloudMintPublicKey: cloudKeyPair.publicKey,
            endpointRuntime: null,
          }),
        });
        assert.equal(relayConfigResponse.status, 200);

        const now = yield* DateTime.now;
        const mintUrl = yield* getHttpServerUrl("/api/t3-connect/mint-credential");
        const postMint = (request: ReturnType<typeof makeCloudMintCredentialRequest>) =>
          fetchEffect(mintUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: jsonRequestBody(request),
          });

        const acceptedResponse = yield* postMint(
          makeCloudMintCredentialRequest({
            privateKey: cloudKeyPair.privateKey,
            environmentId: testEnvironmentDescriptor.environmentId,
            clientProofKeyThumbprint: "client-proof-key-thumbprint",
            issuer: "https://relay.example.test",
            jti: "cloud-mint-jti-explicit-relay-issuer",
            nonce: "cloud-mint-nonce-explicit-relay-issuer",
            issuedAt: DateTime.formatIso(now),
            expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
          }),
        );
        const rejectedResponse = yield* postMint(
          makeCloudMintCredentialRequest({
            privateKey: cloudKeyPair.privateKey,
            environmentId: testEnvironmentDescriptor.environmentId,
            clientProofKeyThumbprint: "client-proof-key-thumbprint",
            issuer: "https://transport.example.test",
            jti: "cloud-mint-jti-transport-url",
            nonce: "cloud-mint-nonce-transport-url",
            issuedAt: DateTime.formatIso(now),
            expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
          }),
        );

        assert.equal(acceptedResponse.status, 200);
        assert.equal(rejectedResponse.status, 401);
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("fails relay config when the managed endpoint connector cannot start", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        layers: {
          cloudManagedEndpointRuntime: {
            applyConfig: () =>
              Effect.succeed({
                status: "failed",
                providerKind: "cloudflare_tunnel",
                reason: "cloudflared missing",
                tunnelId: "tunnel-1",
              }),
          },
        },
      });

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://relay.example.test",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: {
            providerKind: "cloudflare_tunnel",
            connectorToken: "connector-token",
            tunnelId: "tunnel-1",
          },
        }),
      });

      assert.equal(relayConfigResponse.status, 503);
      const relayConfigBody = yield* responseJsonEffect<{
        _tag?: string;
        message?: string;
        endpointRuntimeStatus?: { status?: string; reason?: string };
      }>(relayConfigResponse);
      assert.equal(relayConfigBody._tag, "EnvironmentCloudEndpointUnavailableError");
      assert.equal(relayConfigBody.message, "Managed endpoint runtime could not be started.");
      assert.equal(relayConfigBody.endpointRuntimeStatus?.status, "failed");
      assert.equal(relayConfigBody.endpointRuntimeStatus?.reason, "cloudflared missing");

      const now = yield* DateTime.now;
      const healthRequest = makeCloudEnvironmentHealthRequest({
        privateKey: cloudKeyPair.privateKey,
        environmentId: testEnvironmentDescriptor.environmentId,
        nonce: "cloud-health-after-failed-runtime",
        issuedAt: DateTime.formatIso(now),
        expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
      });
      const healthUrl = yield* getHttpServerUrl("/api/t3-connect/health");
      const healthResponse = yield* fetchEffect(healthUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: jsonRequestBody(healthRequest),
      });
      const healthBody = yield* responseJsonEffect<{
        _tag?: string;
        message?: string;
      }>(healthResponse);
      assert.equal(healthResponse.status, 500);
      assert.equal(healthBody._tag, "EnvironmentHttpInternalServerError");
      assert.equal(
        healthBody.message,
        "Cloud mint public key is not installed for this environment.",
      );
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects cloud mint requests with the wrong issuer or audience", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://relay.example.test/",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: null,
        }),
      });
      assert.equal(relayConfigResponse.status, 200);

      const now = yield* DateTime.now;
      const mintUrl = yield* getHttpServerUrl("/api/connect/mint-credential");
      const postMint = (request: ReturnType<typeof makeCloudMintCredentialRequest>) =>
        fetchEffect(mintUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: jsonRequestBody(request),
        });

      const wrongIssuer = yield* postMint(
        makeCloudMintCredentialRequest({
          privateKey: cloudKeyPair.privateKey,
          environmentId: testEnvironmentDescriptor.environmentId,
          clientProofKeyThumbprint: "client-proof-key-thumbprint",
          issuer: "https://attacker.example.test",
          jti: "cloud-mint-jti-wrong-issuer",
          nonce: "cloud-mint-nonce-wrong-issuer",
          issuedAt: DateTime.formatIso(now),
          expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
        }),
      );
      const wrongAudience = yield* postMint(
        makeCloudMintCredentialRequest({
          privateKey: cloudKeyPair.privateKey,
          environmentId: testEnvironmentDescriptor.environmentId,
          clientProofKeyThumbprint: "client-proof-key-thumbprint",
          audience: "t3-env:other-environment",
          jti: "cloud-mint-jti-wrong-audience",
          nonce: "cloud-mint-nonce-wrong-audience",
          issuedAt: DateTime.formatIso(now),
          expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
        }),
      );

      assert.equal(wrongIssuer.status, 401);
      assert.equal(wrongAudience.status, 401);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects cloud mint requests for a cloud subject other than the linked user", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://relay.example.test/",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: null,
        }),
      });
      assert.equal(relayConfigResponse.status, 200);

      const now = yield* DateTime.now;
      const mintUrl = yield* getHttpServerUrl("/api/t3-connect/mint-credential");
      const response = yield* fetchEffect(mintUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: jsonRequestBody(
          makeCloudMintCredentialRequest({
            privateKey: cloudKeyPair.privateKey,
            environmentId: testEnvironmentDescriptor.environmentId,
            clientProofKeyThumbprint: "client-proof-key-thumbprint",
            subject: "user_other",
            jti: "cloud-mint-jti-wrong-subject",
            nonce: "cloud-mint-nonce-wrong-subject",
            issuedAt: DateTime.formatIso(now),
            expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
          }),
        ),
      });

      assert.equal(response.status, 401);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects cloud mint requests without the exact connect scope", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://relay.example.test/",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: null,
        }),
      });
      assert.equal(relayConfigResponse.status, 200);

      const now = yield* DateTime.now;
      const mintUrl = yield* getHttpServerUrl("/api/t3-connect/mint-credential");
      const response = yield* fetchEffect(mintUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: jsonRequestBody(
          makeCloudMintCredentialRequest({
            privateKey: cloudKeyPair.privateKey,
            environmentId: testEnvironmentDescriptor.environmentId,
            clientProofKeyThumbprint: "client-proof-key-thumbprint",
            jti: "cloud-mint-jti-duplicate-scope",
            nonce: "cloud-mint-nonce-duplicate-scope",
            issuedAt: DateTime.formatIso(now),
            expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
            scope: ["environment:connect", "environment:connect"],
          }),
        ),
      });

      assert.equal(response.status, 401);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects cloud health requests with the wrong issuer or audience", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://relay.example.test/",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: null,
        }),
      });
      assert.equal(relayConfigResponse.status, 200);

      const now = yield* DateTime.now;
      const healthUrl = yield* getHttpServerUrl("/api/t3-connect/health");
      const postHealth = (request: ReturnType<typeof makeCloudEnvironmentHealthRequest>) =>
        fetchEffect(healthUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: jsonRequestBody(request),
        });

      const wrongIssuer = yield* postHealth(
        makeCloudEnvironmentHealthRequest({
          privateKey: cloudKeyPair.privateKey,
          environmentId: testEnvironmentDescriptor.environmentId,
          issuer: "https://attacker.example.test",
          jti: "cloud-health-jti-wrong-issuer",
          nonce: "cloud-health-nonce-wrong-issuer",
          issuedAt: DateTime.formatIso(now),
          expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
        }),
      );
      const wrongAudience = yield* postHealth(
        makeCloudEnvironmentHealthRequest({
          privateKey: cloudKeyPair.privateKey,
          environmentId: testEnvironmentDescriptor.environmentId,
          audience: "t3-env:other-environment",
          jti: "cloud-health-jti-wrong-audience",
          nonce: "cloud-health-nonce-wrong-audience",
          issuedAt: DateTime.formatIso(now),
          expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
        }),
      );

      assert.equal(wrongIssuer.status, 401);
      assert.equal(wrongAudience.status, 401);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects cloud health requests for a cloud subject other than the linked user", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://relay.example.test/",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: null,
        }),
      });
      assert.equal(relayConfigResponse.status, 200);

      const now = yield* DateTime.now;
      const healthUrl = yield* getHttpServerUrl("/api/t3-connect/health");
      const response = yield* fetchEffect(healthUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: jsonRequestBody(
          makeCloudEnvironmentHealthRequest({
            privateKey: cloudKeyPair.privateKey,
            environmentId: testEnvironmentDescriptor.environmentId,
            subject: "user_other",
            jti: "cloud-health-jti-wrong-subject",
            nonce: "cloud-health-nonce-wrong-subject",
            issuedAt: DateTime.formatIso(now),
            expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
          }),
        ),
      });

      assert.equal(response.status, 401);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects cloud health requests without the exact status scope", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const cloudKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const relayConfigUrl = yield* getHttpServerUrl("/api/connect/relay-config");
      const relayConfigResponse = yield* fetchEffect(relayConfigUrl, {
        method: "POST",
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: jsonRequestBody({
          relayUrl: "https://relay.example.test/",
          cloudUserId: "user_123",
          environmentCredential: "t3env_test_credential",
          cloudMintPublicKey: cloudKeyPair.publicKey,
          endpointRuntime: null,
        }),
      });
      assert.equal(relayConfigResponse.status, 200);

      const now = yield* DateTime.now;
      const healthUrl = yield* getHttpServerUrl("/api/t3-connect/health");
      const response = yield* fetchEffect(healthUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: jsonRequestBody(
          makeCloudEnvironmentHealthRequest({
            privateKey: cloudKeyPair.privateKey,
            environmentId: testEnvironmentDescriptor.environmentId,
            jti: "cloud-health-jti-duplicate-scope",
            nonce: "cloud-health-nonce-duplicate-scope",
            issuedAt: DateTime.formatIso(now),
            expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 5 })),
            scope: ["environment:status", "environment:status"],
          }),
        ),
      });

      assert.equal(response.status, 401);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("negotiates permessage-deflate with clients that offer it", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const { cookie, url } = parseAuthorizationFromWsUrl(yield* getWsServerUrl("/ws"));
      const openSocket = (perMessageDeflate: boolean) =>
        Effect.acquireRelease(
          Effect.callback<NodeSocket.NodeWS.WebSocket, Error>((resume) => {
            const socket = new NodeSocket.NodeWS.WebSocket(url, {
              perMessageDeflate,
              ...(cookie ? { headers: { authorization: cookie } } : {}),
            });
            socket.on("open", () => resume(Effect.succeed(socket)));
            socket.on("error", (error) => resume(Effect.fail(error)));
          }),
          (socket) => Effect.sync(() => socket.close()),
        );

      const compressed = yield* openSocket(true);
      // The ws client records the negotiated extension only when the server's
      // 101 response accepted the offer.
      assert.include(compressed.extensions, "permessage-deflate");

      const plain = yield* openSocket(false);
      assert.notInclude(plain.extensions, "permessage-deflate");
    }).pipe(
      Effect.scoped,
      Effect.provide(layerLoopbackTest({ websocket: { perMessageDeflate: true } })),
    ),
  );

  it.effect("issues short-lived websocket tickets for authenticated bearer sessions", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const bearerToken = yield* getAuthenticatedBearerSessionToken();
      const wsTicketUrl = yield* getHttpServerUrl("/api/auth/websocket-ticket");
      const wsTicketResponse = yield* fetchEffect(wsTicketUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearerToken}`,
        },
      });
      const wsTicketBody = yield* responseJsonEffect<{
        readonly ticket: string;
        readonly expiresAt: string;
      }>(wsTicketResponse);

      assert.equal(wsTicketResponse.status, 200);
      assert.equal(typeof wsTicketBody.ticket, "string");
      assert.isTrue(wsTicketBody.ticket.length > 0);
      assert.equal(typeof wsTicketBody.expiresAt, "string");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("does not allow management-only access tokens to operate the environment", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const session = yield* issueFixtureSession(["access:write"]);

      const wsTicketResponse = yield* HttpClient.post("/api/auth/websocket-ticket", {
        headers: {
          authorization: `Bearer ${session.token}`,
        },
      });
      const wsTicketBody = (yield* wsTicketResponse.json) as { readonly ticket: string };
      assert.equal(wsTicketResponse.status, 200);
      const wsUrl = `${yield* getWsServerUrl("/ws", { authenticated: false })}?wsTicket=${encodeURIComponent(wsTicketBody.ticket)}`;
      const rpcError = yield* Effect.flip(
        Effect.scoped(withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverGetConfig]({}))),
      );
      assert.equal(rpcError._tag, "EnvironmentAuthorizationError");
      if (rpcError._tag === "EnvironmentAuthorizationError") {
        assert.equal(rpcError.requiredScope, "orchestration:read");
      }
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("includes CORS headers on remote auth success responses", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const origin = crossOriginClientOrigin;
      const tokenBody = { access_token: (yield* issueFixtureSession()).token };

      const sessionUrl = yield* getHttpServerUrl("/api/auth/session");
      const sessionResponse = yield* fetchEffect(sessionUrl, {
        headers: {
          authorization: `Bearer ${tokenBody.access_token ?? ""}`,
          origin,
        },
      });
      const sessionBody = yield* responseJsonEffect<{
        readonly authenticated: boolean;
        readonly sessionMethod?: string;
      }>(sessionResponse);

      assert.equal(sessionResponse.status, 200);
      assertBrowserApiCorsResponseHeaders(sessionResponse.headers);
      assert.equal(sessionBody.authenticated, true);
      assert.equal(sessionBody.sessionMethod, "bearer-access-token");

      const wsTicketUrl = yield* getHttpServerUrl("/api/auth/websocket-ticket");
      const wsTicketResponse = yield* fetchEffect(wsTicketUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenBody.access_token ?? ""}`,
          origin,
        },
      });
      const wsTicketBody = yield* responseJsonEffect<{
        readonly ticket: string;
      }>(wsTicketResponse);

      assert.equal(wsTicketResponse.status, 200);
      assertBrowserApiCorsResponseHeaders(wsTicketResponse.headers);
      assert.equal(typeof wsTicketBody.ticket, "string");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "responds to remote auth websocket-ticket preflight requests with authorization CORS headers",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest();

        const wsTicketUrl = yield* getHttpServerUrl("/api/auth/websocket-ticket");
        const response = yield* fetchEffect(wsTicketUrl, {
          method: "OPTIONS",
          headers: {
            origin: crossOriginClientOrigin,
            "access-control-request-method": "POST",
            "access-control-request-headers": "authorization",
          },
        });

        assert.equal(response.status, 204);
        assertBrowserApiCorsPreflightHeaders(response.headers);
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("allows credentialed cloud link proof preflights from the configured dev UI", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: { devUrl: new URL(crossOriginClientOrigin) },
      });

      const linkProofUrl = yield* getHttpServerUrl("/api/connect/link-proof");
      const response = yield* fetchEffect(linkProofUrl, {
        method: "OPTIONS",
        headers: {
          origin: crossOriginClientOrigin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });

      assert.equal(response.status, 204);
      assertBrowserApiCorsPreflightHeaders(response.headers, {
        origin: crossOriginClientOrigin,
        credentials: true,
      });
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("allows configured development origins through ServerConfig", () =>
    Effect.gen(function* () {
      const tailnetOrigin = "https://host.example.ts.net";
      yield* buildAppUnderTest({
        config: {
          devUrl: new URL(crossOriginClientOrigin),
          devAllowedOrigins: [tailnetOrigin],
        },
      });

      const sessionUrl = yield* getHttpServerUrl("/api/auth/session");
      const response = yield* fetchEffect(sessionUrl, {
        method: "OPTIONS",
        headers: {
          origin: tailnetOrigin,
          "access-control-request-method": "GET",
          "access-control-request-headers": "content-type",
        },
      });

      assert.equal(response.status, 204);
      assertBrowserApiCorsPreflightHeaders(response.headers, {
        origin: tailnetOrigin,
        credentials: true,
      });
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect.each(
    Array.from(["t3code://app", "t3code-dev://app"], (desktopOrigin) => ({
      title: `allows credentialed preflights from ${desktopOrigin} in development`,
      desktopOrigin,
    })),
  )("$title", ({ desktopOrigin }) =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: { devUrl: new URL(crossOriginClientOrigin) },
      });

      const sessionUrl = yield* getHttpServerUrl("/api/auth/session");
      const response = yield* fetchEffect(sessionUrl, {
        method: "OPTIONS",
        headers: {
          origin: desktopOrigin,
          "access-control-request-method": "GET",
          "access-control-request-headers": "content-type",
        },
      });

      assert.equal(response.status, 204);
      assertBrowserApiCorsPreflightHeaders(response.headers, {
        origin: desktopOrigin,
        credentials: true,
      });
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("includes CORS headers on remote websocket-ticket auth failures", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const wsTicketUrl = yield* getHttpServerUrl("/api/auth/websocket-ticket");
      const response = yield* fetchEffect(wsTicketUrl, {
        method: "POST",
        headers: {
          origin: crossOriginClientOrigin,
        },
      });
      const body = yield* responseJsonEffect<{
        readonly _tag?: string;
        readonly code?: string;
        readonly reason?: string;
        readonly traceId?: string;
      }>(response);

      assert.equal(response.status, 401);
      assertBrowserApiCorsResponseHeaders(response.headers);
      assert.equal(body._tag, "EnvironmentAuthInvalidError");
      assert.equal(body.code, "auth_invalid");
      assert.equal(body.reason, "missing_credential");
      assert.equal(typeof body.traceId, "string");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("refuses to open a cookie session inside a Zerops project", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ ticketAuth: true, config: { zerops: zeropsTestEnvironment() } });

      const response = yield* HttpClient.post("/api/auth/browser-session", {
        body: yield* HttpBody.json({ credential: defaultDesktopBootstrapToken }),
      });
      assert.equal(response.status, 404);
      assert.equal(response.headers["set-cookie"], undefined);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("ignores a session cookie on Zerops HTTP and websocket routes", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ ticketAuth: true, config: { zerops: zeropsTestEnvironment() } });
      const cookie = "t3.session=untrusted-cookie";
      const ticketResponse = yield* HttpClient.post("/api/auth/websocket-ticket", {
        headers: { cookie },
      });
      assert.equal(ticketResponse.status, 401);
      assert.deepInclude(yield* ticketResponse.json, { reason: "missing_credential" });
      const url = yield* getWsServerUrl("/ws", { authenticated: false });
      const code = yield* Effect.callback<number, Error>((resume) => {
        const socket = new NodeSocket.NodeWS.WebSocket(url, {
          origin: "https://mate.zerops.io",
          headers: { cookie },
        });
        socket.once("open", () => socket.send("{}"));
        socket.once("close", (closeCode) => resume(Effect.succeed(closeCode)));
        socket.once("error", (error) => resume(Effect.fail(error)));
        return Effect.sync(() => socket.terminate());
      });
      assert.equal(code, 4401);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  // HTTP remains bearer-only across origins; a WebSocket also checks its exact Origin.
  const ARBITRARY_ORIGIN = "https://mate.dev-team.example.org";

  it.effect("answers a preflight from any origin without credentials inside a Zerops project", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ ticketAuth: true, config: { zerops: zeropsTestEnvironment() } });

      const sessionUrl = yield* getHttpServerUrl("/api/auth/session");
      const response = yield* fetchEffect(sessionUrl, {
        method: "OPTIONS",
        headers: {
          origin: ARBITRARY_ORIGIN,
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      });

      assert.equal(response.status, 204);
      assertBrowserApiCorsPreflightHeaders(response.headers);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("serves a bearer call from any origin inside a Zerops project", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ ticketAuth: true, config: { zerops: zeropsTestEnvironment() } });
      const { connections, tickets } = yield* testTicketState;
      yield* connections.heard({
        type: "access",
        version: 1,
        full: true,
        viewAt: "1970-01-01T00:00:00.000Z",
        members: [{ userId: "owner", role: "OWNER", visibility: "open" }],
      });
      const session = { token: "http-origin-ticket" };
      yield* tickets.heard({
        type: "ticket",
        ticket: session.token,
        userId: "owner",
        sessionId: "hq-owner",
        expiresIn: 60,
      });
      assert.isTrue(
        Option.isSome(yield* connections.admit({ ticket: session.token }, Effect.void)),
      );

      const sessionUrl = yield* getHttpServerUrl("/api/auth/session");
      const response = yield* fetchEffect(sessionUrl, {
        headers: { origin: ARBITRARY_ORIGIN, authorization: `Bearer ${session.token}` },
      });
      const body = yield* responseJsonEffect<{ readonly authenticated: boolean }>(response);

      assert.equal(response.status, 200);
      assertBrowserApiCorsResponseHeaders(response.headers);
      assert.isTrue(body.authenticated);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("refuses a call without a bearer from any origin inside a Zerops project", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ ticketAuth: true, config: { zerops: zeropsTestEnvironment() } });

      const ticketUrl = yield* getHttpServerUrl("/api/auth/websocket-ticket");
      const response = yield* fetchEffect(ticketUrl, {
        method: "POST",
        headers: { origin: ARBITRARY_ORIGIN },
      });
      const body = yield* responseJsonEffect<{ readonly reason?: string }>(response);

      assert.equal(response.status, 401);
      assert.equal(body.reason, "missing_credential");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("refuses a websocket from any origin without a ticket inside a Zerops project", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ ticketAuth: true, config: { zerops: zeropsTestEnvironment() } });

      const wsUrl = yield* getHttpServerUrl("/ws");
      const response = yield* fetchEffect(wsUrl, { headers: { origin: ARBITRARY_ORIGIN } });

      assert.equal(response.status, 403);
      assert.equal(yield* response.text, "Forbidden origin");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("has no public manual pairing endpoints", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();
      for (const path of ["/api/auth/pairing-token", "/api/auth/pairing-links/revoke"]) {
        const response = yield* HttpClient.post(path, {
          headers: { authorization: yield* getAuthenticatedAuthorizationHeader() },
          body: yield* HttpBody.json({}),
        });
        assert.equal(response.status, 404);
      }
      const links = yield* HttpClient.get("/api/auth/pairing-links");
      assert.equal(links.status, 404);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("logout revokes only the caller without requiring access administration", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { zerops: zeropsTestEnvironment() } });
      const first = yield* issueFixtureSession(AuthStandardClientScopes);
      const second = yield* issueFixtureSession(AuthStandardClientScopes);
      const response = yield* HttpClient.post("/api/auth/logout", {
        headers: { authorization: `Bearer ${first.token}` },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(yield* response.json, { revoked: true });
      const expired = yield* HttpClient.post("/api/auth/websocket-ticket", {
        headers: { authorization: `Bearer ${first.token}` },
      });
      const other = yield* HttpClient.post("/api/auth/websocket-ticket", {
        headers: { authorization: `Bearer ${second.token}` },
      });
      assert.equal(expired.status, 401);
      assert.equal(other.status, 200);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  // A client renews a session that reached the end of its life through its door, and must never
  // read it as a refusal; every other refused credential keeps today's answer.
  it.effect("names an expired session in its 401, and only an expired one", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({ config: { zerops: zeropsTestEnvironment() } });
      const auth = yield* testAuth;
      const ended = yield* auth.issueSession({
        subject: "zerops-user:test",
        scopes: AuthStandardClientScopes,
        ttl: Duration.zero,
      });
      const revoked = yield* issueFixtureSession(AuthStandardClientScopes);
      yield* auth.revokeSession(revoked.sessionId);
      const ticket = (token: string) =>
        HttpClient.post("/api/auth/websocket-ticket", {
          headers: { authorization: `Bearer ${token}` },
        }).pipe(
          Effect.flatMap((response) =>
            response.json.pipe(
              Effect.map((body) => ({
                status: response.status,
                body: body as { readonly reason?: string; readonly expired?: boolean },
              })),
            ),
          ),
        );

      const expiredAnswer = yield* ticket(ended.token);
      const revokedAnswer = yield* ticket(revoked.token);

      assert.equal(expiredAnswer.status, 401);
      assert.equal(expiredAnswer.body.reason, "invalid_credential");
      assert.equal(expiredAnswer.body.expired, true);
      assert.equal(revokedAnswer.status, 401);
      assert.equal(revokedAnswer.body.reason, "invalid_credential");
      assert.isFalse("expired" in revokedAnswer.body);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("revokes an individual client session", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: {
          host: "0.0.0.0",
          zerops: zeropsTestEnvironment(),
        },
      });

      const ownerCookie = yield* getAuthenticatedAuthorizationHeader();
      const pairedSessionCookie = `Bearer ${(yield* issueFixtureSession(AuthStandardClientScopes)).token}`;

      const clientsResponse = yield* HttpClient.get("/api/auth/clients", {
        headers: {
          authorization: ownerCookie,
        },
      });
      const clients = (yield* clientsResponse.json) as ReadonlyArray<{
        readonly sessionId: string;
        readonly current: boolean;
      }>;
      const pairedSessionId = clients.find((entry) => !entry.current)?.sessionId;
      assert.isDefined(pairedSessionId);

      const revokeResponse = yield* HttpClient.post("/api/auth/clients/revoke", {
        headers: {
          authorization: ownerCookie,
          "content-type": "application/json",
        },
        body: HttpBody.text(jsonRequestBody({ sessionId: pairedSessionId }), "application/json"),
      });
      const pairedClientPairingResponse = yield* HttpClient.post("/api/auth/websocket-ticket", {
        headers: {
          authorization: pairedSessionCookie,
        },
        body: yield* HttpBody.json({}),
      });

      assert.equal(revokeResponse.status, 200);
      assert.equal(pairedClientPairingResponse.status, 401);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("advertises the usable file manager and its reveal label", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        layers: {
          externalLauncher: {
            resolveAvailableEditors: () => Effect.succeed(["file-manager"]),
            resolveFileManagerRevealKind: () => Effect.succeed("file-explorer"),
          },
        },
      });

      const cookie = yield* getAuthenticatedAuthorizationHeader();
      const wsUrl = appendAuthorizationToWsUrl(
        yield* getWsServerUrl("/ws", { authenticated: false }),
        cookie?.split(";")[0] ?? "",
      );
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverGetConfig]({})),
      );

      assert.deepEqual(response.availableEditors, ["file-manager"]);
      assert.equal(response.shellRevealInFileManager, true);
      assert.equal(response.shellRevealInFileManagerKind, "file-explorer");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("does not block server config when editor discovery never resolves", () =>
    Effect.gen(function* () {
      const discoveryInterrupted = yield* Deferred.make<void>();
      const responseFiber = yield* resolveAvailableEditorsForConfig(
        Effect.never.pipe(
          Effect.onInterrupt(() => Deferred.succeed(discoveryInterrupted, undefined)),
        ),
      ).pipe(Effect.forkChild);

      yield* TestClock.adjust(Duration.seconds(5));

      const availableEditors = yield* Fiber.join(responseFiber);
      yield* Deferred.await(discoveryInterrupted);
      assert.deepEqual(availableEditors, []);
    }),
  );

  it.effect("does not block server config when file manager reveal discovery never resolves", () =>
    Effect.gen(function* () {
      const discoveryInterrupted = yield* Deferred.make<void>();
      const responseFiber = yield* resolveFileManagerRevealKindForConfig(
        Effect.never.pipe(
          Effect.onInterrupt(() => Deferred.succeed(discoveryInterrupted, undefined)),
        ),
      ).pipe(Effect.forkChild);

      yield* TestClock.adjust(Duration.seconds(5));

      const revealKind = yield* Fiber.join(responseFiber);
      yield* Deferred.await(discoveryInterrupted);
      assert.isUndefined(revealKind);
    }),
  );

  it.effect(
    "rejects websocket rpc handshake when a session token is only provided via query string",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest();

        const sessionToken = yield* getAuthenticatedBearerSessionToken();
        const wsUrl = `${yield* getWsServerUrl("/ws", { authenticated: false })}?token=${encodeURIComponent(sessionToken)}`;

        const error = yield* Effect.flip(
          Effect.scoped(withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverGetConfig]({}))),
        );

        assert.equal(error._tag, "RpcClientError");
        assertInclude(String(error), "SocketOpenError");
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "accepts websocket rpc handshake with a dedicated websocket ticket in the query string",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest();

        const bearerToken = yield* getAuthenticatedBearerSessionToken();
        const wsTicketUrl = yield* getHttpServerUrl("/api/auth/websocket-ticket");
        const wsTicketResponse = yield* fetchEffect(wsTicketUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${bearerToken}`,
          },
        });
        const wsTicketBody = yield* responseJsonEffect<{
          readonly ticket: string;
        }>(wsTicketResponse);
        const wsUrl = `${yield* getWsServerUrl("/ws", { authenticated: false })}?wsTicket=${encodeURIComponent(wsTicketBody.ticket)}`;

        const response = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverGetConfig]({})),
        );

        assert.equal(response.environment.environmentId, testEnvironmentDescriptor.environmentId);
        assert.equal(response.auth.policy, "desktop-managed-local");
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("proxies browser OTLP trace exports through the server", () =>
    Effect.gen(function* () {
      const upstreamRequests: Array<{
        readonly body: string;
        readonly contentType: string | null;
      }> = [];
      const localTraceRecords: Array<unknown> = [];
      const payload = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: "t3-web" },
                },
              ],
            },
            scopeSpans: [
              {
                scope: {
                  name: "effect",
                  version: "4.0.0-beta.43",
                },
                spans: [
                  {
                    traceId: "11111111111111111111111111111111",
                    spanId: "2222222222222222",
                    parentSpanId: "3333333333333333",
                    name: "RpcClient.server.getSettings",
                    kind: 3,
                    startTimeUnixNano: "1000000",
                    endTimeUnixNano: "2000000",
                    attributes: [
                      {
                        key: "rpc.method",
                        value: { stringValue: "server.getSettings" },
                      },
                    ],
                    events: [
                      {
                        name: "http.request",
                        timeUnixNano: "1500000",
                        attributes: [
                          {
                            key: "http.status_code",
                            value: { intValue: "200" },
                          },
                        ],
                      },
                    ],
                    links: [],
                    status: {
                      code: "STATUS_CODE_OK",
                    },
                    flags: 1,
                  },
                ],
              },
            ],
          },
        ],
      };

      const collector = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const NodeHttp = await import("node:http");

          return await new Promise<{
            readonly close: () => Promise<void>;
            readonly url: string;
          }>((resolve, reject) => {
            const server = NodeHttp.createServer((request, response) => {
              const chunks: Buffer[] = [];
              request.on("data", (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              });
              request.on("end", () => {
                upstreamRequests.push({
                  body: Buffer.concat(chunks).toString("utf8"),
                  contentType: request.headers["content-type"] ?? null,
                });
                response.statusCode = 204;
                response.end();
              });
            });

            server.on("error", reject);
            server.listen(0, "127.0.0.1", () => {
              const address = server.address();
              if (!address || typeof address === "string") {
                reject(new Error("Expected TCP collector address"));
                return;
              }

              resolve({
                url: `http://127.0.0.1:${address.port}/v1/traces`,
                close: () =>
                  new Promise<void>((resolveClose, rejectClose) => {
                    server.close((error) => {
                      if (error) {
                        rejectClose(error);
                        return;
                      }
                      resolveClose();
                    });
                  }),
              });
            });
          });
        }),
        ({ close }) => Effect.promise(close),
      );

      yield* buildAppUnderTest({
        config: {
          otlpTracesUrl: collector.url,
        },
        layers: {
          browserTraceCollector: {
            record: (records) =>
              Effect.sync(() => {
                localTraceRecords.push(...records);
              }),
          },
        },
      });

      const response = yield* HttpClient.post("/api/observability/v1/traces", {
        headers: {
          authorization: yield* getAuthenticatedAuthorizationHeader(),
          "content-type": "application/json",
          origin: "http://localhost:5733",
        },
        body: HttpBody.text(JSON.stringify(payload), "application/json"),
      });

      assert.equal(response.status, 204);
      assert.equal(response.headers["access-control-allow-origin"], "*");
      assert.deepEqual(localTraceRecords, [
        {
          type: "otlp-span",
          name: "RpcClient.server.getSettings",
          traceId: "11111111111111111111111111111111",
          spanId: "2222222222222222",
          parentSpanId: "3333333333333333",
          sampled: true,
          kind: "client",
          startTimeUnixNano: "1000000",
          endTimeUnixNano: "2000000",
          durationMs: 1,
          attributes: {
            "rpc.method": "server.getSettings",
          },
          resourceAttributes: {
            "service.name": "t3-web",
          },
          scope: {
            name: "effect",
            version: "4.0.0-beta.43",
            attributes: {},
          },
          events: [
            {
              name: "http.request",
              timeUnixNano: "1500000",
              attributes: {
                "http.status_code": "200",
              },
            },
          ],
          links: [],
          status: {
            code: "STATUS_CODE_OK",
          },
        },
      ]);
      assert.deepEqual(upstreamRequests, [
        {
          body: jsonRequestBody(payload),
          contentType: "application/json",
        },
      ]);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("forwards browser OTLP traces as protobuf when the protocol is http/protobuf", () =>
    Effect.gen(function* () {
      const upstreamRequests: Array<{
        readonly body: string;
        readonly contentType: string | null;
      }> = [];
      const localTraceRecords: Array<unknown> = [];
      // Produced by effect's own tracer, so enum fields are numeric and the
      // protobuf encoder accepts them. The hand-written payload in the JSON
      // test uses enum names, which only the JSON path tolerates.
      const payload = yield* makeBrowserOtlpPayload("client.protobuf.test");

      const collector = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const NodeHttp = await import("node:http");

          return await new Promise<{
            readonly close: () => Promise<void>;
            readonly url: string;
          }>((resolve, reject) => {
            const server = NodeHttp.createServer((request, response) => {
              const chunks: Buffer[] = [];
              request.on("data", (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              });
              request.on("end", () => {
                upstreamRequests.push({
                  body: Buffer.concat(chunks).toString("utf8"),
                  contentType: request.headers["content-type"] ?? null,
                });
                response.statusCode = 204;
                response.end();
              });
            });

            server.on("error", reject);
            server.listen(0, "127.0.0.1", () => {
              const address = server.address();
              if (!address || typeof address === "string") {
                reject(new Error("Expected TCP collector address"));
                return;
              }

              resolve({
                url: `http://127.0.0.1:${address.port}/v1/traces`,
                close: () =>
                  new Promise<void>((resolveClose, rejectClose) => {
                    server.close((error) => {
                      if (error) {
                        rejectClose(error);
                        return;
                      }
                      resolveClose();
                    });
                  }),
              });
            });
          });
        }),
        ({ close }) => Effect.promise(close),
      );

      yield* buildAppUnderTest({
        config: {
          otlpTracesUrl: collector.url,
          otlpTracesExport: { ...DEFAULT_SIGNAL_EXPORT, protocol: "http/protobuf" },
        },
        layers: {
          browserTraceCollector: {
            record: (records) =>
              Effect.sync(() => {
                localTraceRecords.push(...records);
              }),
          },
        },
      });

      const response = yield* HttpClient.post("/api/observability/v1/traces", {
        headers: {
          authorization: yield* getAuthenticatedAuthorizationHeader(),
          "content-type": "application/json",
        },
        body: HttpBody.text(JSON.stringify(payload), "application/json"),
      });

      assert.equal(response.status, 204);
      // The local collector still decodes the browser's JSON before forwarding.
      assert.equal(localTraceRecords.length, 1);
      assert.equal(upstreamRequests.length, 1);
      const forwarded = upstreamRequests[0];
      assert.notEqual(forwarded, undefined);
      if (!forwarded) {
        return;
      }
      assert.equal(forwarded.contentType, "application/x-protobuf");
      // Protobuf strings are raw UTF-8, so the span and service names survive
      // the stub's utf8 decode even though the surrounding bytes don't.
      assert.notEqual(forwarded.body[0], "{");
      assert.include(forwarded.body, "client.protobuf.test");
      assert.include(forwarded.body, "t3-web");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("responds to browser OTLP trace preflight requests with CORS headers", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const response = yield* HttpClient.options("/api/observability/v1/traces", {
        headers: {
          origin: "http://localhost:5733",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });

      assert.equal(response.status, 204);
      assert.equal(response.headers["access-control-allow-origin"], "*");
      assert.deepEqual(splitHeaderTokens(response.headers["access-control-allow-methods"]), [
        "GET",
        "HEAD",
        "OPTIONS",
        "POST",
      ]);
      assert.deepEqual(splitHeaderTokens(response.headers["access-control-allow-headers"]), [
        "authorization",
        "b3",
        "content-type",
        "dpop",
        "if-none-match",
        "if-range",
        "range",
        "traceparent",
      ]);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "stores browser OTLP trace exports locally when no upstream collector is configured",
    () =>
      Effect.gen(function* () {
        const localTraceRecords: Array<unknown> = [];
        const payload = yield* makeBrowserOtlpPayload("client.test");
        const resourceSpan = payload.resourceSpans[0];
        const scopeSpan = resourceSpan?.scopeSpans[0];
        const span = scopeSpan?.spans[0];

        assert.notEqual(resourceSpan, undefined);
        assert.notEqual(scopeSpan, undefined);
        assert.notEqual(span, undefined);
        if (!resourceSpan || !scopeSpan || !span) {
          return;
        }

        yield* buildAppUnderTest({
          layers: {
            browserTraceCollector: {
              record: (records) =>
                Effect.sync(() => {
                  localTraceRecords.push(...records);
                }),
            },
          },
        });

        const response = yield* HttpClient.post("/api/observability/v1/traces", {
          headers: {
            authorization: yield* getAuthenticatedAuthorizationHeader(),
            "content-type": "application/json",
          },
          body: HttpBody.text(JSON.stringify(payload), "application/json"),
        });

        assert.equal(response.status, 204);
        assert.equal(localTraceRecords.length, 1);
        const record = localTraceRecords[0] as {
          readonly type: string;
          readonly name: string;
          readonly traceId: string;
          readonly spanId: string;
          readonly kind: string;
          readonly attributes: Readonly<Record<string, unknown>>;
          readonly events: ReadonlyArray<unknown>;
          readonly links: ReadonlyArray<unknown>;
          readonly scope: {
            readonly name?: string;
            readonly attributes: Readonly<Record<string, unknown>>;
          };
          readonly resourceAttributes: Readonly<Record<string, unknown>>;
          readonly status?: {
            readonly code?: string;
          };
        };

        assert.equal(record.type, "otlp-span");
        assert.equal(record.name, span.name);
        assert.equal(record.traceId, span.traceId);
        assert.equal(record.spanId, span.spanId);
        assert.equal(record.kind, "internal");
        assert.deepEqual(record.attributes, {});
        assert.deepEqual(record.events, []);
        assert.deepEqual(record.links, []);
        assert.equal(record.scope.name, scopeSpan.scope.name);
        assert.deepEqual(record.scope.attributes, {});
        assert.equal(record.resourceAttributes["service.name"], "t3-web");
        assert.equal(record.status?.code, String(span.status.code));
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("does not trace browser OTLP trace exports on the server", () =>
    Effect.gen(function* () {
      const spanNames: Array<string> = [];
      const forwardedUrls: Array<string> = [];
      yield* buildAppUnderTest({
        config: { otlpTracesUrl: "http://collector.test/v1/traces" },
        layers: {
          httpClient: HttpClient.make((request) =>
            Effect.sync(() => {
              forwardedUrls.push(request.url);
              return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
            }),
          ),
        },
      }).pipe(
        Effect.provideService(
          Tracer.Tracer,
          Tracer.make({
            span: (options) => {
              spanNames.push(options.name);
              return new Tracer.NativeSpan(options);
            },
          }),
        ),
      );
      const authorization = yield* getAuthenticatedAuthorizationHeader();
      spanNames.length = 0;

      // The query string must not bring back the HTTP server span.
      for (const url of ["/api/observability/v1/traces", "/api/observability/v1/traces?x=1"]) {
        const response = yield* HttpClient.post(url, {
          headers: { authorization, "content-type": "application/json" },
          body: yield* HttpBody.json({ resourceSpans: [] }),
        });
        assert.equal(response.status, 204);
      }

      assert.deepEqual(forwardedUrls, [
        "http://collector.test/v1/traces",
        "http://collector.test/v1/traces",
      ]);
      assert.deepEqual(spanNames, []);

      // Other routes keep their HTTP server span.
      const session = yield* HttpClient.get("/api/auth/session", { headers: { authorization } });
      assert.equal(session.status, 200);
      assert.include(spanNames, "http.server GET");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc server.upsertKeybinding", () =>
    Effect.gen(function* () {
      const rule: KeybindingRule = {
        command: "terminal.toggle",
        key: "ctrl+k",
      };
      const resolved: ResolvedKeybindingRule = {
        command: "terminal.toggle",
        shortcut: {
          key: "k",
          metaKey: false,
          ctrlKey: true,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
      };

      yield* buildAppUnderTest({
        layers: {
          keybindings: {
            upsertKeybindingRule: () => Effect.succeed([resolved]),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverUpsertKeybinding](rule)),
      );

      assert.deepEqual(response.issues, []);
      assert.deepEqual(response.keybindings, [resolved]);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc server.removeKeybinding", () =>
    Effect.gen(function* () {
      const rule: KeybindingRule = {
        command: "terminal.toggle",
        key: "ctrl+k",
      };
      const resolved: ResolvedKeybindingRule = {
        command: "terminal.toggle",
        shortcut: {
          key: "j",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
      };

      yield* buildAppUnderTest({
        layers: {
          keybindings: {
            removeKeybindingRule: () => Effect.succeed([resolved]),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.serverRemoveKeybinding](rule)),
      );

      assert.deepEqual(response.issues, []);
      assert.deepEqual(response.keybindings, [resolved]);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("uploads Codex thread feedback through websocket rpc", () =>
    Effect.gen(function* () {
      const input = {
        threadId: ThreadId.make("thread-feedback"),
        reason: "The agent stopped early.",
      };
      const uploadFeedback = vi.fn<ProviderService.ProviderService["Service"]["uploadFeedback"]>(
        () => Effect.succeed({ feedbackId: "codex-thread-feedback" }),
      );
      yield* buildAppUnderTest({
        layers: {
          providerService: { uploadFeedback },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.providerUploadFeedback](input)),
      );

      assert.deepStrictEqual(response, { feedbackId: "codex-thread-feedback" });
      assert.deepStrictEqual(uploadFeedback.mock.calls, [[input]]);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("uploads image bytes through a signed URL issued by websocket rpc", () =>
    Effect.gen(function* () {
      const config = yield* buildAppUnderTest();
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const wsUrl = yield* getWsServerUrl("/ws");

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          Effect.gen(function* () {
            const issued = yield* client[WS_METHODS.attachmentsCreateUploadUrl]({
              name: "screenshot.png",
              mimeType: "image/png",
              sizeBytes: 6,
            });
            const rejected = yield* HttpClient.post(issued.relativeUrl, {
              body: HttpBody.uint8Array(new Uint8Array([1, 2, 3]), "image/png"),
            });
            assert.equal(rejected.status, 400);

            const response = yield* HttpClient.post(issued.relativeUrl, {
              headers: { origin: crossOriginClientOrigin },
              body: HttpBody.uint8Array(new Uint8Array([1, 2, 3, 4, 5, 6]), "image/png"),
            });
            assert.equal(response.status, 204);
            assertBrowserApiCorsResponseHeaders(response.headers);

            const attachmentPath = path.join(config.attachmentsDir, `${issued.attachmentId}.png`);
            assert.isTrue(yield* fileSystem.exists(attachmentPath));

            yield* client[WS_METHODS.attachmentsDelete]({ attachmentId: issued.attachmentId });
            assert.isFalse(yield* fileSystem.exists(attachmentPath));

            const streamed = yield* client[WS_METHODS.attachmentsCreateUploadUrl]({
              name: "streamed.png",
              mimeType: "image/png",
              sizeBytes: 6,
            });
            const streamedResponse = yield* HttpClient.post(streamed.relativeUrl, {
              body: HttpBody.stream(Stream.make(new Uint8Array([1, 2, 3, 4, 5, 6])), "image/png"),
            });
            assert.equal(streamedResponse.status, 204);
            yield* client[WS_METHODS.attachmentsDelete]({ attachmentId: streamed.attachmentId });

            const uploadedFile = yield* client[WS_METHODS.attachmentsCreateUploadUrl]({
              type: "file",
              name: "report.pdf",
              mimeType: "application/pdf",
              sizeBytes: 6,
            });
            const fileResponse = yield* HttpClient.post(uploadedFile.relativeUrl, {
              body: HttpBody.stream(
                Stream.make(new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])),
                "application/pdf",
              ),
            });
            assert.equal(fileResponse.status, 204);
            const uploadedFilePath = path.join(
              config.attachmentsDir,
              `${uploadedFile.attachmentId}.pdf`,
            );
            assert.isTrue(yield* fileSystem.exists(uploadedFilePath));

            // A mint that carries the attachment's display name and mime
            // serves a real download filename and Content-Type.
            const download = yield* client[WS_METHODS.assetsCreateUrl]({
              resource: {
                _tag: "attachment",
                attachmentId: uploadedFile.attachmentId,
                fileName: "report.pdf",
                mimeType: "application/pdf",
              },
            });
            const downloadResponse = yield* HttpClient.get(download.relativeUrl);
            assert.equal(downloadResponse.status, 200);
            assert.equal(
              downloadResponse.headers["content-disposition"],
              'attachment; filename="report.pdf"',
            );
            assert.equal(downloadResponse.headers["content-type"], "application/pdf");

            // Old clients mint without name or mime and still get a download.
            const bareDownload = yield* client[WS_METHODS.assetsCreateUrl]({
              resource: { _tag: "attachment", attachmentId: uploadedFile.attachmentId },
            });
            const bareResponse = yield* HttpClient.get(bareDownload.relativeUrl);
            assert.equal(bareResponse.status, 200);
            assert.equal(bareResponse.headers["content-disposition"], "attachment");
            assert.equal(bareResponse.headers["content-type"], "application/octet-stream");

            yield* client[WS_METHODS.attachmentsDelete]({
              attachmentId: uploadedFile.attachmentId,
            });
            assert.isFalse(yield* fileSystem.exists(uploadedFilePath));
          }),
        ),
      );
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects an over-limit chunked upload through the route without hanging", () =>
    Effect.gen(function* () {
      const config = yield* buildAppUnderTest();
      const fileSystem = yield* FileSystem.FileSystem;
      const wsUrl = yield* getWsServerUrl("/ws");

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          Effect.gen(function* () {
            const issued = yield* client[WS_METHODS.attachmentsCreateUploadUrl]({
              type: "file",
              name: "big.bin",
              mimeType: "application/octet-stream",
              sizeBytes: 6,
            });
            const NodeHttp = yield* Effect.promise(() => import("node:http"));
            const uploadUrl = new URL(issued.relativeUrl, yield* getHttpServerUrl());
            const status = yield* Effect.callback<number, Error>((resume) => {
              let completed = false;
              const complete = (result: Effect.Effect<number, Error>) => {
                if (completed) return;
                completed = true;
                resume(result);
              };
              const request = NodeHttp.request(
                uploadUrl,
                {
                  method: "POST",
                  headers: {
                    "content-type": "application/octet-stream",
                    "transfer-encoding": "chunked",
                  },
                },
                (response) => {
                  request.end();
                  response.resume();
                  response.once("end", () => complete(Effect.succeed(response.statusCode ?? 0)));
                  response.once("error", (error) => complete(Effect.fail(error)));
                },
              );
              request.once("error", (error) => complete(Effect.fail(error)));
              request.flushHeaders();
              request.write(new Uint8Array(4), () => {
                request.write(new Uint8Array(4));
              });

              return Effect.sync(() => request.destroy());
            });
            assert.equal(status, 400);
            assert.deepEqual(yield* fileSystem.readDirectory(config.attachmentsDir), []);
          }),
        ),
      );
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("keeps feedback errors structured across websocket rpc", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-feedback-failure");
      yield* buildAppUnderTest({
        layers: {
          providerService: {
            uploadFeedback: () =>
              Effect.fail(
                new ProviderAdapterRequestError({
                  provider: "codex",
                  method: "feedback/upload",
                  detail: "private provider detail",
                }),
              ),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const error = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.providerUploadFeedback]({ threadId }).pipe(Effect.flip),
        ),
      );

      assert.strictEqual(error._tag, "ProviderUploadFeedbackError");
      if (error._tag === "ProviderUploadFeedbackError") {
        assert.strictEqual(error.threadId, threadId);
        assert.strictEqual(error.message, `Failed to upload feedback for thread ${threadId}.`);
        assert.isDefined(error.cause);
      }
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("rejects websocket rpc handshake when session authentication is missing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-auth-required-" });
      yield* fs.writeFileString(
        path.join(workspaceDir, "needle-file.ts"),
        "export const needle = 1;",
      );

      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws", { authenticated: false });
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectsSearchEntries]({
            cwd: workspaceDir,
            query: "needle",
            limit: 10,
          }),
        ).pipe(Effect.result),
      );

      assertTrue(result._tag === "Failure");
      const failureMessage = String(result.failure);
      assertTrue(
        failureMessage.includes("SocketOpenError") || failureMessage.includes("SocketCloseError"),
      );
      assertTrue(
        failureMessage.includes("Unauthorized") ||
          failureMessage.includes("An error occurred during Open"),
      );
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("provider setup lets read-only clients observe installation but not change setup", () =>
    Effect.gen(function* () {
      let installStarts = 0;
      let authCalls = 0;
      yield* buildAppUnderTest({
        layers: {
          providerInstanceRegistry: {
            getInstance: (instanceId) =>
              Effect.succeed(
                instanceId === providerSetupInstanceId ? providerSetupInstance : undefined,
              ),
          },
          antigravityInstallation: {
            start: Effect.sync(() => {
              installStarts += 1;
              return providerSetupInstallState;
            }),
            changes: Stream.succeed(providerSetupInstallState),
          },
          providerAuth: {
            start: () =>
              Effect.sync(() => {
                authCalls += 1;
                return providerSetupAuthState;
              }),
            subscribe: () =>
              Stream.fromEffect(
                Effect.sync(() => {
                  authCalls += 1;
                  return providerSetupAuthState;
                }),
              ),
          },
        },
      });
      const session = yield* issueFixtureSession(["orchestration:read"]);
      const ticketResponse = yield* HttpClient.post("/api/auth/websocket-ticket", {
        headers: { authorization: `Bearer ${session.token}` },
      });
      const { ticket } = yield* responseJsonEffect<{ readonly ticket: string }>(ticketResponse);
      const wsUrl = `${yield* getWsServerUrl("/ws", { authenticated: false })}?wsTicket=${encodeURIComponent(ticket)}`;
      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          Effect.gen(function* () {
            const observed = yield* client[WS_METHODS.providerInstallSubscribe]({
              instanceId: providerSetupInstanceId,
            }).pipe(Stream.runHead, Effect.map(Option.getOrThrow));
            assert.deepEqual(observed, providerSetupInstallState);
            const errors = [
              yield* client[WS_METHODS.providerInstallStart]({
                instanceId: providerSetupInstanceId,
              }).pipe(Effect.flip),
              yield* client[WS_METHODS.providerAuthStart]({
                instanceId: providerSetupInstanceId,
              }).pipe(Effect.flip),
              yield* client[WS_METHODS.providerAuthSubscribe]({
                instanceId: providerSetupInstanceId,
              }).pipe(Stream.runHead, Effect.flip),
            ];
            for (const error of errors) {
              assert.equal(error._tag, "EnvironmentAuthorizationError");
              if (error._tag === "EnvironmentAuthorizationError") {
                assert.equal(error.requiredScope, "orchestration:operate");
              }
            }
          }),
        ),
      );
      assert.equal(installStarts, 0);
      assert.equal(authCalls, 0);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("provider setup binds private sign-in to the authenticated websocket session", () =>
    Effect.gen(function* () {
      const flowId = "private-sign-in-flow";
      const callbackUrl = "http://127.0.0.1:51234/?state=test-state&code=test-code";
      const waiting: ProviderAuthState = {
        ...providerSetupAuthState,
        phase: "waiting",
        flowId,
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test-state",
        expiresAt: "2026-09-02T00:05:00.000Z",
      };
      const calls: Array<{
        readonly operation: string;
        readonly instanceId: ProviderInstanceId;
        readonly ownerSessionId: string;
      }> = [];
      const forwardedCallbacks: string[] = [];
      const logoutInstances: ProviderInstanceId[] = [];
      let flowOwner = "";
      yield* buildAppUnderTest({
        layers: {
          providerAuth: {
            start: (input, ownerSessionId) =>
              Effect.sync(() => {
                flowOwner = ownerSessionId;
                calls.push({ operation: "start", instanceId: input.instanceId, ownerSessionId });
                return waiting;
              }),
            subscribe: (input, ownerSessionId) =>
              Stream.fromEffect(
                Effect.sync(() => {
                  calls.push({
                    operation: "subscribe",
                    instanceId: input.instanceId,
                    ownerSessionId,
                  });
                  return ownerSessionId === flowOwner
                    ? waiting
                    : { ...waiting, flowId: null, authorizationUrl: null, expiresAt: null };
                }),
              ),
            complete: (input, ownerSessionId) =>
              Effect.gen(function* () {
                calls.push({ operation: "complete", instanceId: input.instanceId, ownerSessionId });
                if (ownerSessionId !== flowOwner) {
                  return yield* new ProviderSetupError({
                    instanceId: input.instanceId,
                    operation: "complete",
                    detail: "This sign-in belongs to another client.",
                  });
                }
                assert.equal(input.flowId, flowId);
                forwardedCallbacks.push(input.callbackUrl);
                return { ...waiting, phase: "verifying" as const, authorizationUrl: null };
              }),
            cancel: (input, ownerSessionId) =>
              Effect.sync(() => {
                assert.equal(input.flowId, flowId);
                calls.push({ operation: "cancel", instanceId: input.instanceId, ownerSessionId });
                return { ...providerSetupAuthState, phase: "cancelled" as const, flowId };
              }),
            logout: (input) =>
              Effect.sync(() => {
                logoutInstances.push(input.instanceId);
                return providerSetupAuthState;
              }),
          },
        },
      });
      const firstCookie = yield* getAuthenticatedAuthorizationHeader();
      const secondCookie = yield* getAuthenticatedAuthorizationHeader();
      const firstClients = yield* HttpClient.get("/api/auth/clients", {
        headers: { authorization: firstCookie },
      }).pipe(
        Effect.flatMap(
          responseJsonEffect<
            ReadonlyArray<{ readonly sessionId: string; readonly current: boolean }>
          >,
        ),
      );
      const secondClients = yield* HttpClient.get("/api/auth/clients", {
        headers: { authorization: secondCookie },
      }).pipe(
        Effect.flatMap(
          responseJsonEffect<
            ReadonlyArray<{ readonly sessionId: string; readonly current: boolean }>
          >,
        ),
      );
      const firstOwner = firstClients.find((session) => session.current)?.sessionId;
      const secondOwner = secondClients.find((session) => session.current)?.sessionId;
      assert.isString(firstOwner);
      assert.isString(secondOwner);
      assert.notEqual(firstOwner, secondOwner);
      const baseWsUrl = yield* getWsServerUrl("/ws", { authenticated: false });
      const target = {
        instanceId: providerSetupInstanceId,
        ownerSessionId: "client-supplied-owner",
      };
      yield* Effect.scoped(
        withWsRpcClient(appendAuthorizationToWsUrl(baseWsUrl, firstCookie), (client) =>
          Effect.gen(function* () {
            const started = yield* client[WS_METHODS.providerAuthStart](target);
            assert.equal(started.flowId, flowId);
            const ownState = yield* client[WS_METHODS.providerAuthSubscribe](target).pipe(
              Stream.runHead,
              Effect.map(Option.getOrThrow),
            );
            assert.equal(ownState.authorizationUrl, waiting.authorizationUrl);
            yield* Effect.scoped(
              withWsRpcClient(appendAuthorizationToWsUrl(baseWsUrl, secondCookie), (otherClient) =>
                Effect.gen(function* () {
                  const otherState = yield* otherClient[WS_METHODS.providerAuthSubscribe](
                    target,
                  ).pipe(Stream.runHead, Effect.map(Option.getOrThrow));
                  assert.isNull(otherState.authorizationUrl);
                  assert.isNull(otherState.flowId);
                  const forged = { ...target, ownerSessionId: firstOwner, flowId, callbackUrl };
                  const denied = yield* otherClient[WS_METHODS.providerAuthComplete](forged).pipe(
                    Effect.flip,
                  );
                  assert.equal(denied._tag, "ProviderSetupError");
                  assert.deepEqual(forwardedCallbacks, []);
                }),
              ),
            );
            const completed = yield* client[WS_METHODS.providerAuthComplete]({
              ...target,
              flowId,
              callbackUrl,
            });
            assert.equal(completed.phase, "verifying");
            const cancelled = yield* client[WS_METHODS.providerAuthCancel]({ ...target, flowId });
            assert.equal(cancelled.phase, "cancelled");
            const signedOut = yield* client[WS_METHODS.providerAuthLogout](target);
            assert.equal(signedOut.phase, "idle");
          }),
        ),
      );
      assert.deepEqual(forwardedCallbacks, [callbackUrl]);
      assert.deepEqual(logoutInstances, [providerSetupInstanceId]);
      assert.isTrue(calls.every((call) => call.instanceId === providerSetupInstanceId));
      assert.deepEqual(
        calls.map((call) => call.ownerSessionId),
        [firstOwner, firstOwner, secondOwner, secondOwner, firstOwner, firstOwner],
      );
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "provider setup routes installation operations and returns only safe typed errors",
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        let state = providerSetupInstallState;
        yield* buildAppUnderTest({
          layers: {
            providerInstanceRegistry: {
              getInstance: (instanceId) =>
                Effect.succeed(
                  instanceId === providerSetupInstanceId ? providerSetupInstance : undefined,
                ),
            },
            antigravityInstallation: {
              start: Effect.sync(() => {
                calls.push("start");
                return state;
              }),
              cancel: (operationId) =>
                Effect.gen(function* () {
                  calls.push(`cancel:${operationId}`);
                  if (operationId !== state.operationId) {
                    return yield* new AntigravityInstallationError({
                      operation: "cancel",
                      detail: "This installation is no longer running.",
                      cause: new Error("Private download diagnostics."),
                    });
                  }
                  state = { ...state, phase: "cancelled" };
                  return state;
                }),
              changes: Stream.fromEffect(Effect.sync(() => state)),
            },
          },
        });
        const wsUrl = yield* getWsServerUrl("/ws");
        yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            Effect.gen(function* () {
              const unknownInstance = yield* client[WS_METHODS.providerInstallStart]({
                instanceId: ProviderInstanceId.make("unknown-instance"),
              }).pipe(Effect.flip);
              assert.equal(unknownInstance._tag, "ProviderSetupError");
              assert.deepEqual(calls, []);
              const started = yield* client[WS_METHODS.providerInstallStart]({
                instanceId: providerSetupInstanceId,
              });
              assert.deepEqual(started, providerSetupInstallState);
              const stale = yield* client[WS_METHODS.providerInstallCancel]({
                instanceId: providerSetupInstanceId,
                operationId: "old-operation",
              }).pipe(Effect.flip);
              assert.equal(stale._tag, "ProviderSetupError");
              if (stale._tag === "ProviderSetupError") {
                assert.equal(stale.instanceId, providerSetupInstanceId);
                assert.equal(stale.operation, "cancel");
                assert.equal(stale.detail, "This installation is no longer running.");
                assert.notProperty(stale, "cause");
              }
              const cancelled = yield* client[WS_METHODS.providerInstallCancel]({
                instanceId: providerSetupInstanceId,
                operationId: "install-operation",
              });
              assert.equal(cancelled.phase, "cancelled");
              const observed = yield* client[WS_METHODS.providerInstallSubscribe]({
                instanceId: providerSetupInstanceId,
              }).pipe(Stream.runHead, Effect.map(Option.getOrThrow));
              assert.deepEqual(observed, cancelled);
            }),
          ),
        );
        assert.deepEqual(calls, ["start", "cancel:old-operation", "cancel:install-operation"]);
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc subscribeServerConfig streams snapshot then update", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const providers = [
        {
          instanceId: ProviderInstanceId.make("codex"),
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          installed: true,
          version: "1.0.0",
          status: "ready" as const,
          auth: { status: "authenticated" as const },
          checkedAt: "2026-04-11T00:00:00.000Z",
          models: [],
          slashCommands: [],
          skills: [],
        },
      ] as const;
      const changeEvent = {
        keybindings: [],
        issues: [],
      } as const;

      yield* buildAppUnderTest({
        config: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
          otlpLogsUrl: "http://localhost:4318/v1/logs",
        },
        layers: {
          keybindings: {
            loadConfigState: Effect.succeed({
              keybindings: [],
              issues: [],
            }),
            streamChanges: Stream.succeed(changeEvent),
          },
          providerRegistry: {
            getProviders: Effect.succeed(providers),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const events = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.subscribeServerConfig]({}).pipe(Stream.take(2), Stream.runCollect),
        ),
      );

      const [first, second] = Array.from(events);
      assert.equal(first?.type, "snapshot");
      if (first?.type === "snapshot") {
        assert.equal(first.version, 1);
        assert.deepEqual(first.config.keybindings, []);
        assert.deepEqual(first.config.issues, []);
        assert.deepEqual(first.config.providers, providers);
        assert.equal(path.basename(first.config.observability.logsDirectoryPath), "logs");
        assert.equal(first.config.observability.localTracingEnabled, true);
        assert.equal(first.config.observability.otlpTracesUrl, "http://localhost:4318/v1/traces");
        assert.equal(first.config.observability.otlpTracesEnabled, true);
        assert.equal(first.config.observability.otlpMetricsUrl, "http://localhost:4318/v1/metrics");
        assert.equal(first.config.observability.otlpMetricsEnabled, true);
        assert.equal(first.config.observability.otlpLogsUrl, "http://localhost:4318/v1/logs");
        assert.equal(first.config.observability.otlpLogsEnabled, true);
        assert.deepEqual(first.config.settings, DEFAULT_SERVER_SETTINGS);
      }
      assert.deepEqual(second, {
        version: 1,
        type: "keybindingsUpdated",
        payload: { keybindings: [], issues: [] },
      });
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect.each(
    Array.from(["all", "targeted", "background"] as const, (mode) => ({
      title: `provider refresh invalidates T3 caches before probing (${mode})`,
      mode,
    })),
  )("$title", ({ mode }) => {
    const driver = ProviderDriverKind.make("codex");
    const instanceIds = [ProviderInstanceId.make("codex"), ProviderInstanceId.make("codex_work")];
    const packageNames = ["@example/personal", "@example/work"];
    const versionCache = new Map(
      packageNames.map((name) => [
        name,
        {
          expiresAt: Number.MAX_SAFE_INTEGER,
          version: "1.0.0",
        },
      ]),
    );
    const invalidated: string[] = [];
    const freshMaintenance: string[] = [];
    let manifestRefreshed = false;
    let probed = false;
    const instances = instanceIds.map(
      (instanceId, index) =>
        ({
          instanceId,
          driverKind: driver,
          continuationIdentity: { driverKind: driver, continuationKey: instanceId },
          displayName: undefined,
          enabled: true,
          invalidateCaches: Effect.sync(() => {
            invalidated.push(instanceId);
          }),
          snapshot: {
            resolveMaintenance: (options) =>
              Effect.sync(() => {
                assert.isTrue(options?.fresh);
                freshMaintenance.push(instanceId);
                return makeManualOnlyProviderMaintenanceCapabilities({
                  provider: driver,
                  packageName: packageNames[index]!,
                });
              }),
            getSnapshot: Effect.never,
            refresh: Effect.never,
            streamChanges: Stream.empty,
            applyUsageLimits: () => Effect.void,
          },
          adapter: {} as ProviderInstance["adapter"],
          textGeneration: {} as ProviderInstance["textGeneration"],
        }) satisfies ProviderInstance,
    );
    const expected =
      mode === "background" ? [] : mode === "targeted" ? [instanceIds[1]!] : instanceIds;
    const probe = Effect.sync(() => {
      probed = true;
      assert.equal(manifestRefreshed, mode !== "background");
      assert.deepEqual(invalidated.toSorted(), expected.toSorted());
      assert.deepEqual(freshMaintenance.toSorted(), expected.toSorted());
      for (let index = 0; index < instanceIds.length; index++) {
        assert.equal(
          versionCache.has(packageNames[index]!),
          !expected.includes(instanceIds[index]!),
        );
      }
      return [];
    });
    return Effect.gen(function* () {
      yield* buildAppUnderTest({
        layers: {
          modelManifest: {
            forceRefresh: Effect.sync(() => {
              manifestRefreshed = true;
              return ModelManifest.BUNDLED_MODEL_MANIFEST;
            }),
          },
          providerInstanceRegistry: { listInstances: Effect.succeed(instances) },
          providerRegistry: { refresh: () => probe, refreshInstance: () => probe },
        },
      });
      const wsUrl = yield* getWsServerUrl("/ws");
      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.serverRefreshProviders]({
            ...(mode === "targeted" ? { instanceId: instanceIds[1]! } : {}),
            ...(mode !== "background" ? { refreshModels: true } : {}),
          }),
        ),
      );
      assert.isTrue(probed);
    }).pipe(
      Effect.provideService(ProviderVersionCache, versionCache),
      Effect.provide(layerLoopbackTest()),
    );
  });

  it.effect("streams all three fixture feeds through the real Zerops RPC handlers", () =>
    Effect.gen(function* () {
      const scene = loadShowcaseScene("web:agent-auth-attention");
      yield* buildAppUnderTest({
        config: { zeropsFixtures: scene.id, zerops: undefined },
        fixtureZeropsLayer: makeFixtureZeropsLayer(scene).pipe(Layer.provide(engineHostDoubles)),
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const snapshots = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          Effect.all(
            {
              lifecycle: client[WS_METHODS.subscribeZeropsLifecycle]({
                threadId: scene.lifecycle.threadId,
              }).pipe(Stream.runHead, Effect.map(Option.getOrThrow)),
              agentAuth: client[WS_METHODS.subscribeZeropsAgentAuth]({}).pipe(
                Stream.runHead,
                Effect.map(Option.getOrThrow),
              ),
              attention: client[WS_METHODS.subscribeZeropsAttention]({}).pipe(
                Stream.runHead,
                Effect.map(Option.getOrThrow),
              ),
            },
            { concurrency: "unbounded" },
          ),
        ).pipe(
          Effect.timeoutOrElse({
            duration: "5 seconds",
            orElse: () => Effect.die(new Error("Timed out waiting for fixture feed snapshots")),
          }),
        ),
      );

      assert.deepEqual(snapshots.lifecycle, scene.lifecycle);
      assert.deepEqual(snapshots.attention, FIXTURE_ATTENTION);
      // The agent rows exactly as the scene has them, and the two default
      // logins they are: a fixture keeps no other login.
      assert.deepEqual(
        snapshots.agentAuth,
        ZeropsAgentLoginModule.combineAgentAuth(scene.agentAuth, [], {
          "claude-code": scene.agentLogin["claude-code"],
          codex: scene.agentLogin.codex,
        }),
      );
    }).pipe(Effect.provide(layerLoopbackTest()), TestClock.withLive),
  );

  it.effect("subscribeZeropsBrowserStream applies flow control (Ack after every Chunk)", () =>
    Effect.gen(function* () {
      // A real (non-mocked) service instance publishing "no-browser" forever
      // (`readStreamPort` never resolves, `reconnectDelaysMs: [0]`) so a
      // real acking `RpcClient` pulling MORE THAN ONE Chunk is proof the
      // per-request Ack loop the effect-rpc protocol requires (spec-mate.md
      // §5.5) actually runs over the real websocket, not just proof the
      // handler exists — a client that never acked would receive exactly
      // one Chunk and stall.
      const browserStream = yield* ZeropsBrowserStreamModule.make({
        readStreamPort: Effect.succeed(undefined),
        connect: () => {
          throw new Error("unreachable: readStreamPort never resolves a port");
        },
        reconnectDelaysMs: [0],
      });
      yield* buildAppUnderTest({
        layers: {
          zeropsBrowserStream: {
            subscribe: browserStream.subscribe,
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const events = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.subscribeZeropsBrowserStream]({}).pipe(
            Stream.take(3),
            Stream.runCollect,
          ),
        ),
      ).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.die(new Error("Timed out waiting for browser stream chunks")),
        }),
      );

      assert.equal(events.length, 3);
      for (const event of events) {
        assert.deepEqual(event, { type: "state", status: "no-browser" });
      }
    }).pipe(Effect.provide(layerLoopbackTest()), TestClock.withLive),
  );

  it.effect("answers zerops.lifecycle.get for a thread over the websocket", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const state = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.zeropsLifecycleGet]({ threadId: ThreadId.make("thread-1") }),
        ),
      );

      assert.equal(state.threadId, "thread-1");
      assert.equal(state.recentTools.length, 0);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("serves config on reconnect without starting provider probes", () =>
    Effect.gen(function* () {
      const refresh = vi.fn(() => Effect.never);
      yield* buildAppUnderTest({
        layers: { providerRegistry: { refresh } },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      for (let connection = 0; connection < 2; connection += 1) {
        const event = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.subscribeServerConfig]({}).pipe(
              Stream.runHead,
              Effect.map(Option.getOrThrow),
            ),
          ),
        );
        assert.equal(event.type, "snapshot");
      }
      assert.equal(refresh.mock.calls.length, 0);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket resource telemetry through the subscription", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const snapshot = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.subscribeResourceTelemetry]({}).pipe(Stream.runHead),
        ),
      );

      assertTrue(Option.isSome(snapshot));
      assert.equal(snapshot.value.processes.length, 0);
      assert.equal(snapshot.value.groups.backend.processCount, 0);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect.each([false, true])(
    "routes websocket rpc subscribeServerConfig emits provider status updates (limits: %s)",
    (hasLimits) =>
      Effect.gen(function* () {
        const nextProviders = [
          {
            instanceId: ProviderInstanceId.make("codex"),
            driver: ProviderDriverKind.make("codex"),
            enabled: true,
            installed: true,
            version: "1.0.0",
            status: "ready" as const,
            auth: { status: "authenticated" as const },
            checkedAt: "2026-04-11T00:00:00.000Z",
            models: [],
            slashCommands: [],
            skills: [],
            ...(hasLimits
              ? {
                  usageLimits: {
                    checkedAt: "2026-04-11T00:00:00.000Z",
                    windows: [
                      { id: "weekly", kind: "weekly" as const, label: "Weekly", usedPercent: 25 },
                    ],
                  },
                }
              : {}),
          },
        ] as const;

        yield* buildAppUnderTest({
          layers: {
            keybindings: {
              loadConfigState: Effect.succeed({
                keybindings: [],
                issues: [],
              }),
              streamChanges: Stream.empty,
            },
            providerRegistry: {
              getProviders: Effect.succeed([]),
              streamChanges: Stream.succeed(nextProviders),
            },
          },
        });

        const wsUrl = yield* getWsServerUrl("/ws");
        const events = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.subscribeServerConfig]({ usageLimitsCommand: true }).pipe(
              Stream.take(2),
              Stream.runCollect,
            ),
          ),
        );

        const [first, second] = Array.from(events);
        assert.equal(first?.type, "snapshot");
        if (first?.type === "snapshot") {
          assert.deepEqual(first.config.providers, []);
        }
        assert.deepEqual(second, {
          version: 1,
          type: "providerStatuses",
          payload: {
            providers: hasLimits
              ? [
                  {
                    ...nextProviders[0],
                    slashCommands: [
                      {
                        name: "usage-limits",
                        description: "Show this provider's usage limits",
                      },
                    ],
                  },
                ]
              : nextProviders,
          },
        });
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "routes websocket rpc subscribeServerConfig keeps the limits command from clients that do not ask for it",
    () =>
      Effect.gen(function* () {
        const codex = {
          instanceId: ProviderInstanceId.make("codex"),
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          installed: true,
          version: "1.0.0",
          status: "ready" as const,
          auth: { status: "authenticated" as const },
          checkedAt: "2026-04-11T00:00:00.000Z",
          models: [],
          slashCommands: [],
          skills: [],
          usageLimits: {
            checkedAt: "2026-04-11T00:00:00.000Z",
            windows: [{ id: "weekly", kind: "weekly" as const, label: "Weekly", usedPercent: 25 }],
          },
        };
        yield* buildAppUnderTest({
          layers: {
            keybindings: {
              loadConfigState: Effect.succeed({ keybindings: [], issues: [] }),
              streamChanges: Stream.empty,
            },
            providerRegistry: {
              getProviders: Effect.succeed([codex]),
              streamChanges: Stream.succeed([{ ...codex, version: "1.0.1" }]),
            },
          },
        });

        const wsUrl = yield* getWsServerUrl("/ws");
        const events = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.subscribeServerConfig]({}).pipe(Stream.take(2), Stream.runCollect),
          ),
        );

        const [first, second] = Array.from(events);
        assert.equal(first?.type, "snapshot");
        if (first?.type === "snapshot") {
          assert.deepEqual(first.config.providers, [codex]);
        }
        assert.deepEqual(second, {
          version: 1,
          type: "providerStatuses",
          payload: { providers: [{ ...codex, version: "1.0.1" }] },
        });
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "routes websocket rpc subscribeServerConfig leaves out the slash commands a Mate cannot use",
    () =>
      Effect.gen(function* () {
        const claude = {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          installed: true,
          version: "1.0.0",
          status: "ready" as const,
          auth: { status: "authenticated" as const },
          checkedAt: "2026-04-11T00:00:00.000Z",
          models: [],
          slashCommands: [{ name: "clear" }, { name: "compact" }],
          skills: [],
        };
        yield* buildAppUnderTest({
          layers: {
            keybindings: {
              loadConfigState: Effect.succeed({ keybindings: [], issues: [] }),
              streamChanges: Stream.empty,
            },
            providerRegistry: {
              getProviders: Effect.succeed([claude]),
              streamChanges: Stream.succeed([{ ...claude, version: "1.0.1" }]),
            },
          },
        });

        const wsUrl = yield* getWsServerUrl("/ws");
        const events = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.subscribeServerConfig]({}).pipe(Stream.take(2), Stream.runCollect),
          ),
        );

        const [first, second] = Array.from(events);
        const commandNames = (
          providers: ReadonlyArray<{ slashCommands: ReadonlyArray<{ name: string }> }>,
        ) => providers.flatMap((provider) => provider.slashCommands.map((command) => command.name));
        assert.equal(first?.type, "snapshot");
        if (first?.type === "snapshot") {
          assert.deepEqual(commandNames(first.config.providers), ["compact"]);
        }
        assert.equal(second?.type, "providerStatuses");
        if (second?.type === "providerStatuses") {
          assert.deepEqual(commandNames(second.payload.providers), ["compact"]);
        }
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "routes websocket rpc subscribeServerConfig republishes commands when only a limits source changes",
    () =>
      Effect.gen(function* () {
        const codex = {
          instanceId: ProviderInstanceId.make("codex"),
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          installed: true,
          version: "1.0.0",
          status: "ready" as const,
          auth: { status: "authenticated" as const },
          checkedAt: "2026-04-11T00:00:00.000Z",
          models: [],
          slashCommands: [],
          skills: [],
        };
        const hub = {
          id: UsageLimitSourceId.make("hub"),
          kind: "cliproxy" as const,
          label: "Accounts",
          checkedAt: "2026-04-11T00:00:00.000Z",
          accounts: [
            {
              id: "work",
              driver: ProviderDriverKind.make("codex"),
              usageLimits: {
                checkedAt: "2026-04-11T00:00:00.000Z",
                windows: [
                  { id: "weekly", kind: "weekly" as const, label: "Weekly", usedPercent: 25 },
                ],
              },
            },
          ],
        };

        yield* buildAppUnderTest({
          layers: {
            keybindings: {
              loadConfigState: Effect.succeed({ keybindings: [], issues: [] }),
              streamChanges: Stream.empty,
            },
            // The registry emits no change: only the source refresh can carry it.
            providerRegistry: {
              getProviders: Effect.succeed([codex]),
              streamChanges: Stream.empty,
            },
            usageLimitSources: {
              current: Effect.succeed([]),
              // Replay the empty snapshot, then a later refresh, as the live stream does.
              streamChanges: Stream.concat(Stream.make([]), Stream.make([hub])),
            },
          },
        });

        const wsUrl = yield* getWsServerUrl("/ws");
        const events = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.subscribeServerConfig]({ usageLimitsCommand: true }).pipe(
              Stream.take(2),
              Stream.runCollect,
            ),
          ),
        );

        const [first, second] = Array.from(events);
        assert.equal(first?.type, "snapshot");
        if (first?.type === "snapshot") {
          assert.deepEqual(first.config.providers, [codex]);
        }
        assert.deepEqual(second, {
          version: 1,
          type: "providerStatuses",
          payload: {
            providers: [
              {
                ...codex,
                slashCommands: [
                  { name: "usage-limits", description: "Show this provider's usage limits" },
                ],
              },
            ],
          },
        });
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "routes websocket rpc subscribeServerLifecycle replays snapshot and streams updates",
    () =>
      Effect.gen(function* () {
        const lifecycleEvents = [
          {
            version: 1 as const,
            sequence: 1,
            type: "welcome" as const,
            payload: {
              environment: testEnvironmentDescriptor,
              cwd: "/tmp/project",
              projectName: "project",
            },
          },
        ] as const;
        const liveEvents = Stream.make({
          version: 1 as const,
          sequence: 2,
          type: "ready" as const,
          payload: { at: "2026-01-01T00:00:00.000Z", environment: testEnvironmentDescriptor },
        });

        yield* buildAppUnderTest({
          layers: {
            serverLifecycleEvents: {
              snapshot: Effect.succeed({
                sequence: 1,
                events: lifecycleEvents,
              }),
              stream: liveEvents,
            },
          },
        });

        const wsUrl = yield* getWsServerUrl("/ws");
        const events = yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.subscribeServerLifecycle]({}).pipe(Stream.take(2), Stream.runCollect),
          ),
        );

        const [first, second] = Array.from(events);
        assert.equal(first?.type, "welcome");
        assert.equal(first?.sequence, 1);
        assert.equal(second?.type, "ready");
        assert.equal(second?.sequence, 2);
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc projects.searchEntries", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-project-search-" });
      yield* fs.writeFileString(
        path.join(workspaceDir, "needle-file.ts"),
        "export const needle = 1;",
      );

      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectsSearchEntries]({
            cwd: workspaceDir,
            query: "needle",
            limit: 10,
          }),
        ),
      );

      assert.isAtLeast(response.entries.length, 1);
      assert.isTrue(response.entries.some((entry) => entry.path === "needle-file.ts"));
      assert.equal(response.truncated, false);
    }).pipe(Effect.provide(layerLoopbackTest()), TestClock.withLive),
  );

  it.effect("routes websocket rpc projects.listEntries and projects.readFile", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-project-files-" });
      yield* fs.makeDirectory(path.join(workspaceDir, "src"), { recursive: true });
      yield* fs.writeFileString(
        path.join(workspaceDir, "src", "index.ts"),
        "export const answer = 42;\n",
      );

      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          Effect.all({
            listing: client[WS_METHODS.projectsListEntries]({ cwd: workspaceDir }),
            file: client[WS_METHODS.projectsReadFile]({
              cwd: workspaceDir,
              relativePath: "src/index.ts",
            }),
          }),
        ),
      );

      assert.isTrue(response.listing.entries.some((entry) => entry.path === "src/index.ts"));
      assert.deepEqual(response.file, {
        relativePath: "src/index.ts",
        contents: "export const answer = 42;\n",
        byteLength: 26,
        truncated: false,
      });
    }).pipe(Effect.provide(layerLoopbackTest()), TestClock.withLive),
  );

  it.effect("routes websocket rpc projects.searchEntries excludes gitignored files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceDir = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-ws-project-search-gitignored-",
      });
      yield* fs.writeFileString(path.join(workspaceDir, ".gitignore"), ".venv/\n");
      yield* fs.makeDirectory(path.join(workspaceDir, ".venv", "lib"), { recursive: true });
      yield* fs.writeFileString(
        path.join(workspaceDir, ".venv", "lib", "ignored-search-target.ts"),
        "export const ignored = true;",
      );
      yield* fs.makeDirectory(path.join(workspaceDir, "src"), { recursive: true });
      yield* fs.writeFileString(
        path.join(workspaceDir, "src", "tracked.ts"),
        "export const ok = 1;",
      );

      yield* buildAppUnderTest({
        layers: {
          vcsDriver: {
            isInsideWorkTree: () => Effect.succeed(true),
            listWorkspaceFiles: () =>
              Effect.succeed({
                paths: ["src/tracked.ts"],
                truncated: false,
                freshness: {
                  source: "live-local",
                  observedAt: TEST_EPOCH,
                  expiresAt: Option.none(),
                },
              }),
            filterIgnoredPaths: (_cwd, relativePaths) =>
              Effect.succeed(
                relativePaths.filter((relativePath) => !relativePath.startsWith(".venv/")),
              ),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectsSearchEntries]({
            cwd: workspaceDir,
            query: "ignored-search-target",
            limit: 10,
          }),
        ),
      );

      assert.equal(response.entries.length, 0);
      assert.equal(response.truncated, false);
    }).pipe(Effect.provide(layerLoopbackTest()), TestClock.withLive),
  );

  it.effect.skipIf(!symlinksSupported)("preserves structured workspace rpc failures", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceDir = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-ws-workspace-errors-",
      });
      const outsideDir = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-ws-workspace-errors-outside-",
      });
      const outsideFile = path.join(outsideDir, "outside.txt");
      yield* fs.writeFileString(outsideFile, "outside\n");
      yield* fs.symlink(outsideFile, path.join(workspaceDir, "linked-outside.txt"));
      const resolvedOutsideFile = yield* fs.realPath(outsideFile);

      yield* buildAppUnderTest();

      const invalidWorkspace = path.join(workspaceDir, "missing-workspace");
      const missingBrowseParent = path.join(workspaceDir, "missing-browse");
      const sensitiveQuery = "authorization: Bearer secret-token";
      const wsUrl = yield* getWsServerUrl("/ws");
      const results = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          Effect.all({
            search: client[WS_METHODS.projectsSearchEntries]({
              cwd: invalidWorkspace,
              query: sensitiveQuery,
              limit: 10,
            }).pipe(Effect.result),
            list: client[WS_METHODS.projectsListEntries]({ cwd: invalidWorkspace }).pipe(
              Effect.result,
            ),
            read: client[WS_METHODS.projectsReadFile]({
              cwd: workspaceDir,
              relativePath: "linked-outside.txt",
            }).pipe(Effect.result),
            browse: client[WS_METHODS.filesystemBrowse]({
              cwd: workspaceDir,
              partialPath: "./missing-browse/child",
            }).pipe(Effect.result),
          }),
        ),
      );

      if (
        results.search._tag !== "Failure" ||
        results.search.failure._tag !== "ProjectSearchEntriesError"
      ) {
        assert.fail("Expected a ProjectSearchEntriesError");
      }
      const searchError = results.search.failure;
      assert.equal(
        searchError.message,
        `Failed to search workspace entries in '${invalidWorkspace}'.`,
      );
      assert.equal(searchError.cwd, invalidWorkspace);
      assert.equal(searchError.queryLength, sensitiveQuery.length);
      assert.notProperty(searchError, "query");
      assert.notInclude(searchError.message, "Bearer");
      assert.notInclude(searchError.message, "secret-token");
      assert.equal(searchError.limit, 10);
      assert.equal(searchError.failure, "workspace_root_not_found");
      assert.equal(searchError.normalizedCwd, invalidWorkspace);
      assert.isDefined(searchError.cause);

      if (
        results.list._tag !== "Failure" ||
        results.list.failure._tag !== "ProjectListEntriesError"
      ) {
        assert.fail("Expected a ProjectListEntriesError");
      }
      const listError = results.list.failure;
      assert.equal(listError.message, `Failed to list workspace entries in '${invalidWorkspace}'.`);
      assert.equal(listError.cwd, invalidWorkspace);
      assert.equal(listError.failure, "workspace_root_not_found");
      assert.equal(listError.normalizedCwd, invalidWorkspace);
      assert.isDefined(listError.cause);

      if (results.read._tag !== "Failure" || results.read.failure._tag !== "ProjectReadFileError") {
        assert.fail("Expected a ProjectReadFileError");
      }
      const readError = results.read.failure;
      assert.equal(
        readError.message,
        `Failed to read workspace file 'linked-outside.txt' in '${workspaceDir}'.`,
      );
      assert.equal(readError.cwd, workspaceDir);
      assert.equal(readError.relativePath, "linked-outside.txt");
      assert.equal(readError.failure, "resolved_path_outside_root");
      assert.equal(readError.resolvedPath, resolvedOutsideFile);
      assert.isDefined(readError.cause);

      if (
        results.browse._tag !== "Failure" ||
        results.browse.failure._tag !== "FilesystemBrowseError"
      ) {
        assert.fail("Expected a FilesystemBrowseError");
      }
      const browseError = results.browse.failure;
      assert.equal(
        browseError.message,
        `Failed to browse filesystem path './missing-browse/child' from '${workspaceDir}'.`,
      );
      assert.equal(browseError.cwd, workspaceDir);
      assert.equal(browseError.partialPath, "./missing-browse/child");
      assert.equal(browseError.failure, "read_directory_failed");
      assert.equal(browseError.parentPath, missingBrowseParent);
      assert.isDefined(browseError.cause);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("reports workspace root stat failures without relabeling them as missing", () =>
    Effect.gen(function* () {
      if ((yield* HostProcessPlatform) === "win32") return;

      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const blockedRoot = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-ws-workspace-stat-error-",
      });
      const workspaceRoot = path.join(blockedRoot, "workspace");
      yield* fs.makeDirectory(workspaceRoot);
      yield* fs.chmod(blockedRoot, 0o000);

      const result = yield* Effect.gen(function* () {
        yield* buildAppUnderTest();
        const wsUrl = yield* getWsServerUrl("/ws");
        return yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.projectsListEntries]({ cwd: workspaceRoot }).pipe(Effect.result),
          ),
        );
      }).pipe(Effect.ensuring(fs.chmod(blockedRoot, 0o700).pipe(Effect.ignore)));

      if (result._tag !== "Failure" || result.failure._tag !== "ProjectListEntriesError") {
        assert.fail("Expected a ProjectListEntriesError");
      }
      const error = result.failure;
      assert.equal(error.failure, "workspace_root_stat_failed");
      assert.equal(error.normalizedCwd, workspaceRoot);
      assert.equal(error.detail, "validate-existing");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc projects.writeFile", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspaceDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-project-write-" });

      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectsWriteFile]({
            cwd: workspaceDir,
            relativePath: "nested/created.txt",
            contents: "written-by-rpc",
          }),
        ),
      );

      assert.equal(response.relativePath, "nested/created.txt");
      const persisted = yield* fs.readFileString(path.join(workspaceDir, "nested", "created.txt"));
      assert.equal(persisted, "written-by-rpc");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc projects.writeFile errors", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ws-project-write-" });

      yield* buildAppUnderTest();

      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.projectsWriteFile]({
            cwd: workspaceDir,
            relativePath: "../escape.txt",
            contents: "nope",
          }),
        ).pipe(Effect.result),
      );

      if (result._tag !== "Failure" || result.failure._tag !== "ProjectWriteFileError") {
        assert.fail("Expected a ProjectWriteFileError");
      }
      const writeError = result.failure;
      assert.equal(
        writeError.message,
        `Failed to write workspace file '../escape.txt' in '${workspaceDir}'.`,
      );
      assert.equal(writeError.cwd, workspaceDir);
      assert.equal(writeError.relativePath, "../escape.txt");
      assert.equal(writeError.failure, "workspace_path_outside_root");
      assert.isDefined(writeError.cause);
      assert.notProperty(writeError, "contents");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc shell.openInEditor", () =>
    Effect.gen(function* () {
      let openedInput: { cwd: string; editor: EditorId } | null = null;
      yield* buildAppUnderTest({
        layers: {
          externalLauncher: {
            launchEditor: (input) =>
              Effect.sync(() => {
                openedInput = input;
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.shellOpenInEditor]({
            cwd: "/tmp/project",
            editor: "cursor",
          }),
        ),
      );

      assert.deepEqual(openedInput, { cwd: "/tmp/project", editor: "cursor" });
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc shell.openInEditor errors", () =>
    Effect.gen(function* () {
      const externalLauncherError = new ExternalLauncherCommandNotFoundError({
        editor: "cursor",
        command: "cursor",
      });
      yield* buildAppUnderTest({
        layers: {
          externalLauncher: {
            launchEditor: () => Effect.fail(externalLauncherError),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.shellOpenInEditor]({
            cwd: "/tmp/project",
            editor: "cursor",
          }),
        ).pipe(Effect.result),
      );

      assertFailure(result, externalLauncherError);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc git methods", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: {
          cwd: "/tmp/repo",
        },
        layers: {
          vcsDriver: {
            isInsideWorkTree: () => Effect.succeed(true),
          },
          gitManager: {
            invalidateLocalStatus: () => Effect.void,
            invalidateRemoteStatus: () => Effect.void,
            invalidateStatus: () => Effect.void,
            localStatus: () =>
              Effect.succeed({
                isRepo: true,
                hasPrimaryRemote: true,
                isDefaultRef: true,
                refName: "main",
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
              }),
            remoteStatus: () =>
              Effect.succeed({
                hasUpstream: true,
                aheadCount: 0,
                behindCount: 0,
                pr: null,
              }),
            status: () =>
              Effect.succeed({
                isRepo: true,
                hasPrimaryRemote: true,
                isDefaultRef: true,
                refName: "main",
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
                hasUpstream: true,
                aheadCount: 0,
                behindCount: 0,
                pr: null,
              }),
            runStackedAction: (input, options) =>
              Effect.gen(function* () {
                const result = {
                  action: "commit" as const,
                  branch: { status: "skipped_not_requested" as const },
                  commit: {
                    status: "created" as const,
                    commitSha: "abc123",
                    subject: "feat: demo",
                  },
                  push: { status: "skipped_not_requested" as const },
                  pr: { status: "skipped_not_requested" as const },
                  toast: {
                    title: "Committed abc123",
                    description: "feat: demo",
                    cta: {
                      kind: "run_action" as const,
                      label: "Push",
                      action: {
                        kind: "push" as const,
                      },
                    },
                  },
                };

                yield* (
                  options?.progressReporter?.publish({
                    actionId: options.actionId ?? input.actionId,
                    cwd: input.cwd,
                    action: input.action,
                    kind: "phase_started",
                    phase: "commit",
                    label: "Committing...",
                  }) ?? Effect.void
                );

                yield* (
                  options?.progressReporter?.publish({
                    actionId: options.actionId ?? input.actionId,
                    cwd: input.cwd,
                    action: input.action,
                    kind: "action_finished",
                    result,
                  }) ?? Effect.void
                );

                return result;
              }),
            resolvePullRequest: () =>
              Effect.succeed({
                pullRequest: {
                  number: 1,
                  title: "Demo PR",
                  url: "https://example.com/pr/1",
                  baseBranch: "main",
                  headBranch: "feature/demo",
                  state: "open",
                },
              }),
            preparePullRequestThread: () =>
              Effect.succeed({
                pullRequest: {
                  number: 1,
                  title: "Demo PR",
                  url: "https://example.com/pr/1",
                  baseBranch: "main",
                  headBranch: "feature/demo",
                  state: "open",
                },
                branch: "feature/demo",
                worktreePath: null,
                isOnPullRequestHead: true,
              }),
          },
          gitVcsDriver: {
            pullCurrentBranch: () =>
              Effect.succeed({
                status: "pulled",
                refName: "main",
                upstreamRef: "origin/main",
              }),
            listRefs: () =>
              Effect.succeed({
                refs: [
                  {
                    name: "main",
                    current: true,
                    isDefault: true,
                    worktreePath: null,
                  },
                ],
                isRepo: true,
                hasPrimaryRemote: true,
                nextCursor: null,
                totalCount: 1,
              }),
            createWorktree: () =>
              Effect.succeed({
                worktree: { path: "/tmp/wt", refName: "feature/demo" },
              }),
            removeWorktree: () => Effect.void,
            createRef: (input) => Effect.succeed({ refName: input.refName }),
            switchRef: (input) => Effect.succeed({ refName: input.refName }),
          },
          vcsStatusBroadcaster: {
            refreshStatus: () =>
              Effect.succeed({
                isRepo: true,
                hasPrimaryRemote: true,
                isDefaultRef: true,
                refName: "main",
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
                hasUpstream: true,
                aheadCount: 0,
                behindCount: 0,
                pr: null,
              }),
          },
          reviewService: {
            getDiffPreview: (input) =>
              Effect.succeed({
                cwd: input.cwd,
                generatedAt: DateTime.nowUnsafe(),
                sources: [
                  {
                    id: "working-tree",
                    kind: "working-tree",
                    title: "Dirty worktree",
                    baseRef: "HEAD",
                    headRef: null,
                    diff: "dirty-diff",
                    diffHash: "hash-dirty",
                    truncated: false,
                  },
                  {
                    id: "branch-range",
                    kind: "branch-range",
                    title: "Against main",
                    baseRef: "main",
                    headRef: "feature/demo",
                    diff: "base-diff",
                    diffHash: "hash-base",
                    truncated: false,
                  },
                ],
              }),
            getDiffFileContents: () =>
              Effect.succeed({
                oldContents: "before\n",
                newContents: "after\n",
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");

      const pull = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.vcsPull]({ cwd: "/tmp/repo" })),
      );
      assert.equal(pull.status, "pulled");

      const refreshedStatus = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.vcsRefreshStatus]({ cwd: "/tmp/repo" }),
        ),
      );
      assert.equal(refreshedStatus.isRepo, true);

      const stackedEvents = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitRunStackedAction]({
            actionId: "action-1",
            cwd: "/tmp/repo",
            action: "commit",
          }).pipe(
            Stream.runCollect,
            Effect.map((events) => Array.from(events)),
          ),
        ),
      );
      const lastStackedEvent = stackedEvents.at(-1);
      assert.equal(lastStackedEvent?.kind, "action_finished");
      if (lastStackedEvent?.kind === "action_finished") {
        assert.equal(lastStackedEvent.result.action, "commit");
      }

      const resolvedPr = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitResolvePullRequest]({
            cwd: "/tmp/repo",
            reference: "1",
          }),
        ),
      );
      assert.equal(resolvedPr.pullRequest.number, 1);

      const prepared = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitPreparePullRequestThread]({
            cwd: "/tmp/repo",
            reference: "1",
            mode: "local",
          }),
        ),
      );
      assert.equal(prepared.branch, "feature/demo");

      const refs = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.vcsListRefs]({ cwd: "/tmp/repo" })),
      );
      assert.equal(refs.refs[0]?.name, "main");

      const worktree = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.vcsCreateWorktree]({
            cwd: "/tmp/repo",
            refName: "main",
            path: null,
          }),
        ),
      );
      assert.equal(worktree.worktree.refName, "feature/demo");

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.vcsRemoveWorktree]({
            cwd: "/tmp/repo",
            path: "/tmp/wt",
          }),
        ),
      );

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.vcsCreateRef]({
            cwd: "/tmp/repo",
            refName: "feature/new",
          }),
        ),
      );

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.vcsSwitchRef]({
            cwd: "/tmp/repo",
            refName: "main",
          }),
        ),
      );

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.vcsInit]({
            cwd: "/tmp/repo",
          }),
        ),
      );

      const diffPreview = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.reviewGetDiffPreview]({ cwd: "/tmp/repo" }),
        ),
      );
      assert.equal(diffPreview.sources[0]?.diff, "dirty-diff");

      const diffFileContents = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.reviewGetDiffFileContents]({
            cwd: "/tmp/repo",
            sourceKind: "working-tree",
            changeType: "change",
            baseRef: "HEAD",
            headRef: null,
            oldPath: "README.md",
            newPath: "README.md",
          }),
        ),
      );
      assert.equal(diffFileContents.oldContents, "before\n");
      assert.equal(diffFileContents.newContents, "after\n");
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc git.pull errors", () =>
    Effect.gen(function* () {
      const gitError = new GitCommandError({
        operation: "pull",
        command: "git pull --ff-only",
        cwd: "/tmp/repo",
        detail: "upstream missing",
      });
      let invalidationCalls = 0;
      let statusCalls = 0;
      yield* buildAppUnderTest({
        layers: {
          gitVcsDriver: {
            pullCurrentBranch: () => Effect.fail(gitError),
          },
          gitManager: {
            invalidateLocalStatus: () =>
              Effect.sync(() => {
                invalidationCalls += 1;
              }),
            invalidateRemoteStatus: () =>
              Effect.sync(() => {
                invalidationCalls += 1;
              }),
            invalidateStatus: () =>
              Effect.sync(() => {
                invalidationCalls += 1;
              }),
            localStatus: () =>
              Effect.succeed({
                isRepo: true,
                hasPrimaryRemote: true,
                isDefaultRef: true,
                refName: "main",
                hasWorkingTreeChanges: true,
                workingTree: { files: [], insertions: 0, deletions: 0 },
              }),
            remoteStatus: () =>
              Effect.sync(() => {
                statusCalls += 1;
                return {
                  hasUpstream: true,
                  aheadCount: 0,
                  behindCount: 0,
                  pr: null,
                };
              }),
            status: () =>
              Effect.sync(() => {
                statusCalls += 1;
                return {
                  isRepo: true,
                  hasPrimaryRemote: true,
                  isDefaultRef: true,
                  refName: "main",
                  hasWorkingTreeChanges: true,
                  workingTree: { files: [], insertions: 0, deletions: 0 },
                  hasUpstream: true,
                  aheadCount: 0,
                  behindCount: 0,
                  pr: null,
                };
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.vcsPull]({ cwd: "/tmp/repo" })).pipe(
          Effect.result,
        ),
      );

      assertFailure(result, gitError);
      assert.equal(invalidationCalls, 0);
      assert.equal(statusCalls, 0);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc git.runStackedAction errors after refreshing git status", () =>
    Effect.gen(function* () {
      const gitError = new GitCommandError({
        operation: "commit",
        command: "git commit",
        cwd: "/tmp/repo",
        detail: "nothing to commit",
      });
      let invalidationCalls = 0;
      let statusCalls = 0;
      yield* buildAppUnderTest({
        layers: {
          gitManager: {
            invalidateLocalStatus: () =>
              Effect.sync(() => {
                invalidationCalls += 1;
              }),
            invalidateRemoteStatus: () =>
              Effect.sync(() => {
                invalidationCalls += 1;
              }),
            invalidateStatus: () =>
              Effect.sync(() => {
                invalidationCalls += 1;
              }),
            localStatus: () =>
              Effect.succeed({
                isRepo: true,
                hasPrimaryRemote: true,
                isDefaultRef: false,
                refName: "feature/demo",
                hasWorkingTreeChanges: true,
                workingTree: { files: [], insertions: 0, deletions: 0 },
              }),
            remoteStatus: () =>
              Effect.sync(() => {
                statusCalls += 1;
                return {
                  hasUpstream: true,
                  aheadCount: 0,
                  behindCount: 0,
                  pr: null,
                };
              }),
            status: () =>
              Effect.sync(() => {
                statusCalls += 1;
                return {
                  isRepo: true,
                  hasPrimaryRemote: true,
                  isDefaultRef: false,
                  refName: "feature/demo",
                  hasWorkingTreeChanges: true,
                  workingTree: { files: [], insertions: 0, deletions: 0 },
                  hasUpstream: true,
                  aheadCount: 0,
                  behindCount: 0,
                  pr: null,
                };
              }),
            runStackedAction: () => Effect.fail(gitError),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.gitRunStackedAction]({
            actionId: "action-1",
            cwd: "/tmp/repo",
            action: "commit",
          }).pipe(Stream.runCollect, Effect.result),
        ),
      );

      assertFailure(result, gitError);
      assert.equal(invalidationCalls, 0);
      assert.equal(statusCalls, 0);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("completes websocket rpc git.pull before background git status refresh finishes", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        layers: {
          gitVcsDriver: {
            pullCurrentBranch: () =>
              Effect.succeed({
                status: "pulled" as const,
                refName: "main",
                upstreamRef: "origin/main",
              }),
          },
          gitManager: {
            invalidateLocalStatus: () => Effect.void,
            invalidateRemoteStatus: () => Effect.void,
            invalidateStatus: () => Effect.void,
            localStatus: () =>
              Effect.succeed({
                isRepo: true,
                hasPrimaryRemote: true,
                isDefaultRef: true,
                refName: "main",
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
              }),
            remoteStatus: () =>
              Effect.sleep(Duration.seconds(2)).pipe(
                Effect.as({
                  hasUpstream: true,
                  aheadCount: 0,
                  behindCount: 0,
                  pr: null,
                }),
              ),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const startedAt = yield* Clock.currentTimeMillis;
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) => client[WS_METHODS.vcsPull]({ cwd: "/tmp/repo" })),
      );
      const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;

      assert.equal(result.status, "pulled");
      assertTrue(elapsedMs < 1_000);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "completes websocket rpc git.runStackedAction before background git status refresh finishes",
    () =>
      Effect.gen(function* () {
        yield* buildAppUnderTest({
          layers: {
            vcsDriver: {
              isInsideWorkTree: () => Effect.succeed(true),
            },
            gitManager: {
              invalidateLocalStatus: () => Effect.void,
              invalidateRemoteStatus: () => Effect.void,
              invalidateStatus: () => Effect.void,
              localStatus: () =>
                Effect.succeed({
                  isRepo: true,
                  hasPrimaryRemote: true,
                  isDefaultRef: false,
                  refName: "feature/demo",
                  hasWorkingTreeChanges: false,
                  workingTree: { files: [], insertions: 0, deletions: 0 },
                }),
              remoteStatus: () =>
                Effect.sleep(Duration.seconds(2)).pipe(
                  Effect.as({
                    hasUpstream: true,
                    aheadCount: 0,
                    behindCount: 0,
                    pr: null,
                  }),
                ),
              runStackedAction: () =>
                Effect.succeed({
                  action: "commit" as const,
                  branch: { status: "skipped_not_requested" as const },
                  commit: {
                    status: "created" as const,
                    commitSha: "abc123",
                    subject: "feat: demo",
                  },
                  push: { status: "skipped_not_requested" as const },
                  pr: { status: "skipped_not_requested" as const },
                  toast: {
                    title: "Committed abc123",
                    description: "feat: demo",
                    cta: {
                      kind: "run_action" as const,
                      label: "Push",
                      action: {
                        kind: "push" as const,
                      },
                    },
                  },
                }),
            },
          },
        });

        const wsUrl = yield* getWsServerUrl("/ws");
        const startedAt = yield* Clock.currentTimeMillis;
        yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.gitRunStackedAction]({
              actionId: "action-1",
              cwd: "/tmp/repo",
              action: "commit",
            }).pipe(Stream.runCollect),
          ),
        );
        const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;

        assertTrue(elapsedMs < 1_000);
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect(
    "starts a background local git status refresh after a successful git.runStackedAction",
    () =>
      Effect.gen(function* () {
        const localRefreshStarted = yield* Deferred.make<void>();

        yield* buildAppUnderTest({
          layers: {
            vcsDriver: {
              isInsideWorkTree: () => Effect.succeed(true),
            },
            gitManager: {
              invalidateLocalStatus: () => Effect.void,
              invalidateRemoteStatus: () => Effect.void,
              invalidateStatus: () => Effect.void,
              localStatus: () =>
                Deferred.succeed(localRefreshStarted, undefined).pipe(
                  Effect.ignore,
                  Effect.andThen(
                    Effect.succeed({
                      isRepo: true,
                      hasPrimaryRemote: true,
                      isDefaultRef: false,
                      refName: "feature/demo",
                      hasWorkingTreeChanges: false,
                      workingTree: { files: [], insertions: 0, deletions: 0 },
                    }),
                  ),
                ),
              remoteStatus: () =>
                Effect.sleep(Duration.seconds(2)).pipe(
                  Effect.as({
                    hasUpstream: true,
                    aheadCount: 0,
                    behindCount: 0,
                    pr: null,
                  }),
                ),
              runStackedAction: () =>
                Effect.succeed({
                  action: "commit" as const,
                  branch: { status: "skipped_not_requested" as const },
                  commit: {
                    status: "created" as const,
                    commitSha: "abc123",
                    subject: "feat: demo",
                  },
                  push: { status: "skipped_not_requested" as const },
                  pr: { status: "skipped_not_requested" as const },
                  toast: {
                    title: "Committed abc123",
                    description: "feat: demo",
                    cta: {
                      kind: "run_action" as const,
                      label: "Push",
                      action: {
                        kind: "push" as const,
                      },
                    },
                  },
                }),
            },
          },
        });

        const wsUrl = yield* getWsServerUrl("/ws");
        yield* Effect.scoped(
          withWsRpcClient(wsUrl, (client) =>
            client[WS_METHODS.gitRunStackedAction]({
              actionId: "action-1",
              cwd: "/tmp/repo",
              action: "commit",
            }).pipe(Stream.runCollect),
          ),
        );

        yield* Deferred.await(localRefreshStarted);
      }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc orchestration methods", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const snapshot = {
        snapshotSequence: 1,
        updatedAt: now,
        projects: [
          {
            id: ProjectId.make("project-a"),
            title: "Project A",
            workspaceRoot: "/tmp/project-a",
            defaultModelSelection,
            scripts: [],
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        ],
        threads: [
          {
            id: ThreadId.make("thread-1"),
            projectId: ProjectId.make("project-a"),
            title: "Thread A",
            modelSelection: defaultModelSelection,
            interactionMode: "default" as const,
            runtimeMode: "full-access" as const,
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            latestTurn: null,
            messages: [],
            session: null,
            activities: [],
            proposedPlans: [],
            deletedAt: null,
          },
        ],
      };

      yield* buildAppUnderTest({
        layers: {
          projectionSnapshotQuery: {
            getSnapshot: () => Effect.succeed(snapshot),
            searchThreads: () =>
              Effect.succeed({
                matches: [
                  {
                    threadId: ThreadId.make("thread-1"),
                    projectId: ProjectId.make("project-a"),
                    source: "assistant",
                    snippet: "Search reached the final response.",
                    messageCreatedAt: now,
                  },
                ],
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");

      const searchResult = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.searchThreads]({
            query: "final response",
          }),
        ),
      );
      assert.deepEqual(searchResult.matches, [
        {
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-a"),
          source: "assistant",
          snippet: "Search reached the final response.",
          messageCreatedAt: now,
        },
      ]);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc orchestration shell snapshot errors", () =>
    Effect.gen(function* () {
      const projectionError = new PersistenceSqlError({
        operation: "ProjectionSnapshotQuery.getShellSnapshot:test",
        detail: "failed to read projection shell snapshot",
      });
      yield* buildAppUnderTest({
        layers: {
          projectionSnapshotQuery: {
            getShellSnapshot: () => Effect.fail(projectionError),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeShell]({}).pipe(Stream.runCollect),
        ).pipe(Effect.result),
      );

      assertTrue(result._tag === "Failure");
      assertTrue(result.failure._tag === "OrchestrationGetSnapshotError");
      assertTrue(result.failure.cause instanceof Error);
      assert.include(result.failure.cause.message, projectionError.message);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("marks an empty shell catch-up replay as synchronized when requested", () =>
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            readEvents: () => Stream.empty,
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const firstItem = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeShell]({
            afterSequence: 0,
            requestCompletionMarker: true,
          }).pipe(Stream.runHead),
        ),
      );

      assert.deepEqual(Option.getOrThrow(firstItem), { kind: "synchronized" });
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("buffers shell events published while the fallback snapshot loads", () =>
    Effect.gen(function* () {
      const liveEvents = yield* PubSub.unbounded<OrchestrationEvent>();
      const deletedEvent = {
        sequence: 2,
        eventId: EventId.make("event-shell-thread-deleted"),
        aggregateKind: "thread",
        aggregateId: defaultThreadId,
        occurredAt: "2026-01-01T00:00:01.000Z",
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "thread.deleted",
        payload: {
          threadId: defaultThreadId,
          deletedAt: "2026-01-01T00:00:01.000Z",
        },
      } satisfies Extract<OrchestrationEvent, { type: "thread.deleted" }>;

      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            streamDomainEvents: Stream.fromPubSub(liveEvents),
          },
          projectionSnapshotQuery: {
            getShellSnapshot: () =>
              Effect.gen(function* () {
                yield* PubSub.publish(liveEvents, deletedEvent);
                return {
                  snapshotSequence: 1,
                  projects: [],
                  threads: [makeDefaultOrchestrationThreadShell()],
                  updatedAt: "2026-01-01T00:00:00.000Z",
                };
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const items = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeShell]({
            requestCompletionMarker: true,
          }).pipe(Stream.take(3), Stream.runCollect),
        ),
      ).pipe(Effect.timeout("2 seconds"));

      assert.equal(items[0]?.kind, "snapshot");
      assert.equal(items[1]?.kind, "thread-removed");
      assert.deepEqual(items[2], { kind: "synchronized" });
    }).pipe(Effect.provide(layerLoopbackTest()), TestClock.withLive),
  );

  it.effect("delivers large raw tool results through the shell stream", () =>
    Effect.gen(function* () {
      const eventThreadId = ThreadId.make("other-live-thread");
      const baseEvent = makeLiveToolActivityEvent(2, "tool.completed");
      const event: OrchestrationEvent = {
        ...baseEvent,
        aggregateId: eventThreadId,
        payload: {
          threadId: eventThreadId,
          activity: {
            ...baseEvent.payload.activity,
            summary: "Build complete",
            payload: {
              itemType: "command_execution",
              toolCallId: "call-build",
              status: "completed",
              title: "Build complete",
              data: {
                item: {
                  command: "build",
                  aggregatedOutput: "Build complete\n" + "x".repeat(9 * 1024 * 1024),
                },
              },
            },
          },
        },
      };
      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            streamDomainEvents: Stream.concat(Stream.make(event), Stream.never),
          },
          projectionSnapshotQuery: {
            getThreadShellById: (threadId) =>
              Effect.succeedSome({
                ...makeDefaultOrchestrationThreadShell(),
                id: threadId,
                title: "Build complete",
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const items = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeShell]({
            requestCompletionMarker: true,
          }).pipe(
            Stream.takeUntil((item) => item.kind === "synchronized"),
            Stream.runCollect,
          ),
        ),
      );

      assert.equal(items[0]?.kind, "snapshot");
      const update = items[1];
      assertTrue(update?.kind === "thread-upserted");
      assert.equal(update.sequence, 2);
      assert.equal(update.thread.id, eventThreadId);
      assert.equal(update.thread.title, "Build complete");
      assert.deepEqual(items[2], { kind: "synchronized" });
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("stops an overflowing shell producer without an ACK and recovers deleted entries", () =>
    Effect.gen(function* () {
      const liveEvents = yield* PubSub.unbounded<OrchestrationEvent>();
      const detached = yield* Deferred.make<void>();
      const ackHeld = yield* Deferred.make<void>();
      const releaseAck = yield* Deferred.make<void>();
      let headSequence = 1;
      let snapshotCalls = 0;
      let replayCalls = 0;
      const thread = makeDefaultOrchestrationThreadShell();
      const project = makeDefaultOrchestrationReadModel().projects[0]!;
      const events: OrchestrationEvent[] = Array.from({ length: 1_001 }, (_, index) =>
        makeLiveToolActivityEvent(index + 2, "tool.completed"),
      );
      events.push(
        {
          ...events[0]!,
          sequence: 1_003,
          type: "thread.archived",
          payload: {
            threadId: defaultThreadId,
            archivedAt: "2026-01-01T00:00:02.000Z",
            updatedAt: "2026-01-01T00:00:02.000Z",
          },
        },
        {
          ...events[0]!,
          sequence: 1_004,
          aggregateKind: "project",
          aggregateId: defaultProjectId,
          type: "project.deleted",
          payload: { projectId: defaultProjectId, deletedAt: "2026-01-01T00:00:02.000Z" },
        },
      );
      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            latestSequence: Effect.sync(() => headSequence),
            streamDomainEvents: Stream.fromPubSub(liveEvents).pipe(
              Stream.ensuring(Deferred.succeed(detached, undefined)),
            ),
            readEvents: () => {
              replayCalls += 1;
              return Stream.empty;
            },
          },
          projectionSnapshotQuery: {
            getShellSnapshot: () =>
              Effect.sync(() => {
                snapshotCalls += 1;
                return {
                  snapshotSequence: headSequence,
                  projects: headSequence === 1 ? [project] : [],
                  threads: headSequence === 1 ? [thread] : [],
                  updatedAt: "2026-01-01T00:00:02.000Z",
                };
              }),
          },
        },
      });
      const wsUrl = yield* getWsServerUrl("/ws");
      yield* makeWsRpcClient.pipe(
        Effect.flatMap((client) =>
          Effect.gen(function* () {
            const received: OrchestrationShellStreamItem[] = [];
            const attempt = yield* client[ORCHESTRATION_WS_METHODS.subscribeShell]({}).pipe(
              Stream.tap((item) => Effect.sync(() => received.push(item))),
              Stream.runDrain,
              Effect.result,
              Effect.forkScoped,
            );
            yield* Deferred.await(ackHeld);
            headSequence = 1_004;
            yield* PubSub.publishAll(liveEvents, events);
            yield* Deferred.await(detached);
            assert.equal(yield* PubSub.size(liveEvents), 0);
            yield* Deferred.succeed(releaseAck, undefined);
            const result = yield* Fiber.join(attempt);
            assertTrue(result._tag === "Failure");
            assert.equal(result.failure._tag, "OrchestrationGetSnapshotError");
            assert.equal(received.length, 1);
            const initial = received[0];
            assertTrue(initial?.kind === "snapshot");
            assert.equal(initial.snapshot.threads.length, 1);

            const recovered = yield* client[ORCHESTRATION_WS_METHODS.subscribeShell]({
              afterSequence: initial.snapshot.snapshotSequence,
              requestCompletionMarker: true,
            }).pipe(
              Stream.takeUntil((item) => item.kind === "synchronized"),
              Stream.runCollect,
            );
            const snapshot = recovered[0];
            assertTrue(snapshot?.kind === "snapshot");
            assert.equal(snapshot.snapshot.snapshotSequence, 1_004);
            assert.deepEqual(snapshot.snapshot.projects, []);
            assert.deepEqual(snapshot.snapshot.threads, []);
            assert.deepEqual(recovered[1], { kind: "synchronized" });
            assert.equal(snapshotCalls, 2);
            assert.equal(replayCalls, 0);
          }),
        ),
        Effect.provide(withFirstWsAckHeld(wsUrl, ackHeld, releaseAck)),
      );
    }).pipe(Effect.scoped, Effect.provide(layerLoopbackTest())),
  );

  it.effect("subscribeShell sends a fresh snapshot instead of replaying a large gap", () =>
    Effect.gen(function* () {
      let readEventsCalls = 0;
      const snapshotThreadId = ThreadId.make("thread-from-snapshot");
      const now = "2026-01-01T00:00:00.000Z";

      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            // Head is far ahead of the client's afterSequence (gap > 1000).
            latestSequence: Effect.succeed(100_000),
            readEvents: () =>
              Stream.sync(() => {
                readEventsCalls += 1;
                return {
                  sequence: 1,
                  eventId: EventId.make("event-should-not-be-read"),
                  aggregateKind: "thread",
                  aggregateId: snapshotThreadId,
                  occurredAt: now,
                  commandId: null,
                  causationEventId: null,
                  correlationId: null,
                  metadata: {},
                  type: "thread.created",
                  payload: {} as never,
                } satisfies OrchestrationEvent;
              }),
          },
          projectionSnapshotQuery: {
            getShellSnapshot: () =>
              Effect.succeed({
                snapshotSequence: 100_000,
                projects: [],
                threads: [makeDefaultOrchestrationThreadShell({ id: snapshotThreadId })],
                updatedAt: now,
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const items = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeShell]({
            afterSequence: 5,
            requestCompletionMarker: true,
          }).pipe(Stream.take(2), Stream.runCollect),
        ),
      );

      const [first, second] = Array.from(items);
      // Large gap => fresh snapshot, and the unbounded replay is never started.
      assert.equal(first?.kind, "snapshot");
      if (first?.kind === "snapshot") {
        assert.equal(first.snapshot.threads[0]?.id, snapshotThreadId);
      }
      assert.equal(second?.kind, "synchronized");
      assert.equal(readEventsCalls, 0);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("subscriptions snapshot instead of decoding an oversized replay range", () =>
    Effect.gen(function* () {
      let readEventsCalls = 0;
      let replayStatsCalls = 0;
      const shell = makeDefaultOrchestrationThreadShell();

      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            latestSequence: Effect.succeed(5),
            readEvents: () =>
              Stream.sync(() => {
                readEventsCalls += 1;
                return {} as OrchestrationEvent;
              }),
          },
          projectionSnapshotQuery: {
            getEventReplayStats: () =>
              Effect.sync(() => {
                replayStatsCalls += 1;
                return { eventCount: 5, payloadBytes: 8 * 1024 * 1024 + 1 };
              }),
            getShellSnapshot: () =>
              Effect.succeed({
                snapshotSequence: 5,
                projects: [],
                threads: [shell],
                updatedAt: "2026-01-01T00:00:00.000Z",
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const shellItems = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeShell]({
            afterSequence: 0,
            requestCompletionMarker: true,
          }).pipe(Stream.take(2), Stream.runCollect),
        ),
      );

      assert.equal(shellItems[0]?.kind, "snapshot");
      assert.equal(shellItems[1]?.kind, "synchronized");
      assert.equal(replayStatsCalls, 1);
      assert.equal(readEventsCalls, 0);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("subscribeShell replaces a cursor ahead of the authoritative head", () =>
    Effect.gen(function* () {
      let readEventsCalls = 0;

      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            latestSequence: Effect.succeed(5),
            readEvents: () =>
              Stream.sync(() => {
                readEventsCalls += 1;
                return {} as OrchestrationEvent;
              }),
          },
          projectionSnapshotQuery: {
            getShellSnapshot: () =>
              Effect.succeed({
                snapshotSequence: 5,
                projects: [],
                threads: [],
                updatedAt: "2026-01-01T00:00:00.000Z",
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const first = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeShell]({ afterSequence: 10 }).pipe(
            Stream.runHead,
          ),
        ),
      );

      assert.equal(Option.getOrThrow(first).kind, "snapshot");
      assert.equal(readEventsCalls, 0);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("subscribeShell coalesces a per-thread burst without stalling other threads", () =>
    Effect.gen(function* () {
      const busyThreadId = ThreadId.make("thread-busy");
      const newThreadId = ThreadId.make("thread-new");
      const now = "2026-01-01T00:00:00.000Z";
      const shellFetches: Array<string> = [];
      let replayLimit: number | undefined;

      const messageEvent = (sequence: number): OrchestrationEvent =>
        ({
          sequence,
          eventId: EventId.make(`event-${sequence}`),
          aggregateKind: "thread",
          aggregateId: busyThreadId,
          occurredAt: now,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "thread.message-sent",
          payload: {} as never,
        }) satisfies OrchestrationEvent;

      const createdEvent: OrchestrationEvent = {
        sequence: 50,
        eventId: EventId.make("event-created"),
        aggregateKind: "thread",
        aggregateId: newThreadId,
        occurredAt: now,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "thread.created",
        payload: {} as never,
      };

      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            latestSequence: Effect.succeed(50),
            // A burst of message-sent deltas for the busy thread, plus one
            // thread.created for a different thread, all within one batch.
            readEvents: (_afterSequence, limit) => {
              replayLimit = limit;
              return Stream.fromIterable([
                ...Array.from({ length: 20 }, (_unused, index) => messageEvent(index + 1)),
                createdEvent,
              ]);
            },
          },
          projectionSnapshotQuery: {
            getThreadShellById: (threadId) =>
              Effect.sync(() => {
                shellFetches.push(threadId);
                return Option.some(makeDefaultOrchestrationThreadShell({ id: threadId }));
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const items = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeShell]({
            afterSequence: 0,
            requestCompletionMarker: true,
          }).pipe(Stream.take(3), Stream.runCollect),
        ),
      );

      const collected = Array.from(items);
      const upsertedIds = collected.flatMap((item) =>
        item.kind === "thread-upserted" ? [item.thread.id] : [],
      );
      // Both threads surface, and the busy thread's 20-event burst collapses to
      // a single shell refetch (not 20). The new thread is not stuck behind it.
      assert.include(upsertedIds, busyThreadId);
      assert.include(upsertedIds, newThreadId);
      assert.equal(collected[2]?.kind, "synchronized");
      assert.equal(shellFetches.filter((id) => id === busyThreadId).length, 1);
      assert.equal(replayLimit, 50);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("subscribeShell coalesces live bursts after the synchronization marker", () =>
    Effect.gen(function* () {
      const busyThreadId = ThreadId.make("thread-live-busy");
      const newThreadId = ThreadId.make("thread-live-new");
      const now = "2026-01-01T00:00:00.000Z";
      const liveEvents = yield* PubSub.unbounded<OrchestrationEvent>();
      const synchronized = yield* Deferred.make<void>();
      const shellFetches: Array<string> = [];
      const observedLiveThreadIds = new Set<string>();

      const messageEvent = (sequence: number): OrchestrationEvent =>
        ({
          sequence,
          eventId: EventId.make(`event-live-${sequence}`),
          aggregateKind: "thread",
          aggregateId: busyThreadId,
          occurredAt: now,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "thread.message-sent",
          payload: {} as never,
        }) satisfies OrchestrationEvent;

      const createdEvent: OrchestrationEvent = {
        sequence: 50,
        eventId: EventId.make("event-live-created"),
        aggregateKind: "thread",
        aggregateId: newThreadId,
        occurredAt: now,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "thread.created",
        payload: {} as never,
      };

      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            streamDomainEvents: Stream.fromPubSub(liveEvents),
          },
          projectionSnapshotQuery: {
            getThreadShellById: (threadId) =>
              Effect.sync(() => {
                shellFetches.push(threadId);
                return Option.some(makeDefaultOrchestrationThreadShell({ id: threadId }));
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const items = yield* Effect.scoped(
        Effect.gen(function* () {
          const itemsFiber = yield* withWsRpcClient(wsUrl, (client) =>
            client[ORCHESTRATION_WS_METHODS.subscribeShell]({
              requestCompletionMarker: true,
            }).pipe(
              Stream.tap((item) =>
                item.kind === "synchronized"
                  ? Deferred.succeed(synchronized, undefined).pipe(Effect.ignore)
                  : Effect.void,
              ),
              Stream.takeUntil((item) => {
                if (item.kind === "thread-upserted") {
                  observedLiveThreadIds.add(item.thread.id);
                }
                return (
                  observedLiveThreadIds.has(busyThreadId) && observedLiveThreadIds.has(newThreadId)
                );
              }),
              Stream.runCollect,
            ),
          ).pipe(Effect.forkScoped);

          yield* Deferred.await(synchronized);
          for (const event of [
            ...Array.from({ length: 20 }, (_unused, index) => messageEvent(index + 1)),
            createdEvent,
          ]) {
            yield* PubSub.publish(liveEvents, event);
          }

          return yield* Fiber.join(itemsFiber);
        }),
      ).pipe(Effect.timeout("2 seconds"));

      assert.equal(items[0]?.kind, "snapshot");
      assert.equal(items[1]?.kind, "synchronized");
      const liveUpsertedIds = Array.from(items)
        .slice(2)
        .flatMap((item) => (item.kind === "thread-upserted" ? [item.thread.id] : []));
      assert.include(liveUpsertedIds, busyThreadId);
      assert.include(liveUpsertedIds, newThreadId);
      assert.isBelow(shellFetches.filter((id) => id === busyThreadId).length, 20);
    }).pipe(Effect.provide(layerLoopbackTest()), TestClock.withLive),
  );

  it.effect("subscribeShell coalescing still emits a removal for a deleted thread", () =>
    Effect.gen(function* () {
      const goneThreadId = ThreadId.make("thread-gone");
      const now = "2026-01-01T00:00:00.000Z";

      const makeThreadEvent = (
        sequence: number,
        type: "thread.deleted" | "thread.message-sent",
      ): OrchestrationEvent =>
        ({
          sequence,
          eventId: EventId.make(`event-${sequence}`),
          aggregateKind: "thread",
          aggregateId: goneThreadId,
          occurredAt: now,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type,
          payload: type === "thread.deleted" ? { threadId: goneThreadId, deletedAt: now } : {},
        }) as OrchestrationEvent;

      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            latestSequence: Effect.succeed(2),
            // A thread.deleted followed, within the same coalescing window, by a
            // later refetchable event for the same thread. The later event wins
            // coalescing; its shell refetch returns none (the row is gone), which
            // must still surface a removal rather than be swallowed.
            readEvents: () =>
              Stream.fromIterable([
                makeThreadEvent(1, "thread.deleted"),
                makeThreadEvent(2, "thread.message-sent"),
              ]),
          },
          projectionSnapshotQuery: {
            getThreadShellById: () => Effect.succeedNone,
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const items = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeShell]({ afterSequence: 0 }).pipe(
            Stream.take(1),
            Stream.runCollect,
          ),
        ),
      );

      const [first] = Array.from(items);
      assert.equal(first?.kind, "thread-removed");
      assert.equal(first?.kind === "thread-removed" ? first.threadId : null, goneThreadId);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("subscribeShell retries a transient shell projection refetch failure", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-transient-refetch");
      const now = "2026-01-01T00:00:00.000Z";
      let attempts = 0;

      const event: OrchestrationEvent = {
        sequence: 1,
        eventId: EventId.make("event-transient-refetch"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "thread.message-sent",
        payload: {} as never,
      };

      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            latestSequence: Effect.succeed(1),
            readEvents: () => Stream.make(event),
          },
          projectionSnapshotQuery: {
            getThreadShellById: () =>
              Effect.suspend(() => {
                attempts += 1;
                return attempts === 1
                  ? Effect.fail(
                      new PersistenceSqlError({
                        operation: "test.shell-refetch",
                        detail: "transient failure",
                      }),
                    )
                  : Effect.succeedSome(makeDefaultOrchestrationThreadShell({ id: threadId }));
              }),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const items = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeShell]({ afterSequence: 0 }).pipe(
            Stream.take(1),
            Stream.runCollect,
          ),
        ),
      );

      const [first] = Array.from(items);
      assert.equal(first?.kind, "thread-upserted");
      assert.equal(first?.kind === "thread-upserted" ? first.thread.id : null, threadId);
      assert.equal(attempts, 2);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("subscribeShell coalescing still removes a project after a trailing update", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project-gone");
      const now = "2026-01-01T00:00:00.000Z";

      const makeProjectEvent = (
        sequence: number,
        type: "project.deleted" | "project.meta-updated",
      ): OrchestrationEvent =>
        ({
          sequence,
          eventId: EventId.make(`event-project-${sequence}`),
          aggregateKind: "project",
          aggregateId: projectId,
          occurredAt: now,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type,
          payload:
            type === "project.deleted"
              ? { projectId, deletedAt: now }
              : { projectId, title: "Still deleted", updatedAt: now },
        }) as OrchestrationEvent;

      yield* buildAppUnderTest({
        layers: {
          orchestrationEngine: {
            latestSequence: Effect.succeed(2),
            readEvents: () =>
              Stream.fromIterable([
                makeProjectEvent(1, "project.deleted"),
                makeProjectEvent(2, "project.meta-updated"),
              ]),
          },
          projectionSnapshotQuery: {
            getProjectShellById: () => Effect.succeedNone,
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const items = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[ORCHESTRATION_WS_METHODS.subscribeShell]({ afterSequence: 0 }).pipe(
            Stream.take(1),
            Stream.runCollect,
          ),
        ),
      );

      const [first] = Array.from(items);
      assert.equal(first?.kind, "project-removed");
      assert.equal(first?.kind === "project-removed" ? first.projectId : null, projectId);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc terminal methods", () =>
    Effect.gen(function* () {
      const snapshot = {
        threadId: "thread-1",
        terminalId: "default",
        cwd: "/tmp/project",
        worktreePath: null,
        status: "running" as const,
        pid: 1234,
        history: "",
        exitCode: null,
        exitSignal: null,
        label: "Primary",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };

      yield* buildAppUnderTest({
        layers: {
          terminalManager: {
            open: () => Effect.succeed(snapshot),
            write: () => Effect.void,
            resize: () => Effect.void,
            clear: () => Effect.void,
            restart: () => Effect.succeed(snapshot),
            close: () => Effect.void,
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");

      const opened = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalOpen]({
            threadId: "thread-1",
            terminalId: "default",
            cwd: "/tmp/project",
          }),
        ),
      );
      assert.equal(opened.terminalId, "default");

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalWrite]({
            threadId: "thread-1",
            terminalId: "default",
            data: "echo hi\n",
          }),
        ),
      );

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalResize]({
            threadId: "thread-1",
            terminalId: "default",
            cols: 120,
            rows: 40,
          }),
        ),
      );

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalClear]({
            threadId: "thread-1",
            terminalId: "default",
          }),
        ),
      );

      const restarted = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalRestart]({
            threadId: "thread-1",
            terminalId: "default",
            cwd: "/tmp/project",
            cols: 120,
            rows: 40,
          }),
        ),
      );
      assert.equal(restarted.terminalId, "default");

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalClose]({
            threadId: "thread-1",
            terminalId: "default",
          }),
        ),
      );
    }).pipe(Effect.provide(layerLoopbackTest())),
  );

  it.effect("routes websocket rpc terminal.write errors", () =>
    Effect.gen(function* () {
      const terminalError = new TerminalNotRunningError({
        threadId: "thread-1",
        terminalId: "default",
      });
      yield* buildAppUnderTest({
        layers: {
          terminalManager: {
            write: () => Effect.fail(terminalError),
          },
        },
      });

      const wsUrl = yield* getWsServerUrl("/ws");
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, (client) =>
          client[WS_METHODS.terminalWrite]({
            threadId: "thread-1",
            terminalId: "default",
            data: "echo fail\n",
          }),
        ).pipe(Effect.result),
      );

      assertFailure(result, terminalError);
    }).pipe(Effect.provide(layerLoopbackTest())),
  );
});

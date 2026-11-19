import * as Deferred from "effect/Deferred";
import * as Socket from "effect/socket/Socket";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { ZeropsConnections } from "./zerops/ZeropsConnections.ts";
import { ZeropsToldToStop } from "./zerops/ZeropsToldToStop.ts";
import { withStreamWindows } from "./RpcStreamWindow.ts";
import { RpcUpdateAdmission } from "./RpcUpdateAdmission.ts";
import { ZeropsSetup } from "./zerops/ZeropsSetup.ts";
import { actingIn, hqKeyOf, ZeropsHqLink } from "./zerops/ZeropsHqLink.ts";
import { ZeropsMateOwner } from "./zerops/ZeropsMateOwner.ts";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { ThreadFileWrites } from "./zerops/ThreadFileWrites.ts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import {
  AuthSessionId,
  AuthZeropsClientScopes,
  ClientSurface,
  EnvironmentAuthorizationError,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationClientOrigin,
  OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  RpcClientId,
  type ServerProvider,
  SessionSubject,
  WS_METHODS,
  WsRpcGroup,
  zeropsSubjectOf,
} from "@t3tools/contracts";
import { HttpRouter, HttpServerRequest, HttpServerRespondable } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import * as ServerConfig from "./config.ts";
import * as Keybindings from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import { registerOrchestrationRpc } from "./orchestration/registerOrchestrationRpc.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { rpcInstrumentationLayer } from "./observability/RpcInstrumentation.ts";
import * as ProviderRegistry from "./provider/Services/ProviderRegistry.ts";
import * as ModelManifest from "./provider/ModelManifest.ts";
import * as ProviderMaintenance from "./provider/providerMaintenance.ts";
import * as ProviderService from "./provider/Services/ProviderService.ts";
import * as ProviderMaintenanceRunner from "./provider/providerMaintenanceRunner.ts";
import * as DefectReporter from "./observability/DefectReporter.ts";
import { ProviderAuthService } from "./provider/Services/ProviderAuthService.ts";
import { ProviderInstanceRegistry } from "./provider/Services/ProviderInstanceRegistry.ts";
import { authAccessStream } from "./auth/accessStream.ts";
import { registerServerRpc } from "./registerServerRpc.ts";
import { makeServerConfigFeed } from "./serverConfigFeed.ts";
import { registerProviderRpc } from "./registerProviderRpc.ts";
import { makeProviderInstallation } from "./provider/providerInstallation.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerSettings from "./serverSettings.ts";
import { registerTerminalRpc } from "./terminal/registerTerminalRpc.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import { terminalOutputWindows } from "./terminal/OutputProtocol.ts";
import { registerWorkspaceRpc } from "./workspace/registerWorkspaceRpc.ts";
import * as WorkspaceEntries from "./workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./workspace/WorkspaceFileSystem.ts";
import { registerVcsRpc } from "./vcs/registerVcsRpc.ts";
import * as VcsStatusBroadcaster from "./vcs/VcsStatusBroadcaster.ts";
import * as VcsProvisioningService from "./vcs/VcsProvisioningService.ts";
import * as GitWorkflowService from "./git/GitWorkflowService.ts";
import * as ReviewService from "./review/ReviewService.ts";
import * as ProjectCloneTracker from "./project/ProjectCloneTracker.ts";
import * as RepositoryIdentityResolver from "./project/RepositoryIdentityResolver.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as RemoteOpenTargets from "./environment/RemoteOpenTargets.ts";
import * as BackgroundPolicy from "./background/BackgroundPolicy.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { requiredScopeForRpcMethod, rpcScopeAuthorizationLayer } from "./auth/RpcAuthorization.ts";
import * as ProcessDiagnostics from "./diagnostics/ProcessDiagnostics.ts";
import * as ProcessResourceMonitor from "./diagnostics/ProcessResourceMonitor.ts";
import * as ResourceTelemetry from "./resourceTelemetry/ResourceTelemetry.ts";
import * as ZeropsAgentAuth from "./zerops/ZeropsAgentAuth.ts";
import { engineArchiveSnapshotOf } from "./zerops/engineOverview.ts";
import { overlayZeropsAgentAuth } from "./zerops/zeropsAgentProviderOverlay.ts";
import { withoutUnworkableSlashCommands } from "./zerops/providerSlashCommands.ts";
import * as ZeropsAgentLoginModule from "./zerops/ZeropsAgentLogin.ts";
import * as ZeropsLoginsModule from "./zerops/ZeropsLogins.ts";
import { registerMcpRpc } from "./zerops/mcp/registerMcpRpc.ts";
import { McpServers } from "./zerops/mcp/McpServers.ts";
import * as ZeropsSignOutModule from "./zerops/ZeropsSignOut.ts";
import * as ZeropsBrowserStreamModule from "./zerops/ZeropsBrowserStream.ts";
import * as ZeropsMacStreamModule from "./zerops/ZeropsMacStream.ts";
import { ZeropsCli } from "./zerops/ZeropsCli.ts";
import { isZeropsEnvironment } from "./zerops/ZeropsEnvironment.ts";
import * as ZeropsDataConsoleModule from "./zerops/ZeropsDataConsole.ts";
import * as ZeropsGitRemoteProbeModule from "./zerops/ZeropsGitRemoteProbe.ts";
import * as ZeropsLifecycle from "./zerops/ZeropsLifecycle.ts";
import { ZeropsMateUpdate } from "./zerops/ZeropsMateUpdate.ts";
import { CrewEngine } from "./zerops/crew/CrewEngine.ts";
import * as ZeropsCrewProposals from "./zerops/ZeropsCrewProposals.ts";
import { registerCrewRpc } from "./zerops/crew/registerCrewRpc.ts";
import { ENGINE_MOVED, MateEngine } from "./engine/MateEngine.ts";
import { engineStreamWindows, registerEngineRpc } from "./engine/registerEngineRpc.ts";
import { registerZeropsRpc } from "./zerops/registerZeropsRpc.ts";
import { ZeropsMateAttention } from "./zerops/ZeropsMateAttention.ts";
import * as UsageLimitSources from "./usage/UsageLimitSources.ts";
import * as SourceControlDiscovery from "./sourceControl/SourceControlDiscovery.ts";
import * as SourceControlRepositoryService from "./sourceControl/SourceControlRepositoryService.ts";
import * as AzureDevOpsCli from "./sourceControl/AzureDevOpsCli.ts";
import * as BitbucketApi from "./sourceControl/BitbucketApi.ts";
import * as GitHubCli from "./sourceControl/GitHubCli.ts";
import * as GitLabCli from "./sourceControl/GitLabCli.ts";
import * as ForgejoCli from "./sourceControl/ForgejoCli.ts";
import * as SourceControlProviderRegistry from "./sourceControl/SourceControlProviderRegistry.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "./vcs/VcsDriverRegistry.ts";
import * as VcsProjectConfig from "./vcs/VcsProjectConfig.ts";
import * as VcsProcess from "./vcs/VcsProcess.ts";
import * as PairingGrantStore from "./auth/PairingGrantStore.ts";
import * as SessionStore from "./auth/SessionStore.ts";
import { awaitSessionEnd } from "./auth/sessionLifetime.ts";
import { failEnvironmentCredentialRejected, failEnvironmentInternal } from "./auth/http.ts";
import * as ProcessRunner from "./processRunner.ts";
import * as RelayClient from "@t3tools/shared/relayClient";

const isClientSurface = Schema.is(ClientSurface);
const MAX_CLIENT_APP_VERSION_LENGTH = 64;

// Optional client identity announced on the /ws upgrade URL next to wsTicket.
// Lenient by design: absent or malformed values degrade to {} so a connection
// never fails over attribution metadata.
function readClientConnectionOrigin(
  request: HttpServerRequest.HttpServerRequest,
): OrchestrationClientOrigin {
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) {
    return {};
  }
  const surface = url.value.searchParams.get("clientSurface");
  const appVersion = url.value.searchParams.get("clientAppVersion")?.trim() ?? "";
  return {
    ...(isClientSurface(surface) ? { surface } : {}),
    ...(appVersion !== "" && appVersion.length <= MAX_CLIENT_APP_VERSION_LENGTH
      ? { appVersion }
      : {}),
  };
}

const makeWsRpcLayer = (
  currentSession: EnvironmentAuth.AuthenticatedSession,
  /** The connection's own scope: it closes when the socket ends. */
  connectionScope: Scope.Scope,
  /** The registry that admitted this socket on HQ's ticket; none where no ticket did. */
  zeropsConnections: ZeropsConnections["Service"] | undefined,
) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const currentSessionId = currentSession.sessionId;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
      const keybindings = yield* Keybindings.Keybindings;
      const usageLimitSources = yield* UsageLimitSources.UsageLimitSources;
      const externalLauncher = yield* ExternalLauncher.ExternalLauncher;
      const remoteOpenTargets = yield* RemoteOpenTargets.RemoteOpenTargets;
      const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
      const review = yield* ReviewService.ReviewService;
      const vcsProvisioning = yield* VcsProvisioningService.VcsProvisioningService;
      const vcsStatusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
      const terminalManager = yield* TerminalManager.TerminalManager;
      const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
      const modelManifest = yield* ModelManifest.ModelManifest;
      const providerVersionCache = yield* ProviderMaintenance.ProviderVersionCache;
      const providerService = yield* ProviderService.ProviderService;
      const providerMaintenanceRunner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
      const providerAuth = yield* ProviderAuthService;
      const providerInstances = yield* ProviderInstanceRegistry;
      const providerInstallation = yield* makeProviderInstallation();
      const config = yield* ServerConfig.ServerConfig;
      const engineMoved = () => new OrchestrationDispatchCommandError({ message: ENGINE_MOVED });
      const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
      const serverSettings = yield* ServerSettings.ServerSettingsService;
      const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
      const projectCloneTracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      const repositoryIdentityResolver =
        yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
      const { serverVersion, bootId } = yield* serverEnvironment.getDescriptor;
      const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
      const rpcClientIds = yield* Ref.make(new Set<RpcClientId>());
      yield* Effect.addFinalizer(() =>
        Ref.get(rpcClientIds).pipe(
          Effect.flatMap((clientIds) =>
            Effect.forEach(
              clientIds,
              (clientId) => backgroundPolicy.removeRpcClient(currentSessionId, clientId),
              {
                discard: true,
              },
            ),
          ),
          Effect.ignore,
        ),
      );
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sourceControlDiscovery = yield* SourceControlDiscovery.SourceControlDiscovery;
      const sourceControlRepositories =
        yield* SourceControlRepositoryService.SourceControlRepositoryService;
      const bootstrapCredentials = yield* Effect.serviceOption(PairingGrantStore.PairingGrantStore);
      const sessions = yield* Effect.serviceOption(SessionStore.SessionStore);
      const processDiagnostics = yield* ProcessDiagnostics.ProcessDiagnostics;
      const processResourceMonitor = yield* ProcessResourceMonitor.ProcessResourceMonitor;
      const resourceTelemetry = yield* ResourceTelemetry.ResourceTelemetry;
      const zeropsLifecycle = yield* ZeropsLifecycle.ZeropsLifecycle;
      const zeropsAgentAuth = yield* ZeropsAgentAuth.ZeropsAgentAuth;
      const zeropsSetup = Option.getOrUndefined(yield* Effect.serviceOption(ZeropsSetup));
      // A Mate's own server starts its stand-up; absent where no Zerops layer runs.
      const zeropsAgentLogin = yield* ZeropsAgentLoginModule.ZeropsAgentLogin;
      const zeropsLogins = yield* ZeropsLoginsModule.ZeropsLogins;
      // The MCP tab's servers; absent where no Zerops layer runs.
      const mcpServers = yield* Effect.serviceOption(McpServers);
      const zeropsSignOut = yield* ZeropsSignOutModule.ZeropsSignOut;
      const zeropsBrowserStream = yield* ZeropsBrowserStreamModule.ZeropsBrowserStream;
      const zeropsMacStream = yield* ZeropsMacStreamModule.ZeropsMacStream;
      const zeropsMateAttention = yield* ZeropsMateAttention;
      const mateEngine = yield* MateEngine;
      const updateAdmission = Option.getOrUndefined(
        yield* Effect.serviceOption(RpcUpdateAdmission),
      );
      const zeropsCli = yield* ZeropsCli;
      const zeropsMateUpdate = yield* ZeropsMateUpdate;
      // HQ's word on the Mate's key, as every connected person is told it; none outside Zerops.
      const hqKeyLink = Option.getOrUndefined(yield* Effect.serviceOption(ZeropsHqLink));
      const currentHqKey =
        hqKeyLink === undefined ? Effect.succeed(null) : Effect.map(hqKeyLink.standing, hqKeyOf);
      const zeropsDataConsole = yield* ZeropsDataConsoleModule.ZeropsDataConsole;
      const zeropsGitRemoteProbe = yield* ZeropsGitRemoteProbeModule.ZeropsGitRemoteProbe;
      // What a thread's agent wrote, read back; absent where no store backs it.
      const threadFileWrites = Option.getOrUndefined(yield* Effect.serviceOption(ThreadFileWrites));
      const crew = yield* CrewEngine;
      const zeropsCrewProposals = yield* ZeropsCrewProposals.ZeropsCrewProposals;
      const relayClient = yield* RelayClient.RelayClient;
      // While a Mate update waits, a call that changes something is refused, unless it continues
      // work already accepted; the update starts once nothing admitted is running.
      const admit = <A, E, R>(
        method: string,
        effect: Effect.Effect<A, E, R>,
        updateContinuation = false,
      ): Effect.Effect<A, E | EnvironmentAuthorizationError, R> =>
        updateAdmission === undefined || requiredScopeForRpcMethod(method).endsWith(":read")
          ? effect
          : updateAdmission.run(
              effect,
              new EnvironmentAuthorizationError({
                message:
                  "Update ready; waiting for your work to finish. Try again after the update.",
                requiredScope: requiredScopeForRpcMethod(method),
              }),
              updateContinuation ||
                [
                  WS_METHODS.providerInstallCancel,
                  WS_METHODS.projectCloneCancel,
                  WS_METHODS.providerAuthSubscribe,
                  ORCHESTRATION_WS_METHODS.dispatchCommand,
                  WS_METHODS.engineAnswer,
                  WS_METHODS.engineDismiss,
                  WS_METHODS.engineStop,
                  WS_METHODS.terminalWrite,
                  WS_METHODS.terminalClose,
                  WS_METHODS.providerAuthComplete,
                  WS_METHODS.providerAuthRespond,
                  WS_METHODS.providerAuthCancel,
                  WS_METHODS.zeropsAgentLoginCancel,
                  WS_METHODS.zeropsAgentLoginSubmitCode,
                ].some((candidate) => candidate === method),
            );

      // On Zerops, whether Claude Code and Codex can be picked is the
      // project's answer (its sign-in flag), not their drivers' — every
      // provider list a client receives goes through this, and leaves it
      // without the slash commands a Mate cannot use.
      const withZeropsAgentAuth = (providers: ReadonlyArray<ServerProvider>) =>
        zeropsAgentAuth.latest.pipe(
          Effect.map((snapshot) =>
            withoutUnworkableSlashCommands(overlayZeropsAgentAuth(providers, snapshot)),
          ),
        );

      const configFeed = makeServerConfigFeed({
        keybindings,
        providerRegistry,
        usageLimitSources,
        serverSettings,
        serverEnvironment,
        serverAuth,
        externalLauncher,
        remoteOpenTargets,
        config,
        zeropsAgentAuth,
        zeropsMateUpdate,
        hqKeyLink,
        currentHqKey,
        withZeropsAgentAuth,
      });
      const accessStream = authAccessStream({
        serverAuth,
        bootstrapCredentials,
        sessions,
        currentSessionId,
      });

      return WsRpcGroup.of({
        ...registerOrchestrationRpc({
          projectionSnapshotQuery,
          orchestrationEngine,
          admit,
          engineMoved,
        }),
        [WS_METHODS.engineGetArchivedShellSnapshot]: (input) =>
          mateEngine.wire.readArchived(input.protocol).pipe(
            Effect.map((archived) => engineArchiveSnapshotOf(archived, config.cwd)),
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load the engine archive",
                  cause,
                }),
            ),
          ),
        ...registerServerRpc({
          configFeed,
          accessStream,
          keybindings,
          serverSettings,
          sourceControlDiscovery,
          config,
          processDiagnostics,
          processResourceMonitor,
          resourceTelemetry,
          backgroundPolicy,
          rpcClientIds,
          currentSessionId,
          relayClient,
          externalLauncher,
          lifecycleEvents,
          admit,
        }),
        ...registerProviderRpc({
          modelManifest,
          providerInstances,
          providerVersionCache,
          usageLimitSources,
          externalLauncher,
          providerRegistry,
          withZeropsAgentAuth,
          providerService,
          providerMaintenanceRunner,
          providerAuth,
          providerInstallation,
          currentSessionId,
          admit,
        }),
        ...registerMcpRpc({ mcpServers, admit }),
        ...registerZeropsRpc({
          zeropsSetup,
          zeropsLifecycle,
          zeropsAgentAuth,
          zeropsAgentLogin,
          zeropsSignOut,
          zeropsLogins,
          zeropsBrowserStream,
          zeropsMacStream,
          zeropsMateAttention,
          zeropsCli,
          zeropsMateUpdate,
          isZeropsEnvironment: isZeropsEnvironment(config),
          serverVersion,
          bootId,
          zeropsDataConsole,
          zeropsGitRemoteProbe,
          zeropsCrewProposals,
          subject: SessionSubject.make(currentSession.subject),
          connection: { id: currentSessionId, scope: connectionScope },
          zeropsConnections,
          admit,
        }),
        ...registerCrewRpc({
          crew,
          subject: SessionSubject.make(currentSession.subject),
          admit,
        }),
        ...registerEngineRpc({
          engine: mateEngine,
          source: Effect.map(zeropsMateAttention.current, (attention) => attention.source),
          subject: currentSession.subject,
          admit,
        }),
        ...registerVcsRpc({
          sourceControlRepositories,
          projectCloneTracker,
          repositoryIdentityResolver,
          vcsStatusBroadcaster,
          gitWorkflow,
          vcsProvisioning,
          review,
          serverSettings,
          admit,
          engineMoved,
        }),
        ...registerWorkspaceRpc({
          workspaceEntries,
          workspaceFileSystem,
          threadFileWrites,
          projectionSnapshotQuery,
          projectCloneTracker,
          admit,
        }),
        ...registerTerminalRpc({ terminalManager, currentSessionId, admit }),
      });
    }),
  );

// A defect in a handler's effect fails only its own request. RpcServer's default
// sends a socket-level Defect frame instead, and the client ends every pending
// request on the socket with it. DefectReporter logs these defects.
export const WS_RPC_SERVER_OPTIONS = {
  disableTracing: true,
  disableFatalDefects: true,
} as const;

const decodeFirstWebSocketFrame = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export const websocketRpcRouteLayer = HttpRouter.add(
  "GET",
  "/ws",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    // The request's scope lives as long as the socket: the connection's own.
    const connectionScope = yield* Effect.scope;
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const config = yield* ServerConfig.ServerConfig;
    const sessions = yield* Effect.serviceOption(SessionStore.SessionStore);
    const connections = yield* Effect.serviceOption(ZeropsConnections);
    const connectionEnded = yield* Deferred.make<void>();
    let rpcRequest = request;
    let handle: string | undefined;
    let session: EnvironmentAuth.AuthenticatedSession;
    if (config.zerops !== undefined && config.zeropsFixtures === undefined) {
      if (Option.isNone(connections)) return HttpServerResponse.empty({ status: 503 });
      const socket = yield* Effect.orDie(request.upgrade);
      const reader = yield* Effect.orDie(socket.reader);
      const writer = yield* socket.writer;
      // A process told to stop says it is restarting; runs before the socket's own close.
      const toldToStop = yield* Effect.serviceOption(ZeropsToldToStop);
      yield* Effect.addFinalizer(() =>
        Effect.flatMap(
          Option.isSome(toldToStop) ? toldToStop.value.told : Effect.succeed(false),
          (told) =>
            told
              ? writer.write(new Socket.CloseEvent(1012, "restart")).pipe(Effect.ignore)
              : Effect.void,
        ),
      );
      const first = yield* reader.pull.pipe(
        Effect.timeoutOption(Duration.seconds(5)),
        Effect.orDie,
      );
      const frame = Option.isSome(first)
        ? yield* decodeFirstWebSocketFrame(
            typeof first.value[0] === "string"
              ? first.value[0]
              : new TextDecoder().decode(first.value[0]),
          ).pipe(Effect.orElseSucceed(() => undefined))
        : undefined;
      const registry = connections.value;
      const terminals = yield* TerminalManager.TerminalManager;
      const admitted = yield* Effect.acquireRelease(
        registry.admit(
          frame,
          writer
            .write(new Socket.CloseEvent(4401, "Access ended"))
            .pipe(Effect.ignore, Effect.ensuring(Deferred.succeed(connectionEnded, undefined))),
        ),
        (identity) =>
          Option.isNone(identity)
            ? Effect.void
            : registry
                .close(identity.value.ticket)
                .pipe(
                  Effect.andThen(
                    terminals.closeOpenedBy(AuthSessionId.make(identity.value.connectionId)),
                  ),
                  Effect.asVoid,
                ),
      );
      if (Option.isNone(admitted)) {
        yield* writer.write(new Socket.CloseEvent(4401, "Ticket refused")).pipe(Effect.ignore);
        return HttpServerResponse.empty();
      }
      handle = admitted.value.ticket;
      session = {
        sessionId: AuthSessionId.make(admitted.value.connectionId),
        subject: zeropsSubjectOf(admitted.value.userId),
        method: "bearer-access-token",
        scopes: AuthZeropsClientScopes,
      };
      let buffered = Option.isSome(first) ? first.value.slice(1) : [];
      const restReader: Socket.Reader = {
        ...reader,
        pull: Effect.suspend(() => {
          if (buffered.length === 0) return reader.pull;
          const batch = buffered;
          buffered = [];
          return Effect.succeed([batch[0]!, ...batch.slice(1)] as const);
        }),
      };
      rpcRequest = Object.defineProperty(request.modify({}), "upgrade", {
        value: Effect.succeed({ ...socket, reader: Effect.succeed(restReader) }),
      });
    } else {
      session = yield* serverAuth.authenticateWebSocketUpgrade(request).pipe(
        Effect.catchIf(
          EnvironmentAuth.isServerAuthCredentialError,
          failEnvironmentCredentialRejected,
        ),
        Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
          failEnvironmentInternal("internal_error", error),
        ),
      );
      if (Option.isSome(sessions))
        yield* sessions.value.recordClientConnection(
          session.sessionId,
          readClientConnectionOrigin(request),
        );
    }
    const currentScopes =
      handle !== undefined && Option.isSome(connections)
        ? connections.value
            .current(handle)
            .pipe(Effect.map((current) => (Option.isSome(current) ? AuthZeropsClientScopes : [])))
        : Effect.succeed(session.scopes);
    // Asked on every acting call: HQ may name another owner, or refuse the key, while the socket
    // stays open.
    const hqLink = Option.getOrUndefined(yield* Effect.serviceOption(ZeropsHqLink));
    const mateOwner = Option.getOrUndefined(yield* Effect.serviceOption(ZeropsMateOwner));
    const acting =
      hqLink === undefined
        ? Effect.succeed("acts" as const)
        : Effect.zipWith(
            mateOwner?.owner ?? Effect.succeed(undefined),
            hqLink.standing,
            (owner, standing) => actingIn(owner, standing, SessionSubject.make(session.subject)),
          );
    // An admin of the Mate's project keeps someone else's Mate current: asked per call too, of
    // the role the connection's last ticket gave it; nobody administers without a ticket.
    const administers =
      handle !== undefined && Option.isSome(connections)
        ? connections.value
            .current(handle)
            .pipe(
              Effect.map(
                (current) => Option.isSome(current) && roleAtLeast(current.value.role, "ADMIN"),
              ),
            )
        : Effect.succeed(false);
    const rpcWebSocketHttpEffect = yield* Effect.gen(function* () {
      const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
      // Terminal output and a conversation's opening run ahead of the client's acks, each inside
      // its window, so a chunk of theirs no longer costs a round trip.
      yield* RpcServer.make(WsRpcGroup, WS_RPC_SERVER_OPTIONS).pipe(
        Effect.provideService(
          RpcServer.Protocol,
          withStreamWindows(protocol, { ...terminalOutputWindows, ...engineStreamWindows }),
        ),
        Effect.provide(
          Layer.merge(
            rpcScopeAuthorizationLayer(currentScopes, acting, administers),
            rpcInstrumentationLayer,
          ),
        ),
        Effect.forkScoped,
      );
      // @effect-diagnostics-next-line returnEffectInGen:off
      return httpEffect;
    }).pipe(
      Effect.provide(
        makeWsRpcLayer(
          session,
          connectionScope,
          handle !== undefined ? Option.getOrUndefined(connections) : undefined,
        ).pipe(
          Layer.provideMerge(RpcSerialization.layerJson),
          // Request fibers run in the handlers' context, so this reporter sees
          // their defects, not the rest of the server's.
          Layer.provide(DefectReporter.layer),
          Layer.provide(ProviderMaintenanceRunner.layer),
          Layer.provide(ProcessRunner.layer),
          Layer.provide(
            SourceControlDiscovery.layer.pipe(
              Layer.provide(
                SourceControlProviderRegistry.layer.pipe(
                  Layer.provide(
                    Layer.mergeAll(
                      AzureDevOpsCli.layer,
                      BitbucketApi.layer,
                      GitHubCli.layer,
                      GitLabCli.layer,
                      ForgejoCli.layer,
                    ),
                  ),
                  Layer.provideMerge(GitVcsDriver.layer),
                  Layer.provide(
                    VcsDriverRegistry.layer.pipe(Layer.provide(VcsProjectConfig.layer)),
                  ),
                ),
              ),
              Layer.provide(VcsProcess.layer),
            ),
          ),
        ),
      ),
    );
    const endWhenSessionEnds =
      handle !== undefined
        ? Deferred.await(connectionEnded).pipe(Effect.andThen(Effect.interrupt))
        : Option.isSome(sessions)
          ? awaitSessionEnd({
              sessionId: session.sessionId,
              expiresAt: session.expiresAt,
              changes: sessions.value.streamChanges,
            }).pipe(Effect.andThen(Effect.interrupt))
          : Effect.never;
    const serve = Effect.raceFirst(
      rpcWebSocketHttpEffect.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, rpcRequest),
      ),
      endWhenSessionEnds,
    );
    if (handle !== undefined || Option.isNone(sessions)) return yield* serve;
    const store = sessions.value;
    return yield* Effect.acquireUseRelease(
      store.markConnected(session.sessionId),
      () => serve,
      () => store.markDisconnected(session.sessionId),
    );
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
    }),
  ),
);

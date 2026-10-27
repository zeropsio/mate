import * as Deferred from "effect/Deferred";
import * as Socket from "effect/socket/Socket";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { ZeropsConnections } from "./zerops/ZeropsConnections.ts";
import { isAllowedWebSocketOrigin } from "./auth/origin.ts";
import { ZEROPS_SUBJECT_PREFIX } from "./zerops/zeropsSubject.ts";
import { RpcUpdateAdmission } from "./RpcUpdateAdmission.ts";
import { ZeropsSetup } from "./zerops/ZeropsSetup.ts";
import { readsAlongOnly, ZeropsHqLink } from "./zerops/ZeropsHqLink.ts";
import { ThreadFileWrites } from "./zerops/ThreadFileWrites.ts";
import {
  sameUsageLimitCommandCoverage,
  withUsageLimitsCommands,
} from "@t3tools/shared/usageLimits";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL,
  AuthAccessStreamError,
  type AuthAccessStreamEvent,
  AuthSessionId,
  AuthZeropsClientScopes,
  ClientSurface,
  type EditorId,
  type FileManagerRevealKind,
  type OrchestrationClientOrigin,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  type OrchestrationShellStreamEvent,
  type OrchestrationShellStreamItem,
  OrchestrationGetSnapshotError,
  OrchestrationSearchThreadsError,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  type ProjectEntriesFailure,
  type ProjectFileFailure,
  type ProjectFileOperation,
  ProjectListEntriesError,
  ProjectReadFileError,
  ThreadFileWritesError,
  ProjectSearchContentsError,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  McpServersError,
  ProviderUploadFeedbackError,
  ProviderSetupError,
  RelayClientInstallFailedError,
  type RelayClientInstallProgressEvent,
  ServerSelfUpdateError,
  type FilesystemBrowseFailure,
  FilesystemBrowseError,
  AssetWorkspaceContextNotFoundError,
  AssetWorkspaceContextResolutionError,
  AssetImageAccessError,
  RpcClientId,
  EnvironmentAuthorizationError,
  ThreadId,
  type ServerProvider,
  type TerminalAttachStreamEvent,
  type TerminalError,
  type TerminalEvent,
  type TerminalMetadataStreamEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import { HttpRouter, HttpServerRequest, HttpServerRespondable } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import * as ServerConfig from "./config.ts";
import * as Keybindings from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import { makeLiveStreamBudget, type RetainedLiveItem } from "./orchestration/LiveStreamBudget.ts";
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
import { makeProviderInstallation } from "./provider/providerInstallation.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import { withTerminalOutputWindow } from "./terminal/OutputProtocol.ts";
import { resolveAssetContext } from "./engineSessionDirectory.ts";
import { resolveImageAsset } from "./assets/ImageAsset.ts";
import { issueAssetUrl } from "./assets/AssetAccess.ts";
import { deletePendingAttachment, issueAttachmentUploadUrl } from "./assets/AttachmentUpload.ts";
import * as WorkspaceEntries from "./workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./workspace/WorkspaceFileSystem.ts";
import { readWorkflowScript } from "./orchestration/workflowScriptQuery.ts";
import * as WorkspacePaths from "./workspace/WorkspacePaths.ts";
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
import { registerEngineRpc } from "./engine/registerEngineRpc.ts";
import { registerZeropsRpc } from "./zerops/registerZeropsRpc.ts";
import { ZeropsMateAttention } from "./zerops/ZeropsMateAttention.ts";
import * as UsageLimitSources from "./usage/UsageLimitSources.ts";
import * as TraceDiagnostics from "./diagnostics/TraceDiagnostics.ts";
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
import { runExecCommand } from "./zerops/ExecService.ts";
import * as ProcessRunner from "./processRunner.ts";
import * as RelayClient from "@t3tools/shared/relayClient";

const CONFIG_DISCOVERY_TIMEOUT = Duration.seconds(5);

const resolveDiscoveryForConfig = <A, E, R>(
  discovery: Effect.Effect<A, E, R>,
  onTimeout: () => A,
) =>
  discovery.pipe(
    Effect.timeoutOption(CONFIG_DISCOVERY_TIMEOUT),
    Effect.map(Option.getOrElse(onTimeout)),
  );

export const resolveAvailableEditorsForConfig = <A, E, R>(
  discovery: Effect.Effect<ReadonlyArray<A>, E, R>,
) => resolveDiscoveryForConfig(discovery, () => []);

export const resolveFileManagerRevealKindForConfig = <E, R>(
  discovery: Effect.Effect<FileManagerRevealKind | undefined, E, R>,
) => resolveDiscoveryForConfig(discovery, () => undefined);

function unexpectedCompatibilityError(error: never): never {
  throw new Error(`Unhandled compatibility error: ${String(error)}`);
}

/** Preserve the setup runner's broader pre-refactor message normalization. */
function projectEntriesFailureContext(error: WorkspaceEntries.WorkspaceEntriesError): {
  readonly failure: ProjectEntriesFailure;
  readonly normalizedCwd?: string;
  readonly timeout?: string;
  readonly detail?: string;
} {
  switch (error._tag) {
    case "WorkspaceRootNotExistsError":
      return {
        failure: "workspace_root_not_found",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceRootCreateFailedError":
      return {
        failure: "workspace_root_create_failed",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceRootStatFailedError":
      return {
        failure: "workspace_root_stat_failed",
        normalizedCwd: error.normalizedWorkspaceRoot,
        detail: error.phase,
      };
    case "WorkspaceRootNotDirectoryError":
      return {
        failure: "workspace_root_not_directory",
        normalizedCwd: error.normalizedWorkspaceRoot,
      };
    case "WorkspaceEntriesReadDirectoryError":
      return {
        failure: "directory_list_failed",
        ...(error.cwd !== undefined ? { normalizedCwd: error.cwd } : {}),
        detail: error.message,
      };
    case "WorkspaceSearchIndexCreateFailed":
      return {
        failure: "search_index_create_failed",
        normalizedCwd: error.cwd,
        detail: error.reason,
      };
    case "WorkspaceSearchIndexScanTimedOut":
      return {
        failure: "search_index_scan_timed_out",
        normalizedCwd: error.cwd,
        timeout: error.timeout,
      };
    case "WorkspaceSearchIndexSearchFailed":
      return {
        failure: "search_index_search_failed",
        normalizedCwd: error.cwd,
        detail: error.reason,
      };
    default:
      return unexpectedCompatibilityError(error);
  }
}

function filesystemBrowseFailureContext(error: WorkspaceEntries.WorkspaceEntriesBrowseError): {
  readonly failure: FilesystemBrowseFailure;
  readonly parentPath?: string;
  readonly platform?: string;
} {
  switch (error._tag) {
    case "WorkspaceEntriesWindowsPathUnsupportedError":
      return { failure: "windows_path_unsupported", platform: error.platform };
    case "WorkspaceEntriesCurrentProjectRequiredError":
      return { failure: "current_project_required" };
    case "WorkspaceEntriesReadDirectoryError":
      return { failure: "read_directory_failed", parentPath: error.parentPath };
    default:
      return unexpectedCompatibilityError(error);
  }
}

function projectFileFailureContext(
  error:
    | WorkspaceFileSystem.WorkspaceFileSystemError
    | WorkspacePaths.WorkspacePathOutsideRootError,
): {
  readonly failure: ProjectFileFailure;
  readonly resolvedPath?: string;
  readonly resolvedWorkspaceRoot?: string;
  readonly operation?: ProjectFileOperation;
  readonly operationPath?: string;
} {
  switch (error._tag) {
    case "WorkspacePathOutsideRootError":
      return { failure: "workspace_path_outside_root" };
    case "WorkspaceFileSystemOperationError":
      return {
        failure: "operation_failed",
        resolvedPath: error.resolvedPath,
        operation: error.operation,
        operationPath: error.operationPath,
      };
    case "WorkspaceFilePathEscapeError":
      return {
        failure: "resolved_path_outside_root",
        resolvedPath: error.resolvedPath,
        resolvedWorkspaceRoot: error.resolvedWorkspaceRoot,
      };
    case "WorkspacePathNotFileError":
      return { failure: "path_not_file", resolvedPath: error.resolvedPath };
    case "WorkspaceBinaryFileError":
      return { failure: "binary_file", resolvedPath: error.resolvedPath };
    default:
      return unexpectedCompatibilityError(error);
  }
}

const PROVIDER_STATUS_DEBOUNCE_MS = 200;

// When a resuming client's cursor is more than this many events behind the
// current head, skip the per-event catch-up replay and send a fresh shell
// snapshot instead. Replaying each intervening event costs a shell refetch;
// past this gap a single O(active-threads) snapshot is cheaper and bounded.
// Matches the event store's default page size (DEFAULT_READ_FROM_SEQUENCE_LIMIT).
const SHELL_RESUME_MAX_GAP = 1_000;

// Row count alone does not bound replay memory: a few events with large tool
// payloads can decode to gigabytes. Before replaying, sum the serialized
// payload bytes of the range in SQL and reset with a snapshot past this budget.
const ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES = 8 * 1024 * 1024;

function toAuthAccessStreamEvent(
  change: PairingGrantStore.BootstrapCredentialChange | SessionStore.SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

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

const makeWsRpcLayer = (currentSession: EnvironmentAuth.AuthenticatedSession) =>
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
      const canReplayPersistedRange = Effect.fnUntraced(function* (
        afterSequence: number,
        headSequence: number,
        maxGap: number,
      ) {
        const replayGap = headSequence - afterSequence;
        if (replayGap < 0 || replayGap > maxGap) {
          return false;
        }
        const stats = yield* projectionSnapshotQuery
          .getEventReplayStats({
            fromSequenceExclusive: afterSequence,
            toSequenceInclusive: headSequence,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to measure orchestration replay range",
                  cause,
                }),
            ),
          );
        if (stats.payloadBytes > ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES) {
          yield* Effect.logDebug("orchestration replay replaced by snapshot", {
            afterSequence,
            headSequence,
            replayGap,
            eventCount: stats.eventCount,
            payloadBytes: stats.payloadBytes,
            payloadBudgetBytes: ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES,
          });
          return false;
        }
        return true;
      });
      const projectCloneTracker = yield* ProjectCloneTracker.ProjectCloneTracker;
      const repositoryIdentityResolver =
        yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
      const { serverVersion } = yield* serverEnvironment.getDescriptor;
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
      const automaticGitFetchInterval = serverSettings.getSettings.pipe(
        Effect.map(
          (settings) => resolveServerBackgroundActivitySettings(settings).automaticGitFetchInterval,
        ),
        Effect.catch((cause) =>
          Effect.logWarning("Failed to read automatic Git fetch interval setting", {
            detail: cause.message,
          }).pipe(Effect.as(DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL)),
        ),
      );
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
      const withMcpServers = <A>(
        operation: string,
        run: (service: McpServers["Service"]) => Effect.Effect<A, McpServersError>,
      ) =>
        Option.isSome(mcpServers)
          ? run(mcpServers.value)
          : Effect.fail(
              new McpServersError({ operation, detail: "MCP servers can't be managed here." }),
            );
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
      const zeropsDataConsole = yield* ZeropsDataConsoleModule.ZeropsDataConsole;
      const zeropsGitRemoteProbe = yield* ZeropsGitRemoteProbeModule.ZeropsGitRemoteProbe;
      // What a thread's agent wrote, read back; absent where no store backs it.
      const threadFileWrites = Option.getOrUndefined(yield* Effect.serviceOption(ThreadFileWrites));
      const withThreadFileWrites = <A>(
        run: (service: ThreadFileWrites["Service"]) => Effect.Effect<A, ThreadFileWritesError>,
      ) =>
        threadFileWrites === undefined
          ? Effect.fail(new ThreadFileWritesError({ reason: "unavailable" }))
          : run(threadFileWrites);
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

      const loadAuthAccessSnapshot = () =>
        Effect.all({
          pairingLinks: serverAuth.listPairingLinks(),
          clientSessions: serverAuth.listClientSessions(currentSessionId),
        }).pipe(
          Effect.mapError(
            (error) =>
              new AuthAccessStreamError({
                message: error.message,
              }),
          ),
        );

      // Shell updates refetch the aggregate. Message and tool bodies are not needed.
      const toShellEvent = ({
        type,
        aggregateKind,
        aggregateId,
        sequence,
      }: OrchestrationEvent) => ({
        type,
        aggregateKind,
        aggregateId,
        sequence,
      });
      type ShellEvent = ReturnType<typeof toShellEvent>;

      const toShellStreamEvent = (
        event: ShellEvent,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
        switch (event.type) {
          case "project.created":
          case "project.meta-updated":
            return projectUpsertOrRemove(ProjectId.make(event.aggregateId), event.sequence);
          case "project.deleted":
            return Effect.succeedSome({
              kind: "project-removed" as const,
              sequence: event.sequence,
              projectId: ProjectId.make(event.aggregateId),
            });
          case "thread.deleted":
          case "thread.archived":
            return Effect.succeedSome({
              kind: "thread-removed" as const,
              sequence: event.sequence,
              threadId: ThreadId.make(event.aggregateId),
            });
          case "thread.unarchived":
            return threadUpsertOrRemove(ThreadId.make(event.aggregateId), event.sequence);
          default:
            if (event.aggregateKind !== "thread") {
              return Effect.succeedNone;
            }
            return threadUpsertOrRemove(ThreadId.make(event.aggregateId), event.sequence);
        }
      };

      // Coalescing makes each projection read represent every event for that
      // aggregate in the current window. Retry a typed persistence failure once
      // so a brief read failure cannot strand the shell at its previous state.
      // If both attempts fail, log and drop the stream item; treating an error as
      // a missing row would incorrectly remove a still-active aggregate.
      const retryShellProjectionRead = <A, E>(
        aggregateKind: "project" | "thread",
        aggregateId: string,
        read: Effect.Effect<A, E>,
      ): Effect.Effect<Option.Option<A>, never, never> =>
        read.pipe(
          Effect.retry({ times: 1 }),
          Effect.asSome,
          Effect.tapError((error) =>
            Effect.logWarning("orchestration shell projection refetch failed", {
              aggregateKind,
              aggregateId,
              error,
            }),
          ),
          Effect.orElseSucceed(() => Option.none()),
        );

      const projectUpsertOrRemove = (
        projectId: ProjectId,
        sequence: number,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> =>
        retryShellProjectionRead(
          "project",
          projectId,
          projectionSnapshotQuery.getProjectShellById(projectId),
        ).pipe(
          Effect.map(
            Option.flatMap((project) =>
              Option.match(project, {
                onNone: () =>
                  Option.some<OrchestrationShellStreamEvent>({
                    kind: "project-removed" as const,
                    sequence,
                    projectId,
                  }),
                onSome: (nextProject) =>
                  Option.some<OrchestrationShellStreamEvent>({
                    kind: "project-upserted" as const,
                    sequence,
                    project: nextProject,
                  }),
              }),
            ),
          ),
        );

      // Refetch a thread's shell and emit an upsert if it is still active, or a
      // `thread-removed` if the projection has no active row for it. Emitting a
      // removal on a `none` (rather than dropping the event) is what keeps
      // coalescing correct: when a burst collapses a `thread.deleted`/`archived`
      // into a later refetchable event for the same thread, the refetch returns
      // `none` for the now-inactive row and this still tells the sidebar to drop
      // it. A `thread-removed` the client does not have is a harmless no-op. The
      // projection commits in the same transaction before the event publishes,
      // so a `none` reliably means the thread is deleted or archived, not
      // not-yet-persisted.
      const threadUpsertOrRemove = (
        threadId: ThreadId,
        sequence: number,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> =>
        retryShellProjectionRead(
          "thread",
          threadId,
          projectionSnapshotQuery.getThreadShellById(threadId),
        ).pipe(
          Effect.map(
            Option.flatMap((thread) =>
              Option.match(thread, {
                onNone: () =>
                  Option.some<OrchestrationShellStreamEvent>({
                    kind: "thread-removed" as const,
                    sequence,
                    threadId,
                  }),
                onSome: (nextThread) =>
                  Option.some<OrchestrationShellStreamEvent>({
                    kind: "thread-upserted" as const,
                    sequence,
                    thread: nextThread,
                  }),
              }),
            ),
          ),
        );

      // Turn a batch of domain events into shell stream items, coalescing by
      // aggregate first. `toShellStreamEvent` re-reads the *current* projected
      // shell for an aggregate, so within a batch only the latest event per
      // aggregate matters: a burst of streaming `thread.message-sent` deltas for
      // one thread collapses into a single shell refetch, and an unrelated
      // `thread.created` in the same batch is never stuck behind those DB reads.
      //
      // Input events arrive in ascending sequence; we keep the last (highest
      // sequence) event per aggregate, then re-sort ascending before emitting so
      // the client — which applies shell items strictly by increasing sequence
      // and drops any `sequence <= snapshotSequence` — never skips a coalesced
      // item. The refetch runs with bounded concurrency (order-preserving).
      const SHELL_REFETCH_CONCURRENCY = 8;
      const coalesceShellEvents = (
        events: ReadonlyArray<ShellEvent>,
      ): Effect.Effect<ReadonlyArray<OrchestrationShellStreamEvent>, never, never> =>
        Effect.gen(function* () {
          if (events.length === 0) {
            return [];
          }
          const latestByAggregate = new Map<string, ShellEvent>();
          for (const event of events) {
            latestByAggregate.set(`${event.aggregateKind}:${event.aggregateId}`, event);
          }
          const survivors = Array.from(latestByAggregate.values()).sort(
            (left, right) => left.sequence - right.sequence,
          );
          const shellEvents = yield* Effect.forEach(survivors, toShellStreamEvent, {
            concurrency: SHELL_REFETCH_CONCURRENCY,
          });
          return shellEvents.flatMap((option) => (Option.isSome(option) ? [option.value] : []));
        });

      // Small time/size window over which to coalesce shell events. The window
      // bounds the worst-case added latency for a brand-new thread to appear in
      // the sidebar (imperceptible), while collapsing high-frequency streaming
      // traffic so it can't serialize the shell stream behind per-event DB reads.
      const SHELL_COALESCE_WINDOW = Duration.millis(50);
      const SHELL_COALESCE_MAX_CHUNK = 512;
      const coalesceShellStream = <E, R>(
        stream: Stream.Stream<OrchestrationEvent, E, R>,
      ): Stream.Stream<OrchestrationShellStreamEvent, E, R> =>
        stream.pipe(
          Stream.map(toShellEvent),
          Stream.groupedWithin(SHELL_COALESCE_MAX_CHUNK, SHELL_COALESCE_WINDOW),
          Stream.mapEffect(coalesceShellEvents),
          Stream.flatMap((items) => Stream.fromIterable(items)),
        );

      type ShellLiveInput =
        | { readonly kind: "event"; readonly event: ShellEvent }
        | { readonly kind: "synchronized" };

      // A completion marker is queued alongside live event metadata so it cannot
      // overtake an event still waiting in the coalescing window. Split each
      // batch at markers and coalesce only the event segments on either side.
      const coalesceShellLiveInputs = (
        inputs: ReadonlyArray<ShellLiveInput>,
      ): Effect.Effect<ReadonlyArray<OrchestrationShellStreamItem>, never, never> =>
        Effect.gen(function* () {
          const output: Array<OrchestrationShellStreamItem> = [];
          let pendingEvents: Array<ShellEvent> = [];

          for (const input of inputs) {
            if (input.kind === "event") {
              pendingEvents.push(input.event);
              continue;
            }

            output.push(...(yield* coalesceShellEvents(pendingEvents)));
            pendingEvents = [];
            output.push({ kind: "synchronized" });
          }

          output.push(...(yield* coalesceShellEvents(pendingEvents)));
          return output;
        });

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

      // Only clients that answer /usage-limits themselves see it in the catalogs;
      // an older client would send the injected command to the provider.
      const loadServerConfig = (options: { readonly usageLimitsCommand: boolean }) =>
        Effect.gen(function* () {
          const keybindingsConfig = yield* keybindings.loadConfigState;
          const currentProviders = yield* providerRegistry.getProviders.pipe(
            Effect.flatMap(withZeropsAgentAuth),
          );
          const providers = options.usageLimitsCommand
            ? withUsageLimitsCommands(currentProviders, yield* usageLimitSources.current)
            : currentProviders;
          const settings = ServerSettings.redactServerSettingsForClient(
            yield* serverSettings.getSettings,
          );
          const environment = yield* serverEnvironment.getDescriptor;
          const auth = yield* serverAuth.getDescriptor();
          const availableEditors: ReadonlyArray<EditorId> = yield* resolveAvailableEditorsForConfig(
            externalLauncher.resolveAvailableEditors(),
          );
          const fileManagerRevealKind = availableEditors.includes("file-manager")
            ? yield* resolveFileManagerRevealKindForConfig(
                externalLauncher.resolveFileManagerRevealKind(),
              )
            : undefined;

          return {
            environment,
            auth,
            cwd: config.cwd,
            keybindingsConfigPath: config.keybindingsConfigPath,
            keybindings: keybindingsConfig.keybindings,
            issues: keybindingsConfig.issues,
            providers,
            availableEditors,
            // Same discovery-with-timeout treatment as editors: a slow probe
            // must not stall server.getConfig, so it degrades to no targets.
            remoteOpenTargets: yield* resolveAvailableEditorsForConfig(
              remoteOpenTargets.resolveTargets(),
            ),
            observability: {
              logsDirectoryPath: config.logsDir,
              localTracingEnabled: true,
              ...(config.otlpTracesUrl !== undefined
                ? { otlpTracesUrl: config.otlpTracesUrl }
                : {}),
              otlpTracesEnabled: config.otlpTracesUrl !== undefined,
              ...(config.otlpMetricsUrl !== undefined
                ? { otlpMetricsUrl: config.otlpMetricsUrl }
                : {}),
              otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
              ...(config.otlpLogsUrl !== undefined ? { otlpLogsUrl: config.otlpLogsUrl } : {}),
              otlpLogsEnabled: config.otlpLogsUrl !== undefined,
            },
            settings,
            shellResumeCompletionMarker: true,
            ...(fileManagerRevealKind === undefined
              ? {}
              : {
                  shellRevealInFileManager: true,
                  shellRevealInFileManagerKind: fileManagerRevealKind,
                }),
          };
        });

      const refreshGitStatus = (cwd: string) =>
        vcsStatusBroadcaster
          .refreshStatus(cwd)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

      return WsRpcGroup.of({
        // The Mate engine owns every conversation: only an app older than it dispatches here.
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: () =>
          admit(ORCHESTRATION_WS_METHODS.dispatchCommand, Effect.fail(engineMoved())),
        [ORCHESTRATION_WS_METHODS.getWorkflowScript]: (input) =>
          readWorkflowScript({ scriptPath: input.scriptPath }),
        [ORCHESTRATION_WS_METHODS.searchThreads]: (input) =>
          projectionSnapshotQuery.searchThreads(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationSearchThreadsError({
                  message: "Failed to search threads",
                  cause,
                }),
            ),
          ),
        [ORCHESTRATION_WS_METHODS.subscribeShell]: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              // Coalesce the live shell stream per aggregate over a small window
              // so bursts of high-frequency events (streaming message deltas,
              // activity appends) collapse into a single shell refetch and never
              // serialize a brand-new thread's `thread.created` behind hundreds
              // of per-event DB reads. See coalesceShellStream.
              // Attach live delivery into a scope-bound buffer BEFORE loading any
              // snapshot or draining catch-up, otherwise an event published while
              // the snapshot query is in flight is lost (it is past the snapshot's
              // sequence but the live subscription is not attached yet). Every
              // path below emits from this same buffered live tail. Overlapping
              // events are deduped by sequence on the client.
              const liveBudget = yield* makeLiveStreamBudget();
              const liveBuffer = yield* Queue.unbounded<
                RetainedLiveItem<ShellLiveInput>,
                OrchestrationGetSnapshotError
              >();
              let liveBufferClosed = false;
              const closeLiveBuffer = (error?: OrchestrationGetSnapshotError) =>
                Effect.gen(function* () {
                  if (liveBufferClosed) {
                    return;
                  }
                  liveBufferClosed = true;
                  liveBudget.release(yield* Queue.clear(liveBuffer).pipe(Effect.orDie));
                  if (error) {
                    yield* Queue.fail(liveBuffer, error);
                  }
                  yield* Queue.shutdown(liveBuffer);
                });
              yield* Effect.addFinalizer(() => closeLiveBuffer());
              yield* liveBudget.failed.pipe(
                Effect.catchTags({ OrchestrationGetSnapshotError: closeLiveBuffer }),
                Effect.forkScoped,
              );
              yield* Effect.forkScoped(
                orchestrationEngine.streamDomainEvents.pipe(
                  Stream.map(toShellEvent),
                  Stream.runForEach((event) =>
                    liveBudget.retain({ kind: "event" as const, event }, event).pipe(
                      Effect.flatMap((item) => Queue.offer(liveBuffer, item)),
                      Effect.uninterruptible,
                    ),
                  ),
                  // Stop the PubSub consumer even if RPC delivery is waiting
                  // for an ACK and never pulls the failed buffer again.
                  Effect.raceFirst(liveBudget.failed),
                  Effect.catchTags({ OrchestrationGetSnapshotError: () => Effect.void }),
                ),
                { startImmediately: true },
              );
              const coalesceRetainedInputs = (
                items: ReadonlyArray<RetainedLiveItem<ShellLiveInput>>,
              ) =>
                coalesceShellLiveInputs(items.map((item) => item.value)).pipe(
                  Effect.flatMap((output) => liveBudget.replace(items, output)),
                );
              const bufferedLiveStream = Stream.fromQueue(liveBuffer).pipe(
                Stream.groupedWithin(SHELL_COALESCE_MAX_CHUNK, SHELL_COALESCE_WINDOW),
                Stream.mapEffect(coalesceRetainedInputs),
                Stream.flatMap((items) => Stream.fromIterable(items)),
              );

              const loadSnapshot = projectionSnapshotQuery.getShellSnapshot().pipe(
                Effect.tapError((cause) =>
                  Effect.logError("orchestration shell snapshot load failed", { cause }),
                ),
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: "Failed to load orchestration shell snapshot",
                      cause,
                    }),
                ),
              );

              // Offer the completion marker into the same queue as live events.
              // Anything buffered while snapshot/replay work was in flight is
              // therefore delivered before the client is told it is synchronized.
              const synchronizedThenLive = liveBudget.deliver(
                input.requestCompletionMarker === true
                  ? Stream.concat(
                      Stream.fromEffect(
                        liveBudget.retain({ kind: "synchronized" as const }).pipe(
                          Effect.flatMap((item) => Queue.offer(liveBuffer, item)),
                          Effect.uninterruptible,
                          Effect.andThen(Queue.takeAll(liveBuffer)),
                          Effect.flatMap(coalesceRetainedInputs),
                        ),
                      ).pipe(Stream.flatMap((items) => Stream.fromIterable(items))),
                      bufferedLiveStream,
                    )
                  : bufferedLiveStream,
              );

              // When the client already holds a shell snapshot (cached, or loaded
              // over HTTP) it passes that snapshot's sequence, and we resume by
              // replaying shell events after it instead of re-sending the whole
              // projects/threads list over the socket. If the client is too far
              // behind, we fall back to a fresh snapshot instead of an unbounded
              // replay (see below).
              if (input.afterSequence !== undefined) {
                const afterSequence = input.afterSequence;
                const headSequence = yield* orchestrationEngine.latestSequence;
                const replayGap = headSequence - afterSequence;
                // Gap too large: replaying every intervening event (each a shell
                // refetch) is far more expensive than a single O(active-threads)
                // snapshot. A cursor ahead of this engine's authoritative state
                // is also invalid, so reset it with a snapshot. Send the snapshot
                // followed by the buffered live tail, exactly as the
                // no-afterSequence path does.
                if (
                  !(yield* canReplayPersistedRange(
                    afterSequence,
                    headSequence,
                    SHELL_RESUME_MAX_GAP,
                  ))
                ) {
                  const snapshot = yield* loadSnapshot;
                  return Stream.concat(
                    Stream.make({ kind: "snapshot" as const, snapshot }),
                    synchronizedThenLive,
                  );
                }
                const catchUpStream = coalesceShellStream(
                  // Replay only through the head captured above. Newer events
                  // are already covered by the live subscription, so this bound
                  // cannot chase a moving event-store head or grow the live
                  // buffer indefinitely while waiting for an empty page.
                  orchestrationEngine.readEvents(afterSequence, replayGap),
                ).pipe(
                  Stream.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: "Failed to replay orchestration shell events",
                        cause,
                      }),
                  ),
                );
                return Stream.concat(catchUpStream, synchronizedThenLive);
              }

              const snapshot = yield* loadSnapshot;
              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot,
                }),
                synchronizedThenLive,
              );
            }),
          ),
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
        [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: (_input) =>
          projectionSnapshotQuery.getArchivedShellSnapshot().pipe(
            Effect.tapError((cause) =>
              Effect.logError("orchestration archived shell snapshot load failed", { cause }),
            ),
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load archived orchestration shell snapshot",
                  cause,
                }),
            ),
          ),
        [WS_METHODS.execRun]: (input) => admit(WS_METHODS.execRun, runExecCommand(input)),
        [WS_METHODS.serverProbe]: (_input) => Effect.succeed({}),
        [WS_METHODS.serverGetConfig]: (_input) => loadServerConfig({ usageLimitsCommand: false }),
        [WS_METHODS.serverRefreshProviders]: (input) =>
          admit(
            WS_METHODS.serverRefreshProviders,
            Effect.gen(function* () {
              // Only explicit catalog refreshes bypass T3's caches. Workspace
              // discovery and background status checks retain their timers.
              if (input.refreshModels) {
                yield* modelManifest.forceRefresh;
                const instances = yield* providerInstances.listInstances;
                yield* Effect.forEach(
                  instances.filter(
                    (instance) =>
                      input.instanceId === undefined || input.instanceId === instance.instanceId,
                  ),
                  (instance) =>
                    Effect.gen(function* () {
                      yield* instance.invalidateCaches ?? Effect.void;
                      const maintenance = yield* instance.snapshot.resolveMaintenance({
                        fresh: true,
                      });
                      if (maintenance.packageName)
                        providerVersionCache.delete(maintenance.packageName);
                    }),
                  { concurrency: "unbounded", discard: true },
                );
              }
              // An untargeted refresh is "re-read everything's status", which
              // includes quota from configured usage-limit sources. Awaited,
              // not forked: the RPC scope closes on return and would
              // interrupt a fork before the hub answered.
              if (input.instanceId === undefined) {
                yield* usageLimitSources.refresh;
              }
              let providers = yield* input.cwd !== undefined && input.instanceId !== undefined
                ? providerRegistry.refreshWorkspaceSnapshot({
                    instanceId: input.instanceId,
                    cwd: input.cwd,
                    fresh: input.fresh === true,
                  })
                : input.instanceId !== undefined
                  ? providerRegistry.refreshInstance(input.instanceId)
                  : providerRegistry.refresh();
              if (input.refreshModels) {
                const instances = yield* providerInstances.listInstances;
                for (const instance of instances) {
                  if (
                    !instance.refreshModels ||
                    (input.instanceId !== undefined && input.instanceId !== instance.instanceId) ||
                    !providers.some(
                      (provider) =>
                        provider.instanceId === instance.instanceId &&
                        provider.enabled &&
                        provider.installed,
                    )
                  )
                    continue;
                  yield* instance.refreshModels().pipe(
                    Effect.mapError(
                      (error) =>
                        new ProviderSetupError({
                          instanceId: instance.instanceId,
                          operation: "refresh-models",
                          detail: error.detail,
                        }),
                    ),
                  );
                  providers = yield* providerRegistry.refreshInstance(instance.instanceId);
                }
              }
              return { providers: yield* withZeropsAgentAuth(providers) };
            }),
          ),
        // The MCP tab's methods (`zerops/mcp/McpServers.ts`).
        [WS_METHODS.mcpServersList]: (input) =>
          withMcpServers(WS_METHODS.mcpServersList, (mcp) => mcp.list(input)),
        [WS_METHODS.mcpServersAdd]: (input) =>
          admit(
            WS_METHODS.mcpServersAdd,
            withMcpServers(WS_METHODS.mcpServersAdd, (mcp) => mcp.add(input)),
          ),
        [WS_METHODS.mcpServersRemove]: (input) =>
          admit(
            WS_METHODS.mcpServersRemove,
            withMcpServers(WS_METHODS.mcpServersRemove, (mcp) => mcp.remove(input)),
          ),
        [WS_METHODS.mcpServersSetEnabled]: (input) =>
          admit(
            WS_METHODS.mcpServersSetEnabled,
            withMcpServers(WS_METHODS.mcpServersSetEnabled, (mcp) => mcp.setEnabled(input)),
          ),
        [WS_METHODS.mcpServersReconnect]: (input) =>
          admit(
            WS_METHODS.mcpServersReconnect,
            withMcpServers(WS_METHODS.mcpServersReconnect, (mcp) => mcp.reconnect(input)),
          ),
        [WS_METHODS.providerUploadFeedback]: (input) =>
          admit(
            WS_METHODS.providerUploadFeedback,
            providerService.uploadFeedback(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderUploadFeedbackError({
                    threadId: input.threadId,
                    cause,
                  }),
              ),
            ),
          ),
        [WS_METHODS.serverUpdateProvider]: (input) =>
          admit(
            WS_METHODS.serverUpdateProvider,
            providerMaintenanceRunner
              .updateProvider(input)
              .pipe(
                Effect.flatMap((updated) =>
                  withZeropsAgentAuth(updated.providers).pipe(
                    Effect.map((providers) => ({ ...updated, providers })),
                  ),
                ),
              ),
          ),
        [WS_METHODS.providerConsumeResetCredit]: (input) =>
          admit(
            WS_METHODS.providerConsumeResetCredit,
            Effect.gen(function* () {
              if ("sourceId" in input) return yield* usageLimitSources.consumeResetCredit(input);
              const instance = yield* providerInstances.getInstance(input.instanceId);
              // A disabled instance must not spend anything on its account.
              if (instance === undefined || !instance.enabled) {
                return yield* new ProviderSetupError({
                  instanceId: input.instanceId,
                  operation: "consume-reset-credit",
                  detail: instance ? "This provider is disabled." : "Provider instance not found.",
                });
              }
              if (instance.consumeResetCredit === undefined) {
                return yield* new ProviderSetupError({
                  instanceId: input.instanceId,
                  operation: "consume-reset-credit",
                  detail: "This provider does not bank reset credits.",
                });
              }
              const outcome = yield* instance.consumeResetCredit().pipe(
                Effect.mapError(
                  (error) =>
                    new ProviderSetupError({
                      instanceId: input.instanceId,
                      operation: "consume-reset-credit",
                      detail: error.detail,
                      cause: error,
                    }),
                ),
              );
              return { outcome };
            }),
          ),
        [WS_METHODS.providerAuthStart]: (input) =>
          admit(WS_METHODS.providerAuthStart, providerAuth.start(input, currentSessionId)),
        [WS_METHODS.providerAuthRespond]: (input) =>
          Effect.annotateCurrentSpan({ instanceId: input.instanceId }).pipe(
            Effect.andThen(
              admit(WS_METHODS.providerAuthRespond, providerAuth.respond(input, currentSessionId)),
            ),
          ),
        [WS_METHODS.providerAuthComplete]: (input) =>
          admit(WS_METHODS.providerAuthComplete, providerAuth.complete(input, currentSessionId)),
        [WS_METHODS.providerAuthCancel]: (input) =>
          admit(WS_METHODS.providerAuthCancel, providerAuth.cancel(input, currentSessionId)),
        [WS_METHODS.providerAuthLogout]: (input) =>
          admit(WS_METHODS.providerAuthLogout, providerAuth.logout(input)),
        [WS_METHODS.providerAuthSubscribe]: (input) =>
          providerAuth.subscribe(input, currentSessionId),
        [WS_METHODS.providerInstallStart]: (input) =>
          admit(WS_METHODS.providerInstallStart, providerInstallation.start(input)),
        [WS_METHODS.providerInstallCancel]: (input) =>
          admit(WS_METHODS.providerInstallCancel, providerInstallation.cancel(input)),
        [WS_METHODS.providerInstallSubscribe]: (input) => providerInstallation.subscribe(input),
        [WS_METHODS.providerInstallRemove]: (input) =>
          admit(WS_METHODS.providerInstallRemove, providerInstallation.remove(input)),
        // Retained only for clients shipped at v0.1.0, before self-update was removed. No
        // capability advertises these methods and no current client path calls them. Remove
        // after one release cycle, once no released client offers the update action.
        [WS_METHODS.serverUpdateServer]: (input) =>
          admit(
            WS_METHODS.serverUpdateServer,
            Effect.fail(
              new ServerSelfUpdateError({
                reason: `Zerops Mate ${input.targetVersion} must be installed outside the running server.`,
              }),
            ),
          ),
        [WS_METHODS.serverUpdateServerWithProgress]: () =>
          Stream.fail(
            new ServerSelfUpdateError({
              reason: "Zerops Mate must be installed outside the running server.",
            }),
          ),
        [WS_METHODS.serverUpsertKeybinding]: (rule) =>
          admit(
            WS_METHODS.serverUpsertKeybinding,
            Effect.gen(function* () {
              const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
              return { keybindings: keybindingsConfig, issues: [] };
            }),
          ),
        [WS_METHODS.serverRemoveKeybinding]: (rule) =>
          admit(
            WS_METHODS.serverRemoveKeybinding,
            Effect.gen(function* () {
              const keybindingsConfig = yield* keybindings.removeKeybindingRule(rule);
              return { keybindings: keybindingsConfig, issues: [] };
            }),
          ),
        [WS_METHODS.serverGetSettings]: (_input) =>
          serverSettings.getSettings.pipe(Effect.map(ServerSettings.redactServerSettingsForClient)),
        [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
          admit(
            WS_METHODS.serverUpdateSettings,
            serverSettings
              .updateSettings(patch)
              .pipe(Effect.map(ServerSettings.redactServerSettingsForClient)),
          ),
        [WS_METHODS.serverDiscoverSourceControl]: (_input) => sourceControlDiscovery.discover,
        [WS_METHODS.serverGetTraceDiagnostics]: (_input) =>
          TraceDiagnostics.readTraceDiagnostics({
            traceFilePath: config.serverTracePath,
            maxFiles: config.traceMaxFiles,
          }),
        [WS_METHODS.serverGetProcessDiagnostics]: (_input) => processDiagnostics.read,
        [WS_METHODS.serverGetProcessResourceHistory]: (input) =>
          processResourceMonitor.readHistory(input),
        [WS_METHODS.serverGetResourceTelemetryHistory]: (input) =>
          resourceTelemetry.readHistory(input),
        [WS_METHODS.serverRetryResourceTelemetry]: (_input) =>
          admit(WS_METHODS.serverRetryResourceTelemetry, resourceTelemetry.retry),
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
          zeropsDataConsole,
          zeropsGitRemoteProbe,
          zeropsCrewProposals,
          subject: currentSession.subject,
          admit,
        }),
        ...registerCrewRpc({
          crew,
          subject: currentSession.subject,
          admit,
        }),
        ...registerEngineRpc({
          engine: mateEngine,
          source: Effect.map(zeropsMateAttention.current, (attention) => attention.source),
          subject: currentSession.subject,
          admit,
        }),
        [WS_METHODS.serverSignalProcess]: (input) =>
          admit(WS_METHODS.serverSignalProcess, processDiagnostics.signal(input)),
        [WS_METHODS.serverReportClientActivity]: (input, metadata) =>
          Ref.update(rpcClientIds, (clientIds) => {
            const next = new Set(clientIds);
            next.add(RpcClientId.make(metadata.client.id));
            return next;
          }).pipe(
            Effect.andThen(
              backgroundPolicy.reportClientActivity(
                currentSessionId,
                RpcClientId.make(metadata.client.id),
                input,
              ),
            ),
          ),
        [WS_METHODS.serverReportHostPowerState]: (input) =>
          admit(
            WS_METHODS.serverReportHostPowerState,
            backgroundPolicy.reportHostPowerState(input),
          ),
        [WS_METHODS.serverGetBackgroundPolicy]: (_input) => backgroundPolicy.snapshot,
        [WS_METHODS.cloudGetRelayClientStatus]: (_input) => relayClient.resolve,
        [WS_METHODS.cloudInstallRelayClient]: (_input) =>
          Stream.callback<RelayClientInstallProgressEvent, RelayClientInstallFailedError>((queue) =>
            relayClient
              .installWithProgress((event) => Queue.offer(queue, event).pipe(Effect.asVoid))
              .pipe(
                Effect.flatMap((status) =>
                  Queue.offer(queue, {
                    type: "complete",
                    status,
                  }),
                ),
                Effect.catchTags({
                  RelayClientInstallError: (error) =>
                    Queue.fail(
                      queue,
                      new RelayClientInstallFailedError({
                        reason: error.reason,
                        message: error.message,
                      }),
                    ),
                }),
                Effect.andThen(Queue.end(queue)),
                Effect.forkScoped,
              ),
          ),
        [WS_METHODS.sourceControlLookupRepository]: (input) =>
          sourceControlRepositories.lookupRepository(input),
        [WS_METHODS.sourceControlCloneRepository]: (input) =>
          admit(
            WS_METHODS.sourceControlCloneRepository,
            sourceControlRepositories.cloneRepository(input),
          ),
        [WS_METHODS.projectCloneStart]: () =>
          admit(WS_METHODS.projectCloneStart, Effect.fail(engineMoved())),
        [WS_METHODS.projectCloneCancel]: (input) =>
          admit(
            WS_METHODS.projectCloneCancel,
            projectCloneTracker
              .cancel(input.projectId)
              .pipe(Effect.map((applied) => ({ applied }))),
          ),
        [WS_METHODS.projectCloneRetry]: (input) =>
          admit(
            WS_METHODS.projectCloneRetry,
            projectCloneTracker.retry(input.projectId).pipe(Effect.map((applied) => ({ applied }))),
          ),
        [WS_METHODS.subscribeProjectClones]: () => projectCloneTracker.stream,
        [WS_METHODS.sourceControlPublishRepository]: (input) =>
          admit(
            WS_METHODS.sourceControlPublishRepository,
            sourceControlRepositories.publishRepository(input).pipe(
              // A new remote can change the cached identity. Only the `cwd` entry
              // refreshes, so after a publish from a linked worktree the project
              // root entry waits for its TTL.
              Effect.tap(() => repositoryIdentityResolver.resolve(input.cwd, { refresh: true })),
              Effect.tap(() => refreshGitStatus(input.cwd)),
            ),
          ),
        [WS_METHODS.projectsSearchEntries]: (input) =>
          workspaceEntries.search(input).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectSearchEntriesError({
                  cwd: input.cwd,
                  queryLength: input.query.length,
                  limit: input.limit,
                  ...projectEntriesFailureContext(cause),
                  cause,
                }),
            ),
          ),
        [WS_METHODS.projectsSearchContents]: (input) =>
          workspaceEntries.searchContents(input).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectSearchContentsError({
                  cwd: input.cwd,
                  queryLength: input.query.length,
                  limit: input.limit,
                  ...projectEntriesFailureContext(cause),
                  cause,
                }),
            ),
          ),
        [WS_METHODS.projectsListEntries]: (input) =>
          workspaceEntries.list(input).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectListEntriesError({
                  ...input,
                  ...projectEntriesFailureContext(cause),
                  cause,
                }),
            ),
          ),
        [WS_METHODS.projectsReadFile]: (input) =>
          workspaceFileSystem.readFile(input).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectReadFileError({
                  ...input,
                  ...projectFileFailureContext(cause),
                  cause,
                }),
            ),
          ),
        [WS_METHODS.threadsFileWrites]: (input) =>
          withThreadFileWrites((service) => service.fileWrites(input)),
        [WS_METHODS.threadsWrittenFile]: (input) =>
          withThreadFileWrites((service) => service.writtenFile(input)),
        [WS_METHODS.projectsWriteFile]: (input) =>
          admit(
            WS_METHODS.projectsWriteFile,
            workspaceFileSystem.writeFile(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectWriteFileError({
                    cwd: input.cwd,
                    relativePath: input.relativePath,
                    ...projectFileFailureContext(cause),
                    cause,
                  }),
              ),
            ),
          ),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          admit(WS_METHODS.shellOpenInEditor, externalLauncher.launchEditor(input)),
        [WS_METHODS.filesystemBrowse]: (input) =>
          workspaceEntries.browse(input).pipe(
            Effect.mapError(
              (cause) =>
                new FilesystemBrowseError({
                  ...input,
                  ...filesystemBrowseFailureContext(cause),
                  cause,
                }),
            ),
          ),
        [WS_METHODS.attachmentsCreateUploadUrl]: (input) =>
          admit(WS_METHODS.attachmentsCreateUploadUrl, issueAttachmentUploadUrl(input)),
        [WS_METHODS.attachmentsDelete]: (input) =>
          admit(WS_METHODS.attachmentsDelete, deletePendingAttachment(input.attachmentId)),
        [WS_METHODS.assetsCreateUrl]: (input) =>
          Effect.gen(function* () {
            if (input.resource._tag === "attachment") {
              const image =
                input.imageMode === "reference"
                  ? yield* resolveImageAsset(input).pipe(
                      Effect.mapError(
                        (cause) =>
                          new AssetImageAccessError({
                            code:
                              "code" in cause &&
                              typeof cause.code === "string" &&
                              [
                                "source-missing",
                                "source-changed",
                                "storage-full",
                                "object-missing",
                                "unsupported",
                                "persistence-failed",
                                "preview-unavailable",
                              ].includes(cause.code)
                                ? (cause.code as AssetImageAccessError["code"])
                                : "persistence-failed",
                            status:
                              "code" in cause && cause.code === "storage-full"
                                ? 507
                                : "code" in cause && cause.code === "object-missing"
                                  ? 404
                                  : 422,
                          }),
                      ),
                    )
                  : null;
              return image ?? (yield* issueAssetUrl({ resource: input.resource }));
            }
            if (input.resource._tag === "project-favicon") {
              const project = yield* projectionSnapshotQuery
                .getActiveProjectByWorkspaceRoot(input.resource.cwd)
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new AssetWorkspaceContextResolutionError({
                        resource: input.resource,
                        cause,
                      }),
                  ),
                );
              if (Option.isNone(project)) {
                return yield* new AssetWorkspaceContextNotFoundError({
                  resource: input.resource,
                });
              }
              // A cloned project exists before its files do. Clients ask again
              // when the clone lands.
              const clone = yield* projectCloneTracker.get(project.value.id);
              const projectCheckoutPending =
                clone !== null &&
                clone.phase !== "done" &&
                clone.destinationPath === project.value.workspaceRoot;
              const image =
                input.imageMode === "reference"
                  ? yield* resolveImageAsset({
                      ...input,
                      projectId: project.value.id,
                      projectCheckoutPending,
                      ...(project.value.faviconPath
                        ? { projectFaviconPath: project.value.faviconPath }
                        : {}),
                    }).pipe(
                      Effect.mapError(
                        (cause) =>
                          new AssetImageAccessError({
                            code:
                              "code" in cause &&
                              typeof cause.code === "string" &&
                              [
                                "source-missing",
                                "source-changed",
                                "storage-full",
                                "object-missing",
                                "unsupported",
                                "persistence-failed",
                                "preview-unavailable",
                              ].includes(cause.code)
                                ? (cause.code as AssetImageAccessError["code"])
                                : "persistence-failed",
                            status:
                              "code" in cause && cause.code === "storage-full"
                                ? 507
                                : "code" in cause && cause.code === "object-missing"
                                  ? 404
                                  : 422,
                          }),
                      ),
                    )
                  : null;
              if (image !== null) return image;
              return yield* issueAssetUrl({
                resource: input.resource,
                ...(project.value.faviconPath
                  ? { projectFaviconPath: project.value.faviconPath }
                  : {}),
                projectCheckoutPending,
              });
            }
            const context = yield* resolveAssetContext(input.resource.threadId).pipe(
              Effect.mapError(
                (cause) =>
                  new AssetWorkspaceContextResolutionError({ resource: input.resource, cause }),
              ),
            );
            if (context === undefined) {
              return yield* new AssetWorkspaceContextNotFoundError({ resource: input.resource });
            }
            const image =
              input.imageMode === "reference"
                ? yield* resolveImageAsset({
                    ...input,
                    ...context,
                  }).pipe(
                    Effect.mapError(
                      (cause) =>
                        new AssetImageAccessError({
                          code:
                            "code" in cause &&
                            typeof cause.code === "string" &&
                            [
                              "source-missing",
                              "source-changed",
                              "storage-full",
                              "object-missing",
                              "unsupported",
                              "persistence-failed",
                              "preview-unavailable",
                            ].includes(cause.code)
                              ? (cause.code as AssetImageAccessError["code"])
                              : "persistence-failed",
                          status:
                            "code" in cause && cause.code === "storage-full"
                              ? 507
                              : "code" in cause && cause.code === "object-missing"
                                ? 404
                                : 422,
                        }),
                    ),
                  )
                : null;
            if (image !== null) return image;
            return yield* issueAssetUrl({
              resource: input.resource,
              workspaceRoot: context.workspaceRoot,
            });
          }),
        [WS_METHODS.subscribeVcsStatus]: (input) =>
          vcsStatusBroadcaster.streamStatus(input, {
            automaticRemoteRefreshInterval: automaticGitFetchInterval,
          }),
        [WS_METHODS.vcsRefreshStatus]: (input) => vcsStatusBroadcaster.refreshStatus(input.cwd),
        [WS_METHODS.vcsPull]: (input) =>
          admit(
            WS_METHODS.vcsPull,
            gitWorkflow.pullCurrentBranch(input.cwd).pipe(
              Effect.matchCauseEffect({
                onFailure: (cause) => Effect.failCause(cause),
                onSuccess: (result) =>
                  refreshGitStatus(input.cwd).pipe(Effect.ignore({ log: true }), Effect.as(result)),
              }),
            ),
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
            gitWorkflow
              .runStackedAction(input, {
                actionId: input.actionId,
                progressReporter: {
                  publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                },
              })
              .pipe(
                Effect.matchCauseEffect({
                  onFailure: (cause) => Queue.failCause(queue, cause),
                  onSuccess: () =>
                    refreshGitStatus(input.cwd).pipe(
                      Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                    ),
                }),
              ),
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          admit(WS_METHODS.gitResolvePullRequest, gitWorkflow.resolvePullRequest(input)),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          admit(
            WS_METHODS.gitPreparePullRequestThread,
            gitWorkflow
              .preparePullRequestThread(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          ),
        [WS_METHODS.vcsListRefs]: (input) => gitWorkflow.listRefs(input),
        [WS_METHODS.vcsCreateWorktree]: (input) =>
          admit(
            WS_METHODS.vcsCreateWorktree,
            gitWorkflow.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          ),
        [WS_METHODS.vcsRemoveWorktree]: (input) =>
          admit(
            WS_METHODS.vcsRemoveWorktree,
            gitWorkflow.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          ),
        [WS_METHODS.vcsCreateRef]: (input) =>
          admit(
            WS_METHODS.vcsCreateRef,
            gitWorkflow.createRef(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          ),
        [WS_METHODS.vcsSwitchRef]: (input) =>
          admit(
            WS_METHODS.vcsSwitchRef,
            gitWorkflow.switchRef(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          ),
        [WS_METHODS.vcsInit]: (input) =>
          admit(
            WS_METHODS.vcsInit,
            vcsProvisioning
              .initRepository(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          ),
        [WS_METHODS.reviewGetDiffPreview]: (input) =>
          admit(WS_METHODS.reviewGetDiffPreview, review.getDiffPreview(input)),
        [WS_METHODS.reviewGetDiffFileContents]: (input) =>
          admit(WS_METHODS.reviewGetDiffFileContents, review.getDiffFileContents(input)),
        [WS_METHODS.terminalOpen]: (input) =>
          admit(
            WS_METHODS.terminalOpen,
            terminalManager.open({ ...input, openedBy: currentSessionId }),
          ),
        [WS_METHODS.terminalAttach]: (input) =>
          Stream.callback<TerminalAttachStreamEvent, TerminalError>((queue) =>
            Effect.acquireRelease(
              terminalManager.attachStream({ ...input, openedBy: currentSessionId }, (event) =>
                Queue.offer(queue, event),
              ),
              (unsubscribe) => Effect.sync(unsubscribe),
            ),
          ),
        [WS_METHODS.terminalWrite]: (input) =>
          admit(WS_METHODS.terminalWrite, terminalManager.write(input)),
        [WS_METHODS.terminalResize]: (input) =>
          admit(WS_METHODS.terminalResize, terminalManager.resize(input)),
        [WS_METHODS.terminalClear]: (input) =>
          admit(WS_METHODS.terminalClear, terminalManager.clear(input)),
        [WS_METHODS.terminalRestart]: (input) =>
          admit(
            WS_METHODS.terminalRestart,
            terminalManager.restart({ ...input, openedBy: currentSessionId }),
          ),
        [WS_METHODS.terminalClose]: (input) =>
          admit(WS_METHODS.terminalClose, terminalManager.close(input)),
        [WS_METHODS.subscribeTerminalEvents]: (_input) =>
          Stream.callback<TerminalEvent>((queue) =>
            Effect.acquireRelease(
              terminalManager.subscribe((event) => Queue.offer(queue, event)),
              (unsubscribe) => Effect.sync(unsubscribe),
            ),
          ),
        [WS_METHODS.subscribeTerminalMetadata]: (_input) =>
          Stream.callback<TerminalMetadataStreamEvent>((queue) =>
            Effect.acquireRelease(
              terminalManager.subscribeMetadata((event) => Queue.offer(queue, event)),
              (unsubscribe) => Effect.sync(unsubscribe),
            ),
          ),
        [WS_METHODS.subscribeServerConfig]: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const usageLimitsCommand = input.usageLimitsCommand === true;
              const config = yield* loadServerConfig({ usageLimitsCommand });
              const keybindingsUpdates = keybindings.streamChanges.pipe(
                Stream.map((event) => ({
                  version: 1 as const,
                  type: "keybindingsUpdated" as const,
                  payload: {
                    keybindings: event.keybindings,
                    issues: event.issues,
                  },
                })),
              );
              const providerStatuses = Stream.zipLatestWith(
                // The registry stream carries changes only. Seed it with the current
                // providers so a source refresh that lands before any provider change
                // still pairs up and reaches the client. On Zerops the agents' sign-in
                // flag changes what the picker offers, so its feed drives this too.
                Stream.zipLatestWith(
                  Stream.concat(
                    Stream.fromEffect(providerRegistry.getProviders),
                    providerRegistry.streamChanges,
                  ),
                  Stream.concat(Stream.fromEffect(zeropsAgentAuth.latest), zeropsAgentAuth.changes),
                  (providers, snapshot) =>
                    withoutUnworkableSlashCommands(overlayZeropsAgentAuth(providers, snapshot)),
                ),
                usageLimitSources.streamChanges.pipe(
                  // Quota updates already have their own stream. Republish the model
                  // catalog only when the set of providers offered the command changes.
                  Stream.changesWith(
                    usageLimitsCommand ? sameUsageLimitCommandCoverage : () => true,
                  ),
                ),
                (providers, sources) =>
                  usageLimitsCommand ? withUsageLimitsCommands(providers, sources) : providers,
              ).pipe(
                // Both sides replay their current value, so the first pairing normally
                // repeats the snapshot the client already holds. Compare against that
                // snapshot rather than dropping blindly: a refresh that landed between
                // the snapshot and the subscription still goes out.
                (updates) => Stream.concat(Stream.make(config.providers), updates),
                Stream.changesWith(
                  (previous, next) => JSON.stringify(previous) === JSON.stringify(next),
                ),
                Stream.drop(1),
                Stream.map((providers) => ({
                  version: 1 as const,
                  type: "providerStatuses" as const,
                  payload: { providers },
                })),
                Stream.debounce(Duration.millis(PROVIDER_STATUS_DEBOUNCE_MS)),
              );
              // The only source of reported quota: the stream emits the
              // current set before any change, so the snapshot carrying it too
              // would just send every client the same array twice per connect.
              // Gated on the subscriber's capability flag because an
              // already-shipped client decodes this stream against the old
              // event union and its whole config subscription dies on an
              // unknown member.
              const usageLimitSourceUpdates =
                input.usageLimitSources === true
                  ? usageLimitSources.streamChanges.pipe(
                      Stream.map((sources) => ({
                        version: 1 as const,
                        type: "usageLimitSourcesUpdated" as const,
                        payload: { sources },
                      })),
                    )
                  : Stream.empty;
              const settingsUpdates = serverSettings.streamChanges.pipe(
                Stream.map((settings) => ServerSettings.redactServerSettingsForClient(settings)),
                Stream.map((settings) => ({
                  version: 1 as const,
                  type: "settingsUpdated" as const,
                  payload: { settings },
                })),
              );

              const mateUpdates =
                input.mateUpdate === true
                  ? zeropsMateUpdate.changes.pipe(
                      Stream.map((update) => ({
                        version: 1 as const,
                        type: "mateUpdate" as const,
                        payload: { update: update ?? null },
                      })),
                    )
                  : Stream.empty;
              const liveUpdates = Stream.merge(
                mateUpdates,
                Stream.merge(
                  keybindingsUpdates,
                  Stream.merge(
                    providerStatuses,
                    Stream.merge(settingsUpdates, usageLimitSourceUpdates),
                  ),
                ),
              );

              return Stream.concat(
                Stream.make({ version: 1 as const, type: "snapshot" as const, config }),
                liveUpdates,
              );
            }),
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const snapshot = yield* lifecycleEvents.snapshot;
              const snapshotEvents = Array.from(snapshot.events).toSorted(
                (left, right) => left.sequence - right.sequence,
              );
              const liveEvents = lifecycleEvents.stream.pipe(
                Stream.filter((event) => event.sequence > snapshot.sequence),
              );
              return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
            }),
          ),
        [WS_METHODS.subscribeAuthAccess]: (_input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const initialSnapshot = yield* loadAuthAccessSnapshot();
              const revisionRef = yield* Ref.make(1);
              const accessChanges: Stream.Stream<
                PairingGrantStore.BootstrapCredentialChange | SessionStore.SessionCredentialChange
              > = Stream.merge(
                Option.isSome(bootstrapCredentials)
                  ? bootstrapCredentials.value.streamChanges
                  : Stream.empty,
                Option.isSome(sessions) ? sessions.value.streamChanges : Stream.empty,
              );

              const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
                Stream.mapEffect((change) =>
                  Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                    Effect.map((revision) =>
                      toAuthAccessStreamEvent(change, revision, currentSessionId),
                    ),
                  ),
                ),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  revision: 1,
                  type: "snapshot" as const,
                  payload: initialSnapshot,
                }),
                liveEvents,
              );
            }),
          ),
        [WS_METHODS.subscribeBackgroundPolicy]: (_input) =>
          Stream.unwrap(
            Effect.map(backgroundPolicy.subscribe, ({ latest, changes }) =>
              Stream.concat(Stream.make(latest), changes),
            ),
          ),
        [WS_METHODS.subscribeResourceTelemetry]: (_input) =>
          Stream.unwrap(
            Effect.map(resourceTelemetry.subscribe, ({ latest, changes }) =>
              Stream.concat(Stream.make(latest), changes),
            ),
          ),
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
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const config = yield* ServerConfig.ServerConfig;
    if (!isAllowedWebSocketOrigin(config, request.headers.origin)) {
      return HttpServerResponse.text("Forbidden origin", { status: 403 });
    }
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
        subject: `${ZEROPS_SUBJECT_PREFIX}${admitted.value.userId}`,
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
    // Asked on every acting call: HQ may name another owner while the socket stays open.
    const hqLink = Option.getOrUndefined(yield* Effect.serviceOption(ZeropsHqLink));
    const readsAlong =
      hqLink === undefined
        ? Effect.succeed(false)
        : Effect.map(hqLink.standing, (standing) => readsAlongOnly(standing, session.subject));
    const rpcWebSocketHttpEffect = yield* Effect.gen(function* () {
      const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
      // Terminal output streams run ahead of the client's acks inside a small
      // window, so each chunk no longer costs a round trip.
      yield* RpcServer.make(WsRpcGroup, WS_RPC_SERVER_OPTIONS).pipe(
        Effect.provideService(RpcServer.Protocol, withTerminalOutputWindow(protocol)),
        Effect.provide(
          Layer.merge(
            rpcScopeAuthorizationLayer(currentScopes, readsAlong),
            rpcInstrumentationLayer,
          ),
        ),
        Effect.forkScoped,
      );
      // @effect-diagnostics-next-line returnEffectInGen:off
      return httpEffect;
    }).pipe(
      Effect.provide(
        makeWsRpcLayer(session).pipe(
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

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
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  AuthSessionId,
  AuthZeropsClientScopes,
  ClientSurface,
  EnvironmentAuthorizationError,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationClientOrigin,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetSnapshotError,
  OrchestrationSearchThreadsError,
  type OrchestrationShellStreamEvent,
  type OrchestrationShellStreamItem,
  ProjectId,
  RpcClientId,
  type ServerProvider,
  SessionSubject,
  ThreadId,
  WS_METHODS,
  WsRpcGroup,
  zeropsSubjectOf,
} from "@t3tools/contracts";
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
import { ProviderInstanceRegistry } from "./provider/Services/ProviderInstanceRegistry.ts";
import { authAccessStream } from "./auth/accessStream.ts";
import { registerServerRpc } from "./registerServerRpc.ts";
import { makeServerConfigFeed } from "./serverConfigFeed.ts";
import { registerProviderRpc } from "./registerProviderRpc.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerSettings from "./serverSettings.ts";
import { registerTerminalRpc } from "./terminal/registerTerminalRpc.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import { terminalOutputWindows } from "./terminal/OutputProtocol.ts";
import { registerWorkspaceRpc } from "./workspace/registerWorkspaceRpc.ts";
import * as WorkspaceEntries from "./workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./workspace/WorkspaceFileSystem.ts";
import { readWorkflowScript } from "./orchestration/workflowScriptQuery.ts";
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
      const providerInstances = yield* ProviderInstanceRegistry;
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
                  WS_METHODS.projectCloneCancel,
                  ORCHESTRATION_WS_METHODS.dispatchCommand,
                  WS_METHODS.engineAnswer,
                  WS_METHODS.engineDismiss,
                  WS_METHODS.engineStop,
                  WS_METHODS.terminalWrite,
                  WS_METHODS.terminalClose,
                  WS_METHODS.zeropsAgentLoginCancel,
                  WS_METHODS.zeropsAgentLoginSubmitCode,
                ].some((candidate) => candidate === method),
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

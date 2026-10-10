import { MateHealth } from "./mateHealth.ts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ExecutionEnvironmentUpdate } from "./environment.ts";
import {
  ProviderAuthCancelInput,
  ProviderAuthCompleteInput,
  ProviderAuthState,
  ProviderAuthStartInput,
  ProviderAuthRespondInput,
  ProviderInstallCancelInput,
  ProviderInstallState,
  ProviderSetupError,
  ProviderSetupInput,
} from "./providerSetup.ts";

import { ExternalLauncherError, LaunchEditorInput } from "./editor.ts";
import {
  EngineAnswerInput,
  EngineDismissInput,
  EngineCallResult,
  EngineConversationFrame,
  EngineDetail,
  EnginePage,
  EngineReadDetailInput,
  EngineReadEarlierInput,
  EngineReadRunInput,
  EngineReceiptInput,
  EngineReceiptResult,
  EngineRowsFrame,
  EngineSendInput,
  EngineSteerInput,
  EngineSwitchModelInput,
  EngineSetArchivedInput,
  EngineSetRuntimeModeInput,
  EngineAssignAgentInput,
  EngineStopInput,
  EngineContinueInput,
  EngineSubscribeInput,
  EngineSubscribeRowsInput,
  EngineWireError,
} from "./engineWire.ts";
import {
  AuthAccessStreamError,
  AuthAccessStreamEvent,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import {
  BackgroundPolicySnapshot,
  ClientActivityReportInput,
  HostPowerSnapshot,
} from "./background.ts";
import {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemBrowseError,
} from "./filesystem.ts";
import {
  AssetAccessError,
  AssetCreateUrlInput,
  AssetCreateUrlResult,
  AttachmentCreateUploadUrlInput,
  AttachmentCreateUploadUrlResult,
  AttachmentDeleteInput,
  AttachmentUploadSigningKeyError,
} from "./assets.ts";
import {
  GitActionProgressEvent,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  GitCommandError,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  VcsPullInput,
  GitPullRequestRefInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  VcsStatusInput,
  VcsStatusSubscriptionInput,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "./git.ts";
import {
  ReviewDiffFileContentsInput,
  ReviewDiffFileContentsResult,
  ReviewDiffPreviewError,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
} from "./review.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationSearchThreadsError,
  OrchestrationSearchThreadsInput,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationRpcSchemas,
  OrchestrationGetWorkflowScriptError,
} from "./orchestration.ts";
import {
  ProviderUploadFeedbackError,
  ProviderUploadFeedbackInput,
  ProviderUploadFeedbackResult,
} from "./provider.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  RelayClientInstallFailedError,
  RelayClientInstallProgressEventSchema,
  RelayClientStatusSchema,
} from "./relayClient.ts";
import {
  ProjectListEntriesError,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchContentsError,
  ProjectSearchContentsInput,
  ProjectSearchContentsResult,
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import {
  TerminalAttachInput,
  TerminalAttachStreamEvent,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalMetadataStreamEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerLifecycleStreamEvent,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerProviderUpdatedPayload,
  ServerSelfUpdateError,
  ServerSelfUpdateInput,
  ServerSelfUpdateProgressEvent,
  ServerSelfUpdateResult,
  ServerTraceDiagnosticsResult,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import {
  ResourceTelemetryHistory,
  ResourceTelemetryHistoryInput,
  ResourceTelemetryHistoryReadFailed,
  ResourceTelemetryRetryResult,
  ResourceTelemetrySnapshot,
} from "./resourceTelemetry.ts";
import {
  ZeropsAgentAuthSnapshot,
  ZeropsAgentLoginCancelInput,
  ZeropsAgentLoginError,
  ZeropsAgentLoginStartInput,
  ZeropsAgentLoginStartResult,
  ZeropsAgentLoginSubmitCodeInput,
  ZeropsAgentSignOutInput,
  ZeropsLoginAddInput,
  ZeropsLoginAddResult,
  ZeropsLoginRemoveInput,
  ZeropsBrowserInput,
  ZeropsBrowserStreamEvent,
  ZeropsDataConsoleError,
  ZeropsDataConsoleRequest,
  ZeropsDataConsoleResponse,
  ZeropsDataConsoleSessionEvent,
  ZeropsGitRemoteProbeError,
  ZeropsGitRemoteProbeInput,
  ZeropsGitRemoteProbeResult,
  ZeropsLifecycle,
  ZeropsLifecycleGetInput,
  ZeropsMateUpdateError,
  ZeropsMateUpdateResult,
} from "./zerops.ts";
import { MateAttention } from "./zeropsAttention.ts";
import {
  CrewCommand,
  CrewCommandError,
  CrewCommandResult,
  CrewFeedFrame,
  CrewFiles,
  CrewTaskPage,
  CrewTaskPageInput,
} from "./zeropsCrew.ts";
import {
  UsageLimitSourceError,
  ProviderConsumeResetCreditInput,
  ProviderConsumeResetCreditResult,
} from "./providerUsageLimits.ts";
import {
  McpServerAddInput,
  McpServerSetEnabledInput,
  McpServersError,
  McpServersList,
  McpServersListInput,
  McpServerTargetInput,
} from "./mcpServers.ts";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings.ts";
import {
  ProjectCloneActionInput,
  ProjectCloneActionResult,
  ProjectCloneListEvent,
  ProjectCloneStartInput,
  ProjectCloneStartResult,
  ProjectCloneSubscribeInput,
} from "./projectClone.ts";
import {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryError,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl.ts";
import { ExecError, ExecRunInput, ExecRunResult } from "./exec.ts";
import { VcsError } from "./vcs.ts";
import {
  ThreadFileWritesError,
  ThreadFileWritesInput,
  ThreadFileWritesResult,
  ThreadWrittenFileInput,
  ThreadWrittenFileResult,
} from "./threadFileWrites.ts";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsListEntries: "projects.listEntries",
  projectsReadFile: "projects.readFile",
  projectsSearchContents: "projects.searchContents",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Filesystem methods
  filesystemBrowse: "filesystem.browse",
  assetsCreateUrl: "assets.createUrl",
  attachmentsCreateUploadUrl: "attachments.createUploadUrl",
  attachmentsDelete: "attachments.delete",

  // MCP servers (the MCP tab)
  mcpServersList: "mcp.servers.list",
  mcpServersAdd: "mcp.servers.add",
  mcpServersRemove: "mcp.servers.remove",
  mcpServersSetEnabled: "mcp.servers.setEnabled",
  mcpServersReconnect: "mcp.servers.reconnect",

  // Provider methods
  providerUploadFeedback: "provider.uploadFeedback",
  providerAuthStart: "provider.auth.start",
  providerConsumeResetCredit: "provider.consumeResetCredit",
  providerAuthComplete: "provider.auth.complete",
  providerAuthRespond: "provider.auth.respond",
  providerAuthCancel: "provider.auth.cancel",
  providerAuthLogout: "provider.auth.logout",
  providerAuthSubscribe: "provider.auth.subscribe",
  providerInstallStart: "provider.install.start",
  providerInstallCancel: "provider.install.cancel",
  providerInstallSubscribe: "provider.install.subscribe",
  providerInstallRemove: "provider.install.remove",

  // VCS methods
  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsListRefs: "vcs.listRefs",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",

  // Git workflow methods
  gitRunStackedAction: "git.runStackedAction",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Review methods
  reviewGetDiffPreview: "review.getDiffPreview",
  reviewGetDiffFileContents: "review.getDiffFileContents",

  // Exec methods
  execRun: "exec.run",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalAttach: "terminal.attach",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverProbe: "server.probe",
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateProvider: "server.updateProvider",
  // Retained only for clients shipped at v0.1.0, before self-update was removed. No
  // capability advertises these methods and no current client path calls them. Remove
  // after one release cycle, once no released client offers the update action.
  serverUpdateServer: "server.updateServer",
  serverUpdateServerWithProgress: "server.updateServerWithProgress",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverGetResourceTelemetryHistory: "server.getResourceTelemetryHistory",
  serverRetryResourceTelemetry: "server.retryResourceTelemetry",
  serverSignalProcess: "server.signalProcess",
  serverReportClientActivity: "server.reportClientActivity",
  serverReportHostPowerState: "server.reportHostPowerState",
  serverGetBackgroundPolicy: "server.getBackgroundPolicy",

  // Cloud environment methods
  cloudGetRelayClientStatus: "cloud.getRelayClientStatus",
  cloudInstallRelayClient: "cloud.installRelayClient",

  // Source control methods
  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",
  projectCloneStart: "projectClone.start",
  projectCloneCancel: "projectClone.cancel",
  projectCloneRetry: "projectClone.retry",
  subscribeProjectClones: "subscribeProjectClones",

  // Zerops feeds
  zeropsLifecycleGet: "zerops.lifecycle.get",
  zeropsStandUpRetry: "zerops.standUp.retry",
  zeropsAgentLoginStart: "zerops.agentLogin.start",
  zeropsAgentAuthCheck: "zerops.agentAuth.check",
  zeropsAgentLoginCancel: "zerops.agentLogin.cancel",
  zeropsAgentLoginSubmitCode: "zerops.agentLogin.submitCode",
  zeropsAgentLoginSignOut: "zerops.agentLogin.signOut",
  zeropsLoginAdd: "zerops.login.add",
  zeropsLoginRemove: "zerops.login.remove",
  zeropsBrowserInput: "zerops.browser.input",
  zeropsMateUpdate: "zerops.mate.update",
  zeropsMateCheckUpdate: "zerops.mate.checkUpdate",
  zeropsDataConsoleCall: "zerops.dataConsole.call",
  zeropsGitProbeRemote: "zerops.git.probeRemote",
  zeropsCrewFilesGet: "zerops.crew.files.get",
  zeropsCrewFilesPut: "zerops.crew.files.put",
  zeropsCrewCommand: "zerops.crew.command",
  zeropsCrewTaskPage: "zerops.crew.taskPage",
  threadsFileWrites: "threads.fileWrites",
  threadsWrittenFile: "threads.writtenFile",
  engineGetArchivedShellSnapshot: "engine.getArchivedShellSnapshot",
  engineReadEarlier: "engine.readEarlier",
  engineReadRun: "engine.readRun",
  engineReadDetail: "engine.readDetail",
  engineReceipt: "engine.receipt",
  engineSend: "engine.send",
  engineStop: "engine.stop",
  engineContinue: "engine.continue",
  engineAnswer: "engine.answer",
  engineDismiss: "engine.dismiss",
  engineSteer: "engine.steer",
  engineSwitchModel: "engine.switchModel",
  engineSetArchived: "engine.setArchived",
  engineSetRuntimeMode: "engine.setRuntimeMode",
  engineAssignAgent: "engine.assignAgent",

  // Streaming subscriptions
  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeTerminalMetadata: "subscribeTerminalMetadata",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
  subscribeBackgroundPolicy: "subscribeBackgroundPolicy",
  subscribeResourceTelemetry: "subscribeResourceTelemetry",
  subscribeZeropsLifecycle: "subscribeZeropsLifecycle",
  subscribeZeropsAgentAuth: "subscribeZeropsAgentAuth",
  subscribeZeropsHealth: "subscribeZeropsHealth",
  subscribeZeropsAttention: "subscribeZeropsAttention",
  subscribeZeropsBrowserStream: "subscribeZeropsBrowserStream",
  subscribeZeropsDataConsole: "subscribeZeropsDataConsole",
  subscribeZeropsCrew: "subscribeZeropsCrew",
  subscribeEngineConversation: "subscribeEngineConversation",
  subscribeEngineRows: "subscribeEngineRows",
} as const;

const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

const WsServerRemoveKeybindingRpc = Rpc.make(WS_METHODS.serverRemoveKeybinding, {
  payload: ServerRemoveKeybindingInput,
  success: ServerRemoveKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

const WsExecRunRpc = Rpc.make(WS_METHODS.execRun, {
  payload: ExecRunInput,
  success: ExecRunResult,
  error: Schema.Union([ExecError, EnvironmentAuthorizationError]),
});

const WsServerProbeRpc = Rpc.make(WS_METHODS.serverProbe, {
  payload: Schema.Struct({}),
  success: Schema.Struct({}),
  error: EnvironmentAuthorizationError,
});

const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
});

const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    /**
     * When supplied, only refresh this specific provider instance. When
     * omitted, refresh all configured instances — the legacy `refresh()`
     * behaviour retained for transports that still dispatch untargeted
     * refreshes.
     */
    instanceId: Schema.optional(ProviderInstanceId),
    cwd: Schema.optional(TrimmedNonEmptyString),
    /** With `instanceId` and `cwd`: rescan the workspace's skills and slash
     * commands even when a snapshot for that cwd already exists. */
    fresh: Schema.optional(Schema.Boolean),
    /** Explicit user request: bypass T3-owned caches and rediscover models.
     * Background status refreshes must not open agent sessions. */
    refreshModels: Schema.optional(Schema.Boolean),
  }),
  success: ServerProviderUpdatedPayload,
  error: Schema.Union([EnvironmentAuthorizationError, ProviderSetupError]),
});

const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdatedPayload,
  error: Schema.Union([ServerProviderUpdateError, EnvironmentAuthorizationError]),
});

const ProviderSetupRpcError = Schema.Union([ProviderSetupError, EnvironmentAuthorizationError]);

const WsProviderConsumeResetCreditRpc = Rpc.make(WS_METHODS.providerConsumeResetCredit, {
  payload: ProviderConsumeResetCreditInput,
  success: ProviderConsumeResetCreditResult,
  error: Schema.Union([ProviderSetupError, UsageLimitSourceError, EnvironmentAuthorizationError]),
});

const WsProviderAuthStartRpc = Rpc.make(WS_METHODS.providerAuthStart, {
  payload: ProviderAuthStartInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthRespondRpc = Rpc.make(WS_METHODS.providerAuthRespond, {
  payload: ProviderAuthRespondInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthCompleteRpc = Rpc.make(WS_METHODS.providerAuthComplete, {
  payload: ProviderAuthCompleteInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthCancelRpc = Rpc.make(WS_METHODS.providerAuthCancel, {
  payload: ProviderAuthCancelInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthLogoutRpc = Rpc.make(WS_METHODS.providerAuthLogout, {
  payload: ProviderSetupInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthSubscribeRpc = Rpc.make(WS_METHODS.providerAuthSubscribe, {
  payload: ProviderSetupInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
  stream: true,
});

const WsProviderInstallStartRpc = Rpc.make(WS_METHODS.providerInstallStart, {
  payload: ProviderSetupInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
});

const WsProviderInstallCancelRpc = Rpc.make(WS_METHODS.providerInstallCancel, {
  payload: ProviderInstallCancelInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
});

const WsProviderInstallSubscribeRpc = Rpc.make(WS_METHODS.providerInstallSubscribe, {
  payload: ProviderSetupInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
  stream: true,
});

const WsProviderInstallRemoveRpc = Rpc.make(WS_METHODS.providerInstallRemove, {
  payload: ProviderSetupInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
});

const WsServerUpdateServerRpc = Rpc.make(WS_METHODS.serverUpdateServer, {
  payload: ServerSelfUpdateInput,
  success: ServerSelfUpdateResult,
  error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
});

const WsServerUpdateServerWithProgressRpc = Rpc.make(WS_METHODS.serverUpdateServerWithProgress, {
  payload: ServerSelfUpdateInput,
  success: ServerSelfUpdateProgressEvent,
  error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

const WsServerDiscoverSourceControlRpc = Rpc.make(WS_METHODS.serverDiscoverSourceControl, {
  payload: Schema.Struct({}),
  success: SourceControlDiscoveryResult,
  error: EnvironmentAuthorizationError,
});

const WsServerGetTraceDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetTraceDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerTraceDiagnosticsResult,
  error: EnvironmentAuthorizationError,
});

const WsServerGetProcessDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetProcessDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerProcessDiagnosticsResult,
  error: EnvironmentAuthorizationError,
});

const WsServerGetProcessResourceHistoryRpc = Rpc.make(WS_METHODS.serverGetProcessResourceHistory, {
  payload: ServerProcessResourceHistoryInput,
  success: ServerProcessResourceHistoryResult,
  error: Schema.Union([EnvironmentAuthorizationError, ResourceTelemetryHistoryReadFailed]),
});

const WsServerGetResourceTelemetryHistoryRpc = Rpc.make(
  WS_METHODS.serverGetResourceTelemetryHistory,
  {
    payload: ResourceTelemetryHistoryInput,
    success: ResourceTelemetryHistory,
    error: Schema.Union([EnvironmentAuthorizationError, ResourceTelemetryHistoryReadFailed]),
  },
);

const WsServerRetryResourceTelemetryRpc = Rpc.make(WS_METHODS.serverRetryResourceTelemetry, {
  payload: Schema.Struct({}),
  success: ResourceTelemetryRetryResult,
  error: EnvironmentAuthorizationError,
});

const WsServerSignalProcessRpc = Rpc.make(WS_METHODS.serverSignalProcess, {
  payload: ServerSignalProcessInput,
  success: ServerSignalProcessResult,
  error: EnvironmentAuthorizationError,
});

const WsCloudGetRelayClientStatusRpc = Rpc.make(WS_METHODS.cloudGetRelayClientStatus, {
  payload: Schema.Struct({}),
  success: RelayClientStatusSchema,
  error: EnvironmentAuthorizationError,
});

const WsCloudInstallRelayClientRpc = Rpc.make(WS_METHODS.cloudInstallRelayClient, {
  payload: Schema.Struct({}),
  success: RelayClientInstallProgressEventSchema,
  error: Schema.Union([RelayClientInstallFailedError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsServerReportClientActivityRpc = Rpc.make(WS_METHODS.serverReportClientActivity, {
  payload: ClientActivityReportInput,
  error: EnvironmentAuthorizationError,
});

const WsServerReportHostPowerStateRpc = Rpc.make(WS_METHODS.serverReportHostPowerState, {
  payload: HostPowerSnapshot,
  error: EnvironmentAuthorizationError,
});

const WsServerGetBackgroundPolicyRpc = Rpc.make(WS_METHODS.serverGetBackgroundPolicy, {
  payload: Schema.Struct({}),
  success: BackgroundPolicySnapshot,
  error: EnvironmentAuthorizationError,
});

const WsSourceControlLookupRepositoryRpc = Rpc.make(WS_METHODS.sourceControlLookupRepository, {
  payload: SourceControlRepositoryLookupInput,
  success: SourceControlRepositoryInfo,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

const WsSourceControlCloneRepositoryRpc = Rpc.make(WS_METHODS.sourceControlCloneRepository, {
  payload: SourceControlCloneRepositoryInput,
  success: SourceControlCloneRepositoryResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

// Clone-backed project creation. `start` returns once the project exists and
// the clone is running; progress arrives on the subscription.
const WsProjectCloneStartRpc = Rpc.make(WS_METHODS.projectCloneStart, {
  payload: ProjectCloneStartInput,
  success: ProjectCloneStartResult,
  error: Schema.Union([
    SourceControlRepositoryError,
    OrchestrationDispatchCommandError,
    EnvironmentAuthorizationError,
  ]),
});

const WsProjectCloneCancelRpc = Rpc.make(WS_METHODS.projectCloneCancel, {
  payload: ProjectCloneActionInput,
  success: ProjectCloneActionResult,
  error: EnvironmentAuthorizationError,
});

const WsProjectCloneRetryRpc = Rpc.make(WS_METHODS.projectCloneRetry, {
  payload: ProjectCloneActionInput,
  success: ProjectCloneActionResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

const WsSubscribeProjectClonesRpc = Rpc.make(WS_METHODS.subscribeProjectClones, {
  payload: ProjectCloneSubscribeInput,
  success: ProjectCloneListEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSourceControlPublishRepositoryRpc = Rpc.make(WS_METHODS.sourceControlPublishRepository, {
  payload: SourceControlPublishRepositoryInput,
  success: SourceControlPublishRepositoryResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: Schema.Union([ProjectSearchEntriesError, EnvironmentAuthorizationError]),
});

const WsProjectsSearchContentsRpc = Rpc.make(WS_METHODS.projectsSearchContents, {
  payload: ProjectSearchContentsInput,
  success: ProjectSearchContentsResult,
  error: Schema.Union([ProjectSearchContentsError, EnvironmentAuthorizationError]),
});

const WsProjectsListEntriesRpc = Rpc.make(WS_METHODS.projectsListEntries, {
  payload: ProjectListEntriesInput,
  success: ProjectListEntriesResult,
  error: Schema.Union([ProjectListEntriesError, EnvironmentAuthorizationError]),
});

const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: Schema.Union([ProjectReadFileError, EnvironmentAuthorizationError]),
});

const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: Schema.Union([ProjectWriteFileError, EnvironmentAuthorizationError]),
});

const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: LaunchEditorInput,
  error: Schema.Union([ExternalLauncherError, EnvironmentAuthorizationError]),
});

const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: Schema.Union([FilesystemBrowseError, EnvironmentAuthorizationError]),
});

const WsAssetsCreateUrlRpc = Rpc.make(WS_METHODS.assetsCreateUrl, {
  payload: AssetCreateUrlInput,
  success: AssetCreateUrlResult,
  error: Schema.Union([AssetAccessError, EnvironmentAuthorizationError]),
});

const WsAttachmentsCreateUploadUrlRpc = Rpc.make(WS_METHODS.attachmentsCreateUploadUrl, {
  payload: AttachmentCreateUploadUrlInput,
  success: AttachmentCreateUploadUrlResult,
  error: Schema.Union([AttachmentUploadSigningKeyError, EnvironmentAuthorizationError]),
});

const WsAttachmentsDeleteRpc = Rpc.make(WS_METHODS.attachmentsDelete, {
  payload: AttachmentDeleteInput,
  error: EnvironmentAuthorizationError,
});

const McpServersRpcError = Schema.Union([McpServersError, EnvironmentAuthorizationError]);

const WsMcpServersListRpc = Rpc.make(WS_METHODS.mcpServersList, {
  payload: McpServersListInput,
  success: McpServersList,
  error: McpServersRpcError,
});

const WsMcpServersAddRpc = Rpc.make(WS_METHODS.mcpServersAdd, {
  payload: McpServerAddInput,
  success: McpServersList,
  error: McpServersRpcError,
});

const WsMcpServersRemoveRpc = Rpc.make(WS_METHODS.mcpServersRemove, {
  payload: McpServerTargetInput,
  success: McpServersList,
  error: McpServersRpcError,
});

const WsMcpServersSetEnabledRpc = Rpc.make(WS_METHODS.mcpServersSetEnabled, {
  payload: McpServerSetEnabledInput,
  success: McpServersList,
  error: McpServersRpcError,
});

const WsMcpServersReconnectRpc = Rpc.make(WS_METHODS.mcpServersReconnect, {
  payload: McpServerTargetInput,
  success: McpServersList,
  error: McpServersRpcError,
});

const WsProviderUploadFeedbackRpc = Rpc.make(WS_METHODS.providerUploadFeedback, {
  payload: ProviderUploadFeedbackInput,
  success: ProviderUploadFeedbackResult,
  error: Schema.Union([ProviderUploadFeedbackError, EnvironmentAuthorizationError]),
});

const WsSubscribeVcsStatusRpc = Rpc.make(WS_METHODS.subscribeVcsStatus, {
  payload: VcsStatusSubscriptionInput,
  success: VcsStatusStreamEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsVcsPullRpc = Rpc.make(WS_METHODS.vcsPull, {
  payload: VcsPullInput,
  success: VcsPullResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsRefreshStatusRpc = Rpc.make(WS_METHODS.vcsRefreshStatus, {
  payload: VcsStatusInput,
  success: VcsStatusResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsVcsListRefsRpc = Rpc.make(WS_METHODS.vcsListRefs, {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsCreateWorktreeRpc = Rpc.make(WS_METHODS.vcsCreateWorktree, {
  payload: VcsCreateWorktreeInput,
  success: VcsCreateWorktreeResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsRemoveWorktreeRpc = Rpc.make(WS_METHODS.vcsRemoveWorktree, {
  payload: VcsRemoveWorktreeInput,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsCreateRefRpc = Rpc.make(WS_METHODS.vcsCreateRef, {
  payload: VcsCreateRefInput,
  success: VcsCreateRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsSwitchRefRpc = Rpc.make(WS_METHODS.vcsSwitchRef, {
  payload: VcsSwitchRefInput,
  success: VcsSwitchRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsInitRpc = Rpc.make(WS_METHODS.vcsInit, {
  payload: VcsInitInput,
  error: Schema.Union([VcsError, EnvironmentAuthorizationError]),
});

/**
 * Ephemeral live diff preview for compact/mobile surfaces.
 * Not the persisted T3 Review model. Future review sessions should use
 * review.open* + review.getSnapshot.
 */
const WsReviewGetDiffPreviewRpc = Rpc.make(WS_METHODS.reviewGetDiffPreview, {
  payload: ReviewDiffPreviewInput,
  success: ReviewDiffPreviewResult,
  error: Schema.Union([ReviewDiffPreviewError, EnvironmentAuthorizationError]),
});

const WsReviewGetDiffFileContentsRpc = Rpc.make(WS_METHODS.reviewGetDiffFileContents, {
  payload: ReviewDiffFileContentsInput,
  success: ReviewDiffFileContentsResult,
  error: Schema.Union([ReviewDiffPreviewError, EnvironmentAuthorizationError]),
});

const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalAttachRpc = Rpc.make(WS_METHODS.terminalAttach, {
  payload: TerminalAttachInput,
  success: TerminalAttachStreamEvent,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsOrchestrationDispatchCommandRpc = Rpc.make(ORCHESTRATION_WS_METHODS.dispatchCommand, {
  payload: ClientOrchestrationCommand,
  success: OrchestrationRpcSchemas.dispatchCommand.output,
  error: Schema.Union([OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
});

const WsOrchestrationGetWorkflowScriptRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getWorkflowScript, {
  payload: OrchestrationRpcSchemas.getWorkflowScript.input,
  success: OrchestrationRpcSchemas.getWorkflowScript.output,
  error: Schema.Union([OrchestrationGetWorkflowScriptError, EnvironmentAuthorizationError]),
});

const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: Schema.Union([OrchestrationGetTurnDiffError, EnvironmentAuthorizationError]),
});

const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getFullThreadDiff, {
  payload: OrchestrationGetFullThreadDiffInput,
  success: OrchestrationRpcSchemas.getFullThreadDiff.output,
  error: Schema.Union([OrchestrationGetFullThreadDiffError, EnvironmentAuthorizationError]),
});

const WsOrchestrationSearchThreadsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.searchThreads, {
  payload: OrchestrationSearchThreadsInput,
  success: OrchestrationRpcSchemas.searchThreads.output,
  error: Schema.Union([OrchestrationSearchThreadsError, EnvironmentAuthorizationError]),
});

const WsEngineGetArchivedShellSnapshotRpc = Rpc.make(WS_METHODS.engineGetArchivedShellSnapshot, {
  payload: Schema.Struct({ protocol: Schema.Int }),
  success: OrchestrationRpcSchemas.getArchivedShellSnapshot.output,
  error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
});

const WsOrchestrationGetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationRpcSchemas.getArchivedShellSnapshot.output,
    error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationRpcSchemas.subscribeShell.output,
  error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsOrchestrationSubscribeThreadRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeThread, {
  payload: OrchestrationRpcSchemas.subscribeThread.input,
  success: OrchestrationRpcSchemas.subscribeThread.output,
  error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSubscribeTerminalMetadataRpc = Rpc.make(WS_METHODS.subscribeTerminalMetadata, {
  payload: Schema.Struct({}),
  success: TerminalMetadataStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({
    /** Whether this client understands `usageLimitSourcesUpdated` events. */
    usageLimitSources: Schema.optional(Schema.Boolean),
    /**
     * Whether this client answers `/usage-limits` itself. The server injects
     * that command into provider catalogs only for such clients; an older
     * client would send it to the provider as an ordinary prompt.
     */
    usageLimitsCommand: Schema.optional(Schema.Boolean),
    /** Opt-in prevents an older client receiving a new event it cannot decode. */
    mateUpdate: Schema.optional(Schema.Boolean),
  }),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  error: Schema.Union([AuthAccessStreamError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsSubscribeBackgroundPolicyRpc = Rpc.make(WS_METHODS.subscribeBackgroundPolicy, {
  payload: Schema.Struct({}),
  success: BackgroundPolicySnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSubscribeResourceTelemetryRpc = Rpc.make(WS_METHODS.subscribeResourceTelemetry, {
  payload: Schema.Struct({}),
  success: ResourceTelemetrySnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

/**
 * One explicit retry of a failed stand-up send, authorized as the authenticated asker. Refused
 * (`OrchestrationDispatchCommandError`) while the Mate engine owns the conversation.
 */
const WsZeropsStandUpRetryRpc = Rpc.make(WS_METHODS.zeropsStandUpRetry, {
  payload: Schema.Struct({}),
  success: Schema.Boolean,
  error: Schema.Union([OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
});

const WsZeropsLifecycleGetRpc = Rpc.make(WS_METHODS.zeropsLifecycleGet, {
  payload: ZeropsLifecycleGetInput,
  success: ZeropsLifecycle,
  error: EnvironmentAuthorizationError,
});

const WsSubscribeZeropsLifecycleRpc = Rpc.make(WS_METHODS.subscribeZeropsLifecycle, {
  payload: ZeropsLifecycleGetInput,
  success: ZeropsLifecycle,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSubscribeZeropsAgentAuthRpc = Rpc.make(WS_METHODS.subscribeZeropsAgentAuth, {
  payload: Schema.Struct({}),
  success: ZeropsAgentAuthSnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

/** The Mate's attention (`MateAttention`) now, then each new revision. */
const WsSubscribeZeropsHealthRpc = Rpc.make(WS_METHODS.subscribeZeropsHealth, {
  payload: Schema.Struct({}),
  success: MateHealth,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSubscribeZeropsAttentionRpc = Rpc.make(WS_METHODS.subscribeZeropsAttention, {
  payload: Schema.Struct({}),
  success: MateAttention,
  error: EnvironmentAuthorizationError,
  stream: true,
});

/**
 * Starts (or, for an agent that already has one running, re-attaches to) a
 * server-driven login session for `agentId` in `threadId`'s dedicated
 * terminal — S7 follow-up F8. Non-streaming: the resulting `login` state
 * rides the existing `subscribeZeropsAgentAuth` feed, not a reply here.
 */
const WsZeropsAgentLoginStartRpc = Rpc.make(WS_METHODS.zeropsAgentLoginStart, {
  payload: ZeropsAgentLoginStartInput,
  success: ZeropsAgentLoginStartResult,
  error: Schema.Union([TerminalError, ZeropsAgentLoginError, EnvironmentAuthorizationError]),
});

/** One operator-requested verification and, if needed, platform registration. */
const WsZeropsAgentAuthCheckRpc = Rpc.make(WS_METHODS.zeropsAgentAuthCheck, {
  payload: ZeropsAgentLoginCancelInput,
  error: Schema.Union([ZeropsAgentLoginError, EnvironmentAuthorizationError]),
});

/** Cancels `agentId`'s active login session, if any: sends Ctrl-C and closes its terminal. */
const WsZeropsAgentLoginCancelRpc = Rpc.make(WS_METHODS.zeropsAgentLoginCancel, {
  payload: ZeropsAgentLoginCancelInput,
  error: Schema.Union([TerminalError, ZeropsAgentLoginError, EnvironmentAuthorizationError]),
});

/**
 * Types an authorization code into `agentId`'s login terminal, the way a
 * person pasting it there would. Accepted only while that login waits for one.
 */
const WsZeropsAgentLoginSubmitCodeRpc = Rpc.make(WS_METHODS.zeropsAgentLoginSubmitCode, {
  payload: ZeropsAgentLoginSubmitCodeInput,
  error: Schema.Union([TerminalError, ZeropsAgentLoginError, EnvironmentAuthorizationError]),
});

/**
 * Signs `agentId` out everywhere this Mate can reach: cancels a running
 * login session, stops its live provider sessions, runs the CLI's own
 * logout, and clears the Zerops platform flag. Refuses a token-authorized
 * agent (`ZeropsAgentLoginError` with `reason: "token-authorized"`) — a
 * project API key is not a person's login to end.
 */
const WsZeropsAgentLoginSignOutRpc = Rpc.make(WS_METHODS.zeropsAgentLoginSignOut, {
  payload: ZeropsAgentSignOutInput,
  error: Schema.Union([ZeropsAgentLoginError, EnvironmentAuthorizationError]),
});

/**
 * *Add another login* (crew mode, PRD §2.3): a further instance of the agent
 * with its own home, signed in afterwards through `zerops.agentLogin.start`
 * with the returned id — or, for Claude, an API key stored for it alone.
 */
const WsZeropsLoginAddRpc = Rpc.make(WS_METHODS.zeropsLoginAdd, {
  payload: ZeropsLoginAddInput,
  success: ZeropsLoginAddResult,
  error: Schema.Union([ZeropsAgentLoginError, EnvironmentAuthorizationError]),
});

/** Signs a non-default login out and forgets it; refuses a default one (`default-login`). */
const WsZeropsLoginRemoveRpc = Rpc.make(WS_METHODS.zeropsLoginRemove, {
  payload: ZeropsLoginRemoveInput,
  error: Schema.Union([ZeropsAgentLoginError, EnvironmentAuthorizationError]),
});

/**
 * The live view of the container's agent-browser daemon (S8b, spec-mate.md
 * §5 Browser surface): frames and connection state, Ack-flow-controlled like
 * every other feed (§5.5). Connects to the daemon on first subscriber,
 * disconnects on last unsubscribe — never persistent.
 */
const WsSubscribeZeropsBrowserStreamRpc = Rpc.make(WS_METHODS.subscribeZeropsBrowserStream, {
  payload: Schema.Struct({ callFrames: Schema.optional(Schema.Boolean) }),
  success: ZeropsBrowserStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

/** One input event (click, move, key) forwarded to whatever page the daemon currently has open. */
const WsZeropsBrowserInputRpc = Rpc.make(WS_METHODS.zeropsBrowserInput, {
  payload: ZeropsBrowserInput,
  error: EnvironmentAuthorizationError,
});

/**
 * Runs `zcp mate update --json` (spec-mate.md §2.9 MU-2): offered only
 * inside a Zerops project with `zcp` on PATH, gated by `exec:operate`. A
 * failing update (zcp ran and reported its own failure) is still a success
 * here — its JSON carries the failure. {@link ZeropsMateUpdateError} covers
 * `zcp` itself not running or not answering; {@link EnvironmentAuthorizationError}
 * covers the RPC not being offered here or the caller lacking the scope —
 * the same pairing upstream's own self-update RPC uses.
 */
const WsZeropsMateUpdateRpc = Rpc.make(WS_METHODS.zeropsMateUpdate, {
  payload: Schema.Struct({}),
  success: ZeropsMateUpdateResult,
  error: Schema.Union([ZeropsMateUpdateError, EnvironmentAuthorizationError]),
});

/**
 * Re-reads the release manifest now (spec-mate.md §2.9 step 2, "on demand")
 * instead of waiting for the server's hourly `zcp mate status` cycle. The
 * descriptor's `update` field, delivered on request — MU-1 still holds: the
 * client never compares versions, it only reads what this returns. `null`
 * means the check ran and found nothing to report (MU-3), never fabricated.
 */
const WsZeropsMateCheckUpdateRpc = Rpc.make(WS_METHODS.zeropsMateCheckUpdate, {
  payload: Schema.Struct({}),
  success: Schema.NullOr(ExecutionEnvironmentUpdate),
  error: Schema.Union([ZeropsMateUpdateError, EnvironmentAuthorizationError]),
});

/**
 * One allowlisted Data Console request/response, brokered by the mate server
 * to the container-local `zcp studio console serve` process — spawned on
 * first use, never talked to directly by the client (spec-dataconsole.md
 * §4.3). Read-only in this slice: every request `kind` maps to a
 * non-mutating console route.
 */
const WsZeropsDataConsoleCallRpc = Rpc.make(WS_METHODS.zeropsDataConsoleCall, {
  payload: ZeropsDataConsoleRequest,
  success: ZeropsDataConsoleResponse,
  error: Schema.Union([EnvironmentAuthorizationError, ZeropsDataConsoleError]),
});

/**
 * `git ls-remote` against one checkout's remote, run now (guide 4.5).
 *
 * A read, and the only party that can answer it: the checkout lives in the dev
 * container and its credential helper lives beside it, so neither the browser
 * nor the remote's host can say whether this Mate can actually reach it. The Git
 * tab asks it rather than inferring health from a remote being configured.
 */
const WsZeropsGitProbeRemoteRpc = Rpc.make(WS_METHODS.zeropsGitProbeRemote, {
  payload: ZeropsGitRemoteProbeInput,
  success: ZeropsGitRemoteProbeResult,
  error: Schema.Union([ZeropsGitRemoteProbeError, EnvironmentAuthorizationError]),
});

/** What a thread's write or edit calls wrote, from their stored payloads (`threadFileWrites.ts`). */
const WsThreadsFileWritesRpc = Rpc.make(WS_METHODS.threadsFileWrites, {
  payload: ThreadFileWritesInput,
  success: ThreadFileWritesResult,
  error: Schema.Union([ThreadFileWritesError, EnvironmentAuthorizationError]),
});

/** What this thread's agent wrote in a file outside the workspace, from its record (`threadFileWrites.ts`). */
const WsThreadsWrittenFileRpc = Rpc.make(WS_METHODS.threadsWrittenFile, {
  payload: ThreadWrittenFileInput,
  success: ThreadWrittenFileResult,
  error: Schema.Union([ThreadFileWritesError, EnvironmentAuthorizationError]),
});

/** The console child process's own lifecycle — idle/starting/ready/unavailable — so the panel can show a spawn/degrade state without polling. */
const WsSubscribeZeropsDataConsoleRpc = Rpc.make(WS_METHODS.subscribeZeropsDataConsole, {
  payload: Schema.Struct({}),
  success: ZeropsDataConsoleSessionEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

/**
 * The crew feed (ARCHITECTURE §6): one whole {@link CrewSnapshot} per change,
 * coalesced to at most four a second, read from the crew tables only — it
 * never opens ssh. `status: "off"` where crew mode is not on.
 */
const WsSubscribeZeropsCrewRpc = Rpc.make(WS_METHODS.subscribeZeropsCrew, {
  payload: Schema.Struct({}),
  // Never fails to decode: a chunk that did would take the whole socket down.
  success: CrewFeedFrame,
  error: EnvironmentAuthorizationError,
  stream: true,
});

/** The crew home's files, for the editors (PRD §4.7). */
const WsZeropsCrewFilesGetRpc = Rpc.make(WS_METHODS.zeropsCrewFilesGet, {
  payload: Schema.Struct({}),
  success: CrewFiles,
  error: Schema.Union([CrewCommandError, EnvironmentAuthorizationError]),
});

/** Saves editor or *Describe it* output into the crew home; nothing applies until a command does. */
const WsZeropsCrewFilesPutRpc = Rpc.make(WS_METHODS.zeropsCrewFilesPut, {
  payload: CrewFiles,
  error: Schema.Union([CrewCommandError, EnvironmentAuthorizationError]),
});

/** One press on a crew surface; the state it changes arrives on the crew feed. */
const WsZeropsCrewCommandRpc = Rpc.make(WS_METHODS.zeropsCrewCommand, {
  payload: CrewCommand,
  success: CrewCommandResult,
  error: Schema.Union([CrewCommandError, EnvironmentAuthorizationError]),
});

/**
 * A crewmate's finished work past the board, a page at a time (the engine's crew bounds its
 * board); a V1 server's board holds every task and pages nothing.
 */
const WsZeropsCrewTaskPageRpc = Rpc.make(WS_METHODS.zeropsCrewTaskPage, {
  payload: CrewTaskPageInput,
  success: CrewTaskPage,
  error: Schema.Union([CrewCommandError, EnvironmentAuthorizationError]),
});

// ── the Mate engine's conversation wire (engineWire.ts) ──────────────────────────────────────
// Served in mate mode; a V1 Mate, or a protocol the server does not speak, answers `unserved`.

/** A conversation: a window snapshot or a resume from a cursor, `synchronized`, then live. */
const WsSubscribeEngineConversationRpc = Rpc.make(WS_METHODS.subscribeEngineConversation, {
  payload: EngineSubscribeInput,
  // Never fails to decode: unknown frames and records decode to their `unknown` members.
  success: EngineConversationFrame,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
  stream: true,
});

/** The Mate's conversation rows (the menu): a snapshot, then each row as it changes. */
const WsSubscribeEngineRowsRpc = Rpc.make(WS_METHODS.subscribeEngineRows, {
  payload: EngineSubscribeRowsInput,
  success: EngineRowsFrame,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsEngineReadEarlierRpc = Rpc.make(WS_METHODS.engineReadEarlier, {
  payload: EngineReadEarlierInput,
  success: EnginePage,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

const WsEngineReadRunRpc = Rpc.make(WS_METHODS.engineReadRun, {
  payload: EngineReadRunInput,
  success: EnginePage,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

const WsEngineReadDetailRpc = Rpc.make(WS_METHODS.engineReadDetail, {
  payload: EngineReadDetailInput,
  success: EngineDetail,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

/** A call's stored receipt, by its command id: how a lost answer is resolved. */
const WsEngineReceiptRpc = Rpc.make(WS_METHODS.engineReceipt, {
  payload: EngineReceiptInput,
  success: EngineReceiptResult,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

const WsEngineSendRpc = Rpc.make(WS_METHODS.engineSend, {
  payload: EngineSendInput,
  success: EngineCallResult,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

const WsEngineStopRpc = Rpc.make(WS_METHODS.engineStop, {
  payload: EngineStopInput,
  success: EngineCallResult,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

const WsEngineContinueRpc = Rpc.make(WS_METHODS.engineContinue, {
  payload: EngineContinueInput,
  success: EngineCallResult,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

const WsEngineAnswerRpc = Rpc.make(WS_METHODS.engineAnswer, {
  payload: EngineAnswerInput,
  success: EngineCallResult,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

/** Close a dismissible request unanswered; the engine refuses one its agent waits on. */
const WsEngineDismissRpc = Rpc.make(WS_METHODS.engineDismiss, {
  payload: EngineDismissInput,
  success: EngineCallResult,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

const WsEngineSteerRpc = Rpc.make(WS_METHODS.engineSteer, {
  payload: EngineSteerInput,
  success: EngineCallResult,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

const WsEngineSwitchModelRpc = Rpc.make(WS_METHODS.engineSwitchModel, {
  payload: EngineSwitchModelInput,
  success: EngineCallResult,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

const WsEngineSetArchivedRpc = Rpc.make(WS_METHODS.engineSetArchived, {
  payload: EngineSetArchivedInput,
  success: EngineCallResult,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});
const WsEngineSetRuntimeModeRpc = Rpc.make(WS_METHODS.engineSetRuntimeMode, {
  payload: EngineSetRuntimeModeInput,
  success: EngineCallResult,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

const WsEngineAssignAgentRpc = Rpc.make(WS_METHODS.engineAssignAgent, {
  payload: EngineAssignAgentInput,
  success: EngineCallResult,
  error: Schema.Union([EngineWireError, EnvironmentAuthorizationError]),
});

/**
 * Checks the connection's scopes against the scope each RPC declares, before
 * the handler runs. Every RPC in `WsRpcGroup` carries it, so a handler cannot
 * be added without authorization.
 */
export class RpcScopeAuthorization extends RpcMiddleware.Service<RpcScopeAuthorization>()(
  "t3/contracts/RpcScopeAuthorization",
  { error: EnvironmentAuthorizationError },
) {}

/**
 * Records each RPC's span and request metrics on the server. Added after
 * `RpcScopeAuthorization`, so it wraps authorization and also records rejected
 * calls. Clients ignore it.
 */
export class RpcInstrumentation extends RpcMiddleware.Service<RpcInstrumentation>()(
  "t3/contracts/RpcInstrumentation",
) {}

export const WsRpcGroup = RpcGroup.make(
  WsExecRunRpc,
  WsServerProbeRpc,
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateProviderRpc,
  WsProviderConsumeResetCreditRpc,
  WsProviderAuthStartRpc,
  WsProviderAuthCompleteRpc,
  WsProviderAuthRespondRpc,
  WsProviderAuthCancelRpc,
  WsProviderAuthLogoutRpc,
  WsProviderAuthSubscribeRpc,
  WsProviderInstallStartRpc,
  WsProviderInstallCancelRpc,
  WsProviderInstallSubscribeRpc,
  WsProviderInstallRemoveRpc,
  WsServerUpdateServerRpc,
  WsServerUpdateServerWithProgressRpc,
  WsServerUpsertKeybindingRpc,
  WsServerRemoveKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsServerDiscoverSourceControlRpc,
  WsServerGetTraceDiagnosticsRpc,
  WsServerGetProcessDiagnosticsRpc,
  WsServerGetProcessResourceHistoryRpc,
  WsServerGetResourceTelemetryHistoryRpc,
  WsServerRetryResourceTelemetryRpc,
  WsServerSignalProcessRpc,
  WsServerReportClientActivityRpc,
  WsServerReportHostPowerStateRpc,
  WsServerGetBackgroundPolicyRpc,
  WsCloudGetRelayClientStatusRpc,
  WsCloudInstallRelayClientRpc,
  WsSourceControlLookupRepositoryRpc,
  WsSourceControlCloneRepositoryRpc,
  WsSourceControlPublishRepositoryRpc,
  WsProjectCloneStartRpc,
  WsProjectCloneCancelRpc,
  WsProjectCloneRetryRpc,
  WsSubscribeProjectClonesRpc,
  WsProjectsListEntriesRpc,
  WsProjectsReadFileRpc,
  WsProjectsSearchContentsRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsFilesystemBrowseRpc,
  WsAssetsCreateUrlRpc,
  WsAttachmentsCreateUploadUrlRpc,
  WsAttachmentsDeleteRpc,
  WsProviderUploadFeedbackRpc,
  WsMcpServersListRpc,
  WsMcpServersAddRpc,
  WsMcpServersRemoveRpc,
  WsMcpServersSetEnabledRpc,
  WsMcpServersReconnectRpc,
  WsSubscribeVcsStatusRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsVcsListRefsRpc,
  WsVcsCreateWorktreeRpc,
  WsVcsRemoveWorktreeRpc,
  WsVcsCreateRefRpc,
  WsVcsSwitchRefRpc,
  WsVcsInitRpc,
  WsReviewGetDiffPreviewRpc,
  WsReviewGetDiffFileContentsRpc,
  WsTerminalOpenRpc,
  WsTerminalAttachRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeTerminalMetadataRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsSubscribeBackgroundPolicyRpc,
  WsSubscribeResourceTelemetryRpc,
  WsZeropsLifecycleGetRpc,
  WsZeropsStandUpRetryRpc,
  WsSubscribeZeropsLifecycleRpc,
  WsSubscribeZeropsAgentAuthRpc,
  WsSubscribeZeropsHealthRpc,
  WsSubscribeZeropsAttentionRpc,
  WsZeropsAgentLoginStartRpc,
  WsZeropsAgentAuthCheckRpc,
  WsZeropsAgentLoginCancelRpc,
  WsZeropsAgentLoginSubmitCodeRpc,
  WsZeropsAgentLoginSignOutRpc,
  WsZeropsLoginAddRpc,
  WsZeropsLoginRemoveRpc,
  WsSubscribeZeropsBrowserStreamRpc,
  WsZeropsBrowserInputRpc,
  WsZeropsMateUpdateRpc,
  WsZeropsMateCheckUpdateRpc,
  WsZeropsDataConsoleCallRpc,
  WsZeropsGitProbeRemoteRpc,
  WsThreadsFileWritesRpc,
  WsThreadsWrittenFileRpc,
  WsSubscribeZeropsDataConsoleRpc,
  WsSubscribeZeropsCrewRpc,
  WsZeropsCrewFilesGetRpc,
  WsZeropsCrewFilesPutRpc,
  WsZeropsCrewCommandRpc,
  WsZeropsCrewTaskPageRpc,
  WsSubscribeEngineConversationRpc,
  WsSubscribeEngineRowsRpc,
  WsEngineReadEarlierRpc,
  WsEngineReadRunRpc,
  WsEngineReadDetailRpc,
  WsEngineReceiptRpc,
  WsEngineSendRpc,
  WsEngineStopRpc,
  WsEngineContinueRpc,
  WsEngineAnswerRpc,
  WsEngineDismissRpc,
  WsEngineSteerRpc,
  WsEngineSwitchModelRpc,
  WsEngineSetArchivedRpc,
  WsEngineSetRuntimeModeRpc,
  WsEngineAssignAgentRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetWorkflowScriptRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationSearchThreadsRpc,
  WsEngineGetArchivedShellSnapshotRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
)
  .middleware(RpcScopeAuthorization)
  // Middleware added later wraps middleware added earlier.
  .middleware(RpcInstrumentation);

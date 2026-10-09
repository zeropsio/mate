import {
  ORCHESTRATION_WS_METHODS,
  RpcInstrumentation,
  WS_METHODS,
  type WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as References from "effect/References";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import { rpcRequestDuration, rpcRequestsTotal, withMetrics } from "./Metrics.ts";

type WsRpcMethod = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

/**
 * The `rpc.aggregate` span attribute of every WebSocket RPC. Trace queries and dashboards group by
 * these labels, so they keep their historical values even where they differ from the method
 * prefix. Adding an RPC to `WsRpcGroup` without a label is a type error.
 */
const RPC_AGGREGATES = {
  [ORCHESTRATION_WS_METHODS.dispatchCommand]: "orchestration",
  [ORCHESTRATION_WS_METHODS.getWorkflowScript]: "orchestration",
  [ORCHESTRATION_WS_METHODS.getTurnDiff]: "orchestration",
  [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: "orchestration",
  [ORCHESTRATION_WS_METHODS.searchThreads]: "orchestration",
  [ORCHESTRATION_WS_METHODS.subscribeShell]: "orchestration",
  [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: "orchestration",
  [ORCHESTRATION_WS_METHODS.subscribeThread]: "orchestration",
  [WS_METHODS.execRun]: "exec",
  [WS_METHODS.serverProbe]: "server",
  [WS_METHODS.serverGetConfig]: "server",
  [WS_METHODS.serverRefreshProviders]: "server",
  [WS_METHODS.serverUpdateProvider]: "server",
  [WS_METHODS.providerAuthStart]: "provider",
  [WS_METHODS.providerConsumeResetCredit]: "provider",
  [WS_METHODS.providerAuthComplete]: "provider",
  [WS_METHODS.providerAuthRespond]: "provider",
  [WS_METHODS.providerAuthCancel]: "provider",
  [WS_METHODS.providerAuthLogout]: "provider",
  [WS_METHODS.providerAuthSubscribe]: "provider",
  [WS_METHODS.providerInstallStart]: "provider",
  [WS_METHODS.providerInstallCancel]: "provider",
  [WS_METHODS.providerInstallSubscribe]: "provider",
  [WS_METHODS.providerInstallRemove]: "provider",
  [WS_METHODS.serverUpdateServer]: "server",
  [WS_METHODS.serverUpdateServerWithProgress]: "server",
  [WS_METHODS.serverUpsertKeybinding]: "server",
  [WS_METHODS.serverRemoveKeybinding]: "server",
  [WS_METHODS.serverGetSettings]: "server",
  [WS_METHODS.serverUpdateSettings]: "server",
  [WS_METHODS.serverDiscoverSourceControl]: "server",
  [WS_METHODS.serverGetTraceDiagnostics]: "server",
  [WS_METHODS.serverGetProcessDiagnostics]: "server",
  [WS_METHODS.serverGetProcessResourceHistory]: "server",
  [WS_METHODS.serverGetResourceTelemetryHistory]: "server",
  [WS_METHODS.serverRetryResourceTelemetry]: "server",
  [WS_METHODS.serverSignalProcess]: "server",
  [WS_METHODS.serverReportClientActivity]: "server",
  [WS_METHODS.serverReportHostPowerState]: "server",
  [WS_METHODS.serverGetBackgroundPolicy]: "server",
  [WS_METHODS.cloudGetRelayClientStatus]: "cloud",
  [WS_METHODS.cloudInstallRelayClient]: "cloud",
  [WS_METHODS.sourceControlLookupRepository]: "source-control",
  [WS_METHODS.sourceControlCloneRepository]: "source-control",
  [WS_METHODS.sourceControlPublishRepository]: "source-control",
  [WS_METHODS.projectCloneStart]: "source-control",
  [WS_METHODS.projectCloneCancel]: "source-control",
  [WS_METHODS.projectCloneRetry]: "source-control",
  [WS_METHODS.subscribeProjectClones]: "source-control",
  [WS_METHODS.projectsListEntries]: "workspace",
  [WS_METHODS.projectsReadFile]: "workspace",
  [WS_METHODS.projectsSearchContents]: "workspace",
  [WS_METHODS.projectsSearchEntries]: "workspace",
  [WS_METHODS.projectsWriteFile]: "workspace",
  [WS_METHODS.shellOpenInEditor]: "workspace",
  [WS_METHODS.filesystemBrowse]: "workspace",
  [WS_METHODS.assetsCreateUrl]: "workspace",
  [WS_METHODS.attachmentsCreateUploadUrl]: "workspace",
  [WS_METHODS.attachmentsDelete]: "workspace",
  [WS_METHODS.providerUploadFeedback]: "provider",
  [WS_METHODS.mcpServersList]: "server",
  [WS_METHODS.mcpServersAdd]: "server",
  [WS_METHODS.mcpServersRemove]: "server",
  [WS_METHODS.mcpServersSetEnabled]: "server",
  [WS_METHODS.mcpServersReconnect]: "server",
  [WS_METHODS.subscribeVcsStatus]: "vcs",
  [WS_METHODS.zeropsGitProbeRemote]: "zerops",
  [WS_METHODS.threadsFileWrites]: "orchestration",
  [WS_METHODS.threadsWrittenFile]: "orchestration",
  [WS_METHODS.subscribeResourceTelemetry]: "server",
  [WS_METHODS.zeropsLifecycleGet]: "zerops",
  [WS_METHODS.zeropsStandUpRetry]: "zerops",
  [WS_METHODS.subscribeZeropsLifecycle]: "zerops",
  [WS_METHODS.subscribeZeropsAgentAuth]: "zerops",
  [WS_METHODS.subscribeZeropsHealth]: "zerops",
  [WS_METHODS.subscribeZeropsAttention]: "zerops",
  [WS_METHODS.zeropsAgentAuthCheck]: "zerops",
  [WS_METHODS.zeropsAgentLoginStart]: "zerops",
  [WS_METHODS.zeropsAgentLoginCancel]: "zerops",
  [WS_METHODS.zeropsAgentLoginSubmitCode]: "zerops",
  [WS_METHODS.zeropsAgentLoginSignOut]: "zerops",
  [WS_METHODS.zeropsLoginAdd]: "zerops",
  [WS_METHODS.zeropsLoginRemove]: "zerops",
  [WS_METHODS.subscribeZeropsBrowserStream]: "zerops",
  [WS_METHODS.zeropsBrowserInput]: "zerops",
  [WS_METHODS.zeropsMateUpdate]: "zerops",
  [WS_METHODS.zeropsMateCheckUpdate]: "zerops",
  [WS_METHODS.zeropsDataConsoleCall]: "zerops",
  [WS_METHODS.subscribeZeropsDataConsole]: "zerops",
  [WS_METHODS.subscribeZeropsCrew]: "zerops",
  [WS_METHODS.zeropsCrewFilesGet]: "zerops",
  [WS_METHODS.zeropsCrewFilesPut]: "zerops",
  [WS_METHODS.zeropsCrewCommand]: "zerops",
  [WS_METHODS.zeropsCrewTaskPage]: "zerops",
  [WS_METHODS.subscribeEngineConversation]: "engine",
  [WS_METHODS.subscribeEngineRows]: "engine",
  [WS_METHODS.engineReadEarlier]: "engine",
  [WS_METHODS.engineReadRun]: "engine",
  [WS_METHODS.engineReadDetail]: "engine",
  [WS_METHODS.engineReceipt]: "engine",
  [WS_METHODS.engineSend]: "engine",
  [WS_METHODS.engineStop]: "engine",
  [WS_METHODS.engineAnswer]: "engine",
  [WS_METHODS.engineDismiss]: "engine",
  [WS_METHODS.engineSteer]: "engine",
  [WS_METHODS.engineSwitchModel]: "engine",
  [WS_METHODS.engineSetArchived]: "engine",
  [WS_METHODS.engineSetRuntimeMode]: "engine",
  [WS_METHODS.engineAssignAgent]: "engine",
  [WS_METHODS.vcsRefreshStatus]: "vcs",
  [WS_METHODS.vcsPull]: "git",
  [WS_METHODS.gitRunStackedAction]: "vcs",
  [WS_METHODS.gitResolvePullRequest]: "git",
  [WS_METHODS.gitPreparePullRequestThread]: "git",
  [WS_METHODS.vcsListRefs]: "vcs",
  [WS_METHODS.vcsCreateWorktree]: "vcs",
  [WS_METHODS.vcsRemoveWorktree]: "vcs",
  [WS_METHODS.vcsCreateRef]: "vcs",
  [WS_METHODS.vcsSwitchRef]: "vcs",
  [WS_METHODS.vcsInit]: "vcs",
  [WS_METHODS.reviewGetDiffPreview]: "review",
  [WS_METHODS.reviewGetDiffFileContents]: "review",
  [WS_METHODS.terminalOpen]: "terminal",
  [WS_METHODS.terminalAttach]: "terminal",
  [WS_METHODS.terminalWrite]: "terminal",
  [WS_METHODS.terminalResize]: "terminal",
  [WS_METHODS.terminalClear]: "terminal",
  [WS_METHODS.terminalRestart]: "terminal",
  [WS_METHODS.terminalClose]: "terminal",
  [WS_METHODS.subscribeTerminalEvents]: "terminal",
  [WS_METHODS.subscribeTerminalMetadata]: "terminal",
  [WS_METHODS.subscribeServerConfig]: "server",
  [WS_METHODS.subscribeServerLifecycle]: "server",
  [WS_METHODS.subscribeAuthAccess]: "auth",
  [WS_METHODS.subscribeBackgroundPolicy]: "server",
} as const satisfies Readonly<Record<WsRpcMethod, string>>;

const RPC_SPAN_PREFIX = "ws.rpc";
const DEFAULT_RPC_SPAN_ATTRIBUTES = {
  "rpc.transport": "websocket",
  "rpc.system": "effect-rpc",
} as const;
const RPC_METHODS_WITH_TRACING_DISABLED: ReadonlySet<string> = new Set([
  WS_METHODS.serverGetTraceDiagnostics,
  WS_METHODS.serverGetProcessDiagnostics,
  WS_METHODS.serverGetProcessResourceHistory,
  WS_METHODS.serverSignalProcess,
]);

/**
 * Wraps each WebSocket RPC call in its `ws.rpc.<method>` span and records its request counter and
 * duration. For a stream RPC, the middleware receives the whole stream run, so the span and the
 * metrics cover the subscription until it ends, fails, or is interrupted. Methods in
 * `RPC_METHODS_WITH_TRACING_DISABLED` record metrics but no spans, for the call or anything it runs.
 */
export const rpcInstrumentationLayer = Layer.succeed(RpcInstrumentation)((effect, { rpc }) => {
  const method = rpc._tag;
  const measured = effect.pipe(
    withMetrics({ counter: rpcRequestsTotal, timer: rpcRequestDuration, attributes: { method } }),
  );

  if (RPC_METHODS_WITH_TRACING_DISABLED.has(method)) {
    return measured.pipe(Effect.provideService(References.TracerEnabled, false));
  }
  return measured.pipe(
    Effect.withSpan(`${RPC_SPAN_PREFIX}.${method}`, {
      attributes: {
        ...DEFAULT_RPC_SPAN_ATTRIBUTES,
        "rpc.method": method,
        "rpc.aggregate": RPC_AGGREGATES[method as WsRpcMethod],
      },
    }),
  );
});

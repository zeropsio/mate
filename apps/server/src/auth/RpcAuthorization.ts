import {
  AuthAccessReadScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  AuthReviewWriteScope,
  AuthTerminalOperateScope,
  AuthExecOperateScope,
  ORCHESTRATION_WS_METHODS,
  type AuthEnvironmentScope,
  EnvironmentAuthorizationError,
  RpcScopeAuthorization,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as RpcGroup from "effect/rpc/RpcGroup";

type WsRpcMethod = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

/**
 * Keep authorization coverage coupled to the RPC group itself. Adding an RPC to
 * `WsRpcGroup` without choosing a scope is a type error instead of a production
 * runtime failure.
 */
export const RPC_REQUIRED_SCOPES = {
  [ORCHESTRATION_WS_METHODS.dispatchCommand]: AuthOrchestrationOperateScope,
  [ORCHESTRATION_WS_METHODS.getWorkflowScript]: AuthOrchestrationReadScope,
  [ORCHESTRATION_WS_METHODS.searchThreads]: AuthOrchestrationReadScope,
  [ORCHESTRATION_WS_METHODS.subscribeShell]: AuthOrchestrationReadScope,
  [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: AuthOrchestrationReadScope,
  [WS_METHODS.execRun]: AuthExecOperateScope,
  [WS_METHODS.serverProbe]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetConfig]: AuthOrchestrationReadScope,
  [WS_METHODS.serverRefreshProviders]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverUpdateProvider]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerAuthStart]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerConsumeResetCredit]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerAuthComplete]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerAuthRespond]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerAuthCancel]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerAuthLogout]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerAuthSubscribe]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerInstallStart]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerInstallCancel]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerInstallSubscribe]: AuthOrchestrationReadScope,
  [WS_METHODS.providerInstallRemove]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverUpdateServer]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverUpdateServerWithProgress]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverUpsertKeybinding]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverRemoveKeybinding]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverGetSettings]: AuthOrchestrationReadScope,
  [WS_METHODS.serverUpdateSettings]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverDiscoverSourceControl]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetTraceDiagnostics]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetProcessDiagnostics]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetProcessResourceHistory]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetResourceTelemetryHistory]: AuthOrchestrationReadScope,
  [WS_METHODS.serverRetryResourceTelemetry]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverSignalProcess]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverReportClientActivity]: AuthOrchestrationReadScope,
  [WS_METHODS.serverReportHostPowerState]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverGetBackgroundPolicy]: AuthOrchestrationReadScope,
  [WS_METHODS.cloudGetRelayClientStatus]: AuthRelayReadScope,
  [WS_METHODS.cloudInstallRelayClient]: AuthRelayWriteScope,
  [WS_METHODS.sourceControlLookupRepository]: AuthOrchestrationReadScope,
  [WS_METHODS.sourceControlCloneRepository]: AuthOrchestrationOperateScope,
  [WS_METHODS.sourceControlPublishRepository]: AuthOrchestrationOperateScope,
  [WS_METHODS.projectCloneStart]: AuthOrchestrationOperateScope,
  [WS_METHODS.projectCloneCancel]: AuthOrchestrationOperateScope,
  [WS_METHODS.projectCloneRetry]: AuthOrchestrationOperateScope,
  [WS_METHODS.subscribeProjectClones]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsListEntries]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsReadFile]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsSearchContents]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsSearchEntries]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsWriteFile]: AuthOrchestrationOperateScope,
  [WS_METHODS.shellOpenInEditor]: AuthOrchestrationOperateScope,
  [WS_METHODS.filesystemBrowse]: AuthOrchestrationReadScope,
  [WS_METHODS.assetsCreateUrl]: AuthOrchestrationReadScope,
  [WS_METHODS.attachmentsCreateUploadUrl]: AuthOrchestrationOperateScope,
  [WS_METHODS.attachmentsDelete]: AuthOrchestrationOperateScope,
  [WS_METHODS.providerUploadFeedback]: AuthOrchestrationOperateScope,
  [WS_METHODS.mcpServersList]: AuthOrchestrationReadScope,
  [WS_METHODS.mcpServersAdd]: AuthOrchestrationOperateScope,
  [WS_METHODS.mcpServersRemove]: AuthOrchestrationOperateScope,
  [WS_METHODS.mcpServersSetEnabled]: AuthOrchestrationOperateScope,
  [WS_METHODS.mcpServersReconnect]: AuthOrchestrationOperateScope,
  [WS_METHODS.subscribeVcsStatus]: AuthOrchestrationReadScope,
  // `git ls-remote` against the checkout's own remote: a read of what is
  // already there, with no ref written and nothing fetched (guide 4.5).
  [WS_METHODS.zeropsGitProbeRemote]: AuthOrchestrationReadScope,
  // What this thread's agent wrote, from its own record: the same read as the
  // thread itself. Nothing is read from disk.
  [WS_METHODS.threadsFileWrites]: AuthOrchestrationReadScope,
  [WS_METHODS.threadsWrittenFile]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeResourceTelemetry]: AuthOrchestrationReadScope,
  // Every Zerops feed method is a READ. Mutating the project stays the
  // agent's job through MCP, never a client RPC.
  [WS_METHODS.zeropsLifecycleGet]: AuthOrchestrationReadScope,
  [WS_METHODS.zeropsStandUpRetry]: AuthOrchestrationOperateScope,
  [WS_METHODS.subscribeZeropsLifecycle]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeZeropsAgentAuth]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeZeropsHealth]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeZeropsAttention]: AuthOrchestrationReadScope,
  // A login session runs a real command in a real terminal on the user's
  // behalf — the same authority as `terminal.write`/`terminal.open`, not a
  // read.
  [WS_METHODS.zeropsAgentAuthCheck]: AuthTerminalOperateScope,
  [WS_METHODS.zeropsAgentLoginStart]: AuthTerminalOperateScope,
  [WS_METHODS.zeropsAgentLoginCancel]: AuthTerminalOperateScope,
  [WS_METHODS.zeropsAgentLoginSubmitCode]: AuthTerminalOperateScope,
  // Signs an agent out everywhere this Mate can reach — the same authority
  // as starting or cancelling a login, not a read.
  [WS_METHODS.zeropsAgentLoginSignOut]: AuthTerminalOperateScope,
  // Adding a login makes another place a sign-in can run, removing one signs
  // it out — the same authority as the login RPCs above.
  [WS_METHODS.zeropsLoginAdd]: AuthTerminalOperateScope,
  [WS_METHODS.zeropsLoginRemove]: AuthTerminalOperateScope,
  // Viewing the container's browser is a read, like every other Zerops feed;
  // clicking/typing into it is a real action on the user's behalf — the same
  // authority as any other environment-mutating RPC.
  [WS_METHODS.subscribeZeropsBrowserStream]: AuthOrchestrationReadScope,
  // The Mac's live view, the same pair: watching is a read, a click or typing operates.
  [WS_METHODS.subscribeZeropsMacStream]: AuthOrchestrationReadScope,
  [WS_METHODS.zeropsMacInput]: AuthOrchestrationOperateScope,
  [WS_METHODS.zeropsMacForget]: AuthOrchestrationOperateScope,
  // Runs a real update on the container — the same authority as exec.run,
  // not a read (spec-mate.md §2.9 MU-2).
  [WS_METHODS.zeropsMateUpdate]: AuthExecOperateScope,
  // A check reads the manifest; it does not operate.
  [WS_METHODS.zeropsMateCheckUpdate]: AuthOrchestrationReadScope,
  // Every Data Console request in this slice is a read (no write token ever
  // passed to the console); slice 2 splits mutating request kinds onto
  // AuthOrchestrationOperateScope.
  [WS_METHODS.zeropsDataConsoleCall]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeZeropsDataConsole]: AuthOrchestrationReadScope,
  // Crew mode (ARCHITECTURE §6): reading the feed and the crew home is a read;
  // saving the home or pressing anything on a crew surface starts crew work on
  // the person's behalf, the same authority as dispatching a command.
  [WS_METHODS.subscribeZeropsCrew]: AuthOrchestrationReadScope,
  [WS_METHODS.zeropsCrewFilesGet]: AuthOrchestrationReadScope,
  [WS_METHODS.zeropsCrewFilesPut]: AuthOrchestrationOperateScope,
  [WS_METHODS.zeropsCrewCommand]: AuthOrchestrationOperateScope,
  [WS_METHODS.zeropsCrewPropose]: AuthOrchestrationOperateScope,
  [WS_METHODS.zeropsCrewTaskPage]: AuthOrchestrationReadScope,
  // The Mate engine's conversation: reading it is the same read as a thread's; sending,
  // stopping, answering, dismissing and steering are the same authority as dispatching a V1 command.
  [WS_METHODS.subscribeEngineConversation]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeEngineRows]: AuthOrchestrationReadScope,
  [WS_METHODS.engineReadEarlier]: AuthOrchestrationReadScope,
  [WS_METHODS.engineGetArchivedShellSnapshot]: AuthOrchestrationReadScope,
  [WS_METHODS.engineReadRun]: AuthOrchestrationReadScope,
  [WS_METHODS.engineReadDetail]: AuthOrchestrationReadScope,
  // A height the person's own view laid a page out at: anyone who can read the page records it.
  [WS_METHODS.engineRecordPageHeight]: AuthOrchestrationReadScope,
  [WS_METHODS.engineReceipt]: AuthOrchestrationReadScope,
  [WS_METHODS.engineSend]: AuthOrchestrationOperateScope,
  [WS_METHODS.engineStop]: AuthOrchestrationOperateScope,
  [WS_METHODS.engineContinue]: AuthOrchestrationOperateScope,
  [WS_METHODS.engineAnswer]: AuthOrchestrationOperateScope,
  [WS_METHODS.engineDismiss]: AuthOrchestrationOperateScope,
  [WS_METHODS.engineSteer]: AuthOrchestrationOperateScope,
  [WS_METHODS.engineSwitchModel]: AuthOrchestrationOperateScope,
  [WS_METHODS.engineSetArchived]: AuthOrchestrationOperateScope,
  [WS_METHODS.engineSetRuntimeMode]: AuthOrchestrationOperateScope,
  [WS_METHODS.engineAssignAgent]: AuthOrchestrationOperateScope,
  [WS_METHODS.vcsRefreshStatus]: AuthOrchestrationReadScope,
  [WS_METHODS.vcsPull]: AuthOrchestrationOperateScope,
  [WS_METHODS.gitRunStackedAction]: AuthOrchestrationOperateScope,
  [WS_METHODS.gitResolvePullRequest]: AuthOrchestrationOperateScope,
  [WS_METHODS.gitPreparePullRequestThread]: AuthOrchestrationOperateScope,
  [WS_METHODS.vcsListRefs]: AuthOrchestrationReadScope,
  [WS_METHODS.vcsCreateWorktree]: AuthOrchestrationOperateScope,
  [WS_METHODS.vcsRemoveWorktree]: AuthOrchestrationOperateScope,
  [WS_METHODS.vcsCreateRef]: AuthOrchestrationOperateScope,
  [WS_METHODS.vcsSwitchRef]: AuthOrchestrationOperateScope,
  [WS_METHODS.vcsInit]: AuthOrchestrationOperateScope,
  [WS_METHODS.reviewGetDiffPreview]: AuthReviewWriteScope,
  [WS_METHODS.reviewGetDiffFileContents]: AuthReviewWriteScope,
  [WS_METHODS.terminalOpen]: AuthTerminalOperateScope,
  [WS_METHODS.terminalAttach]: AuthTerminalOperateScope,
  [WS_METHODS.terminalWrite]: AuthTerminalOperateScope,
  [WS_METHODS.terminalResize]: AuthTerminalOperateScope,
  [WS_METHODS.terminalClear]: AuthTerminalOperateScope,
  [WS_METHODS.terminalRestart]: AuthTerminalOperateScope,
  [WS_METHODS.terminalClose]: AuthTerminalOperateScope,
  [WS_METHODS.subscribeTerminalEvents]: AuthTerminalOperateScope,
  [WS_METHODS.subscribeTerminalMetadata]: AuthTerminalOperateScope,
  [WS_METHODS.subscribeServerConfig]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeServerLifecycle]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeAuthAccess]: AuthAccessReadScope,
  [WS_METHODS.subscribeBackgroundPolicy]: AuthOrchestrationReadScope,
} as const satisfies Readonly<Record<WsRpcMethod, AuthEnvironmentScope>>;

export function requiredScopeForRpcMethod(method: string): AuthEnvironmentScope {
  if (!Object.hasOwn(RPC_REQUIRED_SCOPES, method)) {
    throw new Error(`RPC method ${method} has no declared authorization scope.`);
  }
  const requiredScope = RPC_REQUIRED_SCOPES[method as WsRpcMethod];
  if (requiredScope === undefined) {
    throw new Error(`RPC method ${method} has no declared authorization scope.`);
  }
  return requiredScope;
}

export const rpcAuthorizationError = (requiredScope: AuthEnvironmentScope) =>
  new EnvironmentAuthorizationError({
    message: `The authenticated token is missing required scope: ${requiredScope}.`,
    requiredScope,
  });

/** The scopes whose calls act in the Mate: on someone else's Mate, its owner's alone. */
const OPERATING_SCOPES: ReadonlySet<AuthEnvironmentScope> = new Set([
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  AuthExecOperateScope,
]);

/**
 * The calls under an operating scope that only watch: what a colleague reading along still
 * subscribes to. Every other operating call acts, so the client's read-along (`agentAdmission`)
 * holds on the server too.
 */
const WATCHING_UNDER_OPERATE: ReadonlySet<string> = new Set([
  WS_METHODS.providerAuthSubscribe,
  WS_METHODS.subscribeTerminalEvents,
  WS_METHODS.subscribeTerminalMetadata,
]);

/** Whether the RPC acts in the Mate, so only the Mate's owner may call it. */
export const ownerOnlyRpcMethod = (method: string): boolean =>
  OPERATING_SCOPES.has(requiredScopeForRpcMethod(method)) && !WATCHING_UNDER_OPERATE.has(method);

export const rpcReadAlongError = (requiredScope: AuthEnvironmentScope) =>
  new EnvironmentAuthorizationError({
    message: "Only this Mate's owner can do this here; you can read along.",
    requiredScope,
  });

/**
 * Authorizes every RPC on one connection against that connection's session scopes, and refuses
 * an acting call while `readsAlong` says the session's person is not the Mate's owner.
 */
export const rpcScopeAuthorizationLayer = (
  scopes: ReadonlyArray<AuthEnvironmentScope> | Effect.Effect<ReadonlyArray<AuthEnvironmentScope>>,
  readsAlong: Effect.Effect<boolean>,
) =>
  Layer.succeed(RpcScopeAuthorization)((effect, { rpc }) => {
    const requiredScope = requiredScopeForRpcMethod(rpc._tag);
    return Effect.flatMap(Effect.isEffect(scopes) ? scopes : Effect.succeed(scopes), (current) => {
      if (!current.includes(requiredScope))
        return Effect.fail(rpcAuthorizationError(requiredScope));
      if (!ownerOnlyRpcMethod(rpc._tag)) return effect;
      return Effect.flatMap(readsAlong, (along) =>
        along ? Effect.fail(rpcReadAlongError(requiredScope)) : effect,
      );
    });
  });

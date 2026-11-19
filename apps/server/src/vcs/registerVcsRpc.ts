import {
  DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  type OrchestrationDispatchCommandError,
  WS_METHODS,
  type WsRpcGroup,
} from "@t3tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as Stream from "effect/Stream";

import type { GitWorkflowService } from "../git/GitWorkflowService.ts";
import type { ProjectCloneTracker } from "../project/ProjectCloneTracker.ts";
import type { RepositoryIdentityResolver } from "../project/RepositoryIdentityResolver.ts";
import type { ReviewService } from "../review/ReviewService.ts";
import type { RpcAdmit } from "../RpcUpdateAdmission.ts";
import type { ServerSettingsService } from "../serverSettings.ts";
import type { SourceControlRepositoryService } from "../sourceControl/SourceControlRepositoryService.ts";
import type { VcsProvisioningService } from "./VcsProvisioningService.ts";
import type { VcsStatusBroadcaster } from "./VcsStatusBroadcaster.ts";

type VcsRpcTag =
  | typeof WS_METHODS.sourceControlLookupRepository
  | typeof WS_METHODS.sourceControlCloneRepository
  | typeof WS_METHODS.projectCloneStart
  | typeof WS_METHODS.projectCloneCancel
  | typeof WS_METHODS.projectCloneRetry
  | typeof WS_METHODS.subscribeProjectClones
  | typeof WS_METHODS.sourceControlPublishRepository
  | typeof WS_METHODS.subscribeVcsStatus
  | typeof WS_METHODS.vcsRefreshStatus
  | typeof WS_METHODS.vcsPull
  | typeof WS_METHODS.gitRunStackedAction
  | typeof WS_METHODS.gitResolvePullRequest
  | typeof WS_METHODS.gitPreparePullRequestThread
  | typeof WS_METHODS.vcsListRefs
  | typeof WS_METHODS.vcsCreateWorktree
  | typeof WS_METHODS.vcsRemoveWorktree
  | typeof WS_METHODS.vcsCreateRef
  | typeof WS_METHODS.vcsSwitchRef
  | typeof WS_METHODS.vcsInit
  | typeof WS_METHODS.reviewGetDiffPreview
  | typeof WS_METHODS.reviewGetDiffFileContents;

type VcsRpc = Extract<RpcGroup.Rpcs<typeof WsRpcGroup>, { readonly _tag: VcsRpcTag }>;

type VcsRpcHandlers = {
  readonly [Current in VcsRpc as Rpc.Tag<Current>]: Rpc.ToHandlerFn<Current, never>;
};

interface RegisterVcsRpcDeps {
  readonly sourceControlRepositories: SourceControlRepositoryService["Service"];
  readonly projectCloneTracker: ProjectCloneTracker["Service"];
  readonly repositoryIdentityResolver: RepositoryIdentityResolver["Service"];
  readonly vcsStatusBroadcaster: VcsStatusBroadcaster["Service"];
  readonly gitWorkflow: GitWorkflowService["Service"];
  readonly vcsProvisioning: VcsProvisioningService["Service"];
  readonly review: ReviewService["Service"];
  readonly serverSettings: ServerSettingsService["Service"];
  readonly admit: RpcAdmit;
  readonly engineMoved: () => OrchestrationDispatchCommandError;
}

export const registerVcsRpc = ({
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
}: RegisterVcsRpcDeps) => {
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

  const refreshGitStatus = (cwd: string) =>
    vcsStatusBroadcaster
      .refreshStatus(cwd)
      .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

  return {
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
        projectCloneTracker.cancel(input.projectId).pipe(Effect.map((applied) => ({ applied }))),
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
        vcsProvisioning.initRepository(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
      ),
    [WS_METHODS.reviewGetDiffPreview]: (input) =>
      admit(WS_METHODS.reviewGetDiffPreview, review.getDiffPreview(input)),
    [WS_METHODS.reviewGetDiffFileContents]: (input) =>
      admit(WS_METHODS.reviewGetDiffFileContents, review.getDiffFileContents(input)),
  } satisfies VcsRpcHandlers;
};

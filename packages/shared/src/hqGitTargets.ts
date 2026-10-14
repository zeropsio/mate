/** Person-facing Git intents and safe, attributable HQ receipts. Candidate tokens are not intents. */
import * as Schema from "effect/Schema";
import { HqEnvironmentId } from "@t3tools/contracts";
import {
  AddGitEnvironmentRequest,
  PreviewGitEnvironmentRequest,
  HqGitAdoption,
  HqRemoteProbe,
  RepoName,
  HqRemoteUrl,
} from "./hqChanges.ts";
import { HqGitBranch } from "./hqEnvironment.ts";
import { HqDeliveryAnswer } from "./hqDeploys.ts";
import { HqGitReleasePreflight } from "./hqRelease.ts";

const app = { orgId: Schema.String, appId: Schema.String, hqProjectId: Schema.String };
const repo = { ...app, repo: RepoName };
const branch = { branch: Schema.optionalKey(HqGitBranch) };
export const HqGitTargetIntent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("probe-git-remote"), ...repo, ...branch, url: HqRemoteUrl }),
  Schema.Struct({
    kind: Schema.Literal("connect-git-remote"),
    ...repo,
    ...branch,
    url: HqRemoteUrl,
  }),
  Schema.Struct({ kind: Schema.Literal("replace-git-remote-token"), ...repo, ...branch }),
  Schema.Struct({ kind: Schema.Literal("disconnect-git-remote"), ...repo }),
  Schema.Struct({
    kind: Schema.Literal("update-git-remote-address"),
    ...repo,
    ...branch,
    url: HqRemoteUrl,
  }),
  Schema.Struct({
    kind: Schema.Literal("preview-git-environment"),
    ...app,
    request: PreviewGitEnvironmentRequest,
  }),
  Schema.Struct({
    kind: Schema.Literal("add-git-environment"),
    ...app,
    request: AddGitEnvironmentRequest,
  }),
  Schema.Struct({
    kind: Schema.Literal("remove-git-environment"),
    ...app,
    environmentId: HqEnvironmentId,
    loseUnresolvedHistory: Schema.optionalKey(Schema.Literal(true)),
  }),
  Schema.Struct({ kind: Schema.Literal("preflight-git-release"), ...app }),
  Schema.Struct({ kind: Schema.Literal("run-git-again"), ...repo, environmentId: HqEnvironmentId }),
]);
export type HqGitTargetIntent = typeof HqGitTargetIntent.Type;
export const HqGitOperationResult = Schema.Union([
  HqRemoteProbe,
  Schema.Struct({ probe: HqRemoteProbe, delivery: Schema.optionalKey(HqDeliveryAnswer) }),
  Schema.Array(HqGitAdoption),
  Schema.Array(HqGitReleasePreflight),
  HqDeliveryAnswer,
]);
export type HqGitOperationResult = typeof HqGitOperationResult.Type;
export const HqGitOperationReceipt = Schema.Struct({
  requestId: Schema.String,
  operationId: Schema.String,
  executor: Schema.Literal("hq"),
  affected: Schema.Array(
    Schema.Struct({ family: Schema.Literal("hqAppDetail"), id: Schema.String }),
  ),
  handles: Schema.Array(Schema.String),
  acceptance: Schema.Struct({
    kind: Schema.Literal("accepted"),
    result: Schema.optionalKey(HqGitOperationResult),
  }),
  outcome: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("pending") }),
    Schema.Struct({ kind: Schema.Literal("succeeded"), evidence: Schema.String }),
  ]),
});
export type HqGitOperationReceipt = typeof HqGitOperationReceipt.Type;

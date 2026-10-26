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

/** Refusal reasons are shared with the copy owner so adding one requires a next step. */
export const HqRemoteRefusalReason = Schema.Literals([
  "remote_taken",
  "no_key",
  "no_remote",
  "not_repo",
  "not_structure_writer",
  "membership_unknown",
  "custodian_removed",
  "credential_invalid",
  "disconnect_required",
  "address_review",
  "repository_changed",
  "changed",
  "in_use",
  "bad_address",
  "bad_repo",
  "bad_branch",
  "key_unavailable",
  "app_not_installed",
  "app_unavailable",
  "object_too_large",
]);
export type HqRemoteRefusalReason = typeof HqRemoteRefusalReason.Type;
export const HqGitEnvironmentRefusalReason = Schema.Literals([
  "forbidden",
  "app_not_found",
  "environment_not_found",
  "production_taken",
  "branch_taken",
  "environment_name_taken",
  "environment_name_missing",
  "environment_name_long",
  "environment_name_invalid",
  "review_stale",
  "no_repositories",
  "history_loss_confirmation_required",
]);
export type HqGitEnvironmentRefusalReason = typeof HqGitEnvironmentRefusalReason.Type;
export const HqGitProbeRefusalReason = Schema.Literals([
  "token_invalid",
  "rate_limited",
  "sso",
  "archived",
  "push_not_granted",
  "not_visible",
  "could_not_verify",
  "classic_scope",
  "pull_requests_only",
  "unreachable",
]);
export type HqGitProbeRefusalReason = typeof HqGitProbeRefusalReason.Type;
export const HqGitRequestRefusalReason = Schema.Literal("request_changed");
export type HqGitRequestRefusalReason = typeof HqGitRequestRefusalReason.Type;
export const HqRemoteRefusal = Schema.Struct({
  code: Schema.Literal("remote_refused"),
  reason: HqRemoteRefusalReason,
  repository: Schema.optionalKey(Schema.String),
  applicationName: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  environments: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type HqRemoteRefusal = typeof HqRemoteRefusal.Type;

const REMOTE_WORDS: Record<HqRemoteRefusalReason, string> = {
  remote_taken:
    "This repository is already connected to another project. Disconnect it under Repositories on that project's page, or use another repository.",
  no_key:
    "HQ cannot save this token yet. Ask your HQ administrator to configure its encryption key, then try again.",
  no_remote: "This repository has no connection. Connect it before continuing.",
  not_repo:
    "This repository is no longer in the application. Choose a repository from its current list.",
  not_structure_writer:
    "Your role cannot change repository connections. Ask an organization owner or admin to do this.",
  membership_unknown:
    "Mate could not verify your organization membership. Try again when Zerops is available.",
  custodian_removed:
    "The person who supplied this token has left the organization. Replace the token.",
  credential_invalid:
    "The saved token was refused. Replace it with a token that can write to this repository.",
  disconnect_required:
    "Another repository is connected here. Remove its Git environments and disconnect it before connecting this one.",
  address_review:
    "The repository address changed. Review and confirm its new address before continuing.",
  repository_changed:
    "This address now points to a different repository. Check the address or disconnect the old repository before connecting another.",
  changed:
    "The connection changed while Mate checked it. Review the current connection and try again.",
  in_use: "Git environments still use this connection. Remove them before disconnecting it.",
  bad_address:
    "This repository address is not supported. Enter its HTTPS address without credentials or query parameters.",
  bad_repo: "This repository name is not valid. Choose a code repository with a valid name.",
  bad_branch: "This branch name is not valid. Enter a valid Git branch name.",
  key_unavailable: "HQ cannot open the saved token. Replace it with a new token.",
  app_not_installed:
    "The organization's GitHub app isn't installed on this repository. Add the repository to the app on GitHub, then try again.",
  app_unavailable:
    "GitHub didn't let the organization's GitHub app act on this repository just now. Check the app's installation on GitHub, then try again.",
  object_too_large:
    "A file in this repository's history is larger than 100 MiB. HQ takes files up to 100 MiB, as GitHub does.",
};
/** The same explanation reaches HTTP clients and internal Git consumers. */
export function remoteRefusalWords(
  refusal: Pick<HqRemoteRefusal, "reason" | "repository" | "applicationName" | "environments">,
): string {
  if (refusal.reason === "remote_taken" && refusal.applicationName) {
    return `${refusal.repository ?? "This repository"} is already connected to ${refusal.applicationName}. Disconnect it under Repositories on ${refusal.applicationName}'s page, or use another repository.`;
  }
  if (refusal.reason === "in_use" && refusal.environments?.length) {
    return `Git environments ${refusal.environments.join(", ")} still use this connection. Remove them before disconnecting it.`;
  }
  return REMOTE_WORDS[refusal.reason];
}

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

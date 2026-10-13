/** Git intents carry operation identity and reviewed evidence; candidate secrets belong to the executor. */
import type {
  AddGitEnvironmentRequest,
  HqGitAdoption,
  HqRemoteProbe,
  PreviewGitEnvironmentRequest,
} from "@t3tools/shared/hqChanges";
import type { HqEnvironmentId } from "@t3tools/contracts";
import type { HqDeliveryAnswer } from "@t3tools/shared/hqDeploys";
import type { HqGitReleasePreflight } from "@t3tools/shared/hqRelease";
import type { OperationReceipt } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import type { IntentOf, OperationKind, Settlement } from "./kind.ts";

interface App {
  readonly orgId: string;
  readonly appId: string;
  readonly hqProjectId: string;
}
interface Repo extends App {
  readonly repo: string;
}
declare module "../model.ts" {
  interface OperationIntents {
    readonly "probe-git-remote": Repo & { readonly url: string };
    readonly "connect-git-remote": Repo & { readonly url: string };
    readonly "replace-git-remote-token": Repo;
    readonly "disconnect-git-remote": Repo;
    readonly "preview-git-environment": App & { readonly request: PreviewGitEnvironmentRequest };
    readonly "add-git-environment": App & { readonly request: AddGitEnvironmentRequest };
    readonly "remove-git-environment": App & { readonly environmentId: HqEnvironmentId };
    readonly "preflight-git-release": App;
    // HQ selects the current wanted sha under its lock; no historical sha can be replayed here.
    readonly "run-git-again": Repo & { readonly environmentId: HqEnvironmentId };
  }
  interface OperationResults {
    readonly "probe-git-remote": HqRemoteProbe;
    readonly "connect-git-remote": {
      readonly probe: HqRemoteProbe;
      readonly delivery?: HqDeliveryAnswer;
    };
    readonly "replace-git-remote-token": {
      readonly probe: HqRemoteProbe;
      readonly delivery?: HqDeliveryAnswer;
    };
    readonly "preview-git-environment": ReadonlyArray<HqGitAdoption>;
    readonly "preflight-git-release": ReadonlyArray<HqGitReleasePreflight>;
    readonly "run-git-again": HqDeliveryAnswer;
  }
}

export const HQ_GIT_OPERATION_VERBS = {
  "probe-git-remote": "connect_remote",
  "connect-git-remote": "connect_remote",
  "replace-git-remote-token": "replace_remote_token",
  "disconnect-git-remote": "disconnect_remote",
  "preview-git-environment": "add_git_environment",
  "add-git-environment": "add_git_environment",
  "remove-git-environment": "remove_git_environment",
  "preflight-git-release": "release",
  "run-git-again": "redeploy",
} as const;
export type HqGitTargetKind = keyof typeof HQ_GIT_OPERATION_VERBS;
export type HqGitTargetIntent = IntentOf<HqGitTargetKind>;
export type HqGitCandidateIntent = IntentOf<
  "probe-git-remote" | "connect-git-remote" | "replace-git-remote-token"
>;
export const isHqGitTargetIntent = (intent: {
  readonly kind: string;
}): intent is HqGitTargetIntent => Object.hasOwn(HQ_GIT_OPERATION_VERBS, intent.kind);
export const needsGitCandidate = (intent: HqGitTargetIntent): intent is HqGitCandidateIntent =>
  intent.kind === "probe-git-remote" ||
  intent.kind === "connect-git-remote" ||
  intent.kind === "replace-git-remote-token";

// The adapter normalizes owner receipts. No local remote/sha match manufactures acceptance.
const kind = <K extends HqGitTargetKind>(name: K): OperationKind<K> => ({
  kind: name,
  executor: "hq",
  reflected: (read, intent, receipt) =>
    receipt.outcome.kind !== "pending" || gitSettled(read, intent, receipt) !== null,
  settledBy: gitSettled,
  observedIn: (intent: HqGitTargetIntent) => ({ family: "hqAppDetail", ownerId: intent.appId }),
});
export const HQ_GIT_TARGET_KINDS = [
  kind("probe-git-remote"),
  kind("connect-git-remote"),
  kind("replace-git-remote-token"),
  kind("disconnect-git-remote"),
  kind("preview-git-environment"),
  kind("add-git-environment"),
  kind("remove-git-environment"),
  kind("preflight-git-release"),
  kind("run-git-again"),
] as const;

/** Only the returned job identities and shas can settle Run again; no latest-job guess. */
function gitSettled(
  read: ProjectionReads,
  intent: HqGitTargetIntent,
  receipt: OperationReceipt,
): Settlement | null {
  if (intent.kind !== "run-git-again" || receipt.acceptance.kind !== "accepted") return null;
  const result = receipt.acceptance.result;
  if (result === undefined || typeof result !== "object" || result === null || !("jobs" in result))
    return null;
  const app = read.fact("hqApp", intent.appId);
  if (app.kind !== "known") return null;
  const environments = app.value.environments;
  if (environments === undefined || "refused" in environments) return null;
  const environment = environments.find(
    (entry) => entry.id === intent.environmentId && entry.target.kind === "git",
  );
  if (environment === undefined || result.jobs.length === 0) return null;
  const jobs = result.jobs.map((original) =>
    environment.jobs.find(
      (job) => job.kind === "push" && job.id === original.job && job.sha === original.sha,
    ),
  );
  const refused = jobs.find((job) => job?.state === "refused" || job?.state === "superseded");
  if (refused !== undefined)
    return {
      kind: "failed",
      reason: refused.reason ?? "HQ ended this delivery without a hand-over.",
    };
  return jobs.every((job) => job?.state === "pushed") ? { kind: "succeeded" } : null;
}

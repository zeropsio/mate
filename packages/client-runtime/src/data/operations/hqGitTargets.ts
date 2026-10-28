import type { HqGitTargetIntent as SharedGitIntent } from "@t3tools/shared/hqGitTargets";
/** Git intents carry operation identity and reviewed evidence; candidate secrets belong to the executor. */
import type { HqGitAdoption, HqRemoteProbe } from "@t3tools/shared/hqChanges";
import type { HqDeliveryAnswer } from "@t3tools/shared/hqDeploys";
import { HQ_REMOTE_WRITE_VERB } from "@t3tools/shared/hqOffers";
import type { HqGitReleasePreflight } from "@t3tools/shared/hqRelease";
import type { OperationReceipt } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import type { IntentOf, OperationKind, Settlement } from "./kind.ts";

type GitInputs = {
  [K in SharedGitIntent["kind"]]: Omit<Extract<SharedGitIntent, { readonly kind: K }>, "kind">;
};
declare module "../model.ts" {
  interface OperationIntents extends GitInputs {}
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

/** The verb of HQ's offer each operation is admitted on, in the `can` it reads (application or environment). */
export const HQ_GIT_OPERATION_VERBS = {
  "probe-git-remote": HQ_REMOTE_WRITE_VERB,
  "connect-git-remote": HQ_REMOTE_WRITE_VERB,
  "replace-git-remote-token": HQ_REMOTE_WRITE_VERB,
  "disconnect-git-remote": HQ_REMOTE_WRITE_VERB,
  "update-git-remote-address": HQ_REMOTE_WRITE_VERB,
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
  kind("update-git-remote-address"),
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

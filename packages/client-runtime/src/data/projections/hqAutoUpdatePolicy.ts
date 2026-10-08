import {
  autoUpdatePolicyRequestId,
  autoUpdatePolicyScope,
} from "../families/hqAutoUpdatePolicy.ts";
import type { PublicRead } from "../model.ts";
import type { Projection } from "../store.ts";
import { operationProgress } from "./operation.ts";
import { hqVerdict } from "./hqVerdict.ts";
import { sameValue } from "./equal.ts";

export interface AutoUpdatePolicySettings {
  readonly policy:
    | { readonly kind: "known"; readonly enabled: boolean }
    | Exclude<PublicRead<never>, { readonly kind: "known" }>;
  readonly editable: boolean;
  readonly pending: boolean;
  readonly words: string;
  readonly error: string | null;
  readonly retryRead: boolean;
  readonly recoverable: boolean;
  readonly requestId: string;
}
export const autoUpdatePolicySettings: Projection<
  { readonly orgId: string; readonly admin: boolean },
  AutoUpdatePolicySettings
> = {
  name: "autoUpdatePolicySettings",
  keyOf: (key) => JSON.stringify(key),
  equals: sameValue,
  derive: (read, { orgId, admin }) => {
    const fact = read.fact("hqAutoUpdatePolicy", orgId);
    const stream = read.stream(autoUpdatePolicyScope(orgId));
    const hq = hqVerdict.derive(read, orgId);
    const available = hq !== "none" && hq !== "unreadable";
    let attempt = 1;
    while (read.operation(autoUpdatePolicyRequestId(orgId, attempt)) !== undefined) attempt++;
    const progress =
      attempt === 1
        ? null
        : operationProgress.derive(read, autoUpdatePolicyRequestId(orgId, attempt - 1));
    const protocol = read.fact("hqProtocol", orgId);
    const upgradeRequired =
      stream.phase === "live" &&
      protocol.kind === "known" &&
      protocol.value.autoUpdatePolicy === undefined;
    const record =
      attempt === 1 ? undefined : read.operation(autoUpdatePolicyRequestId(orgId, attempt - 1));
    const pending =
      progress !== null &&
      ["submitting", "accepted", "reflected", "uncertain", "unresolved"].includes(progress.stage);
    const result =
      record?.receipt?.acceptance.kind === "accepted"
        ? record.receipt.acceptance.result
        : undefined;
    const confirmed =
      progress?.stage === "done" &&
      progress.outcome === "succeeded" &&
      result !== undefined &&
      "policy" in result &&
      fact.kind === "known" &&
      result.policy.epoch !== undefined &&
      result.policy.epoch === fact.value.epoch &&
      result.policy.revision > fact.value.revision
        ? result.policy
        : null;
    const unconfirmed = progress?.stage === "uncertain" || progress?.stage === "unresolved";
    const policy: AutoUpdatePolicySettings["policy"] =
      fact.kind === "known" ? { kind: "known", enabled: (confirmed ?? fact.value).enabled } : fact;
    const error =
      progress?.stage === "refused" || progress?.stage === "unsent"
        ? (progress.reason ?? "HQ did not take this change.")
        : progress?.stage === "uncertain" || progress?.stage === "unresolved"
          ? "HQ could not confirm this change. You can send a new change once HQ confirms the current policy. The earlier receipt stays unconfirmed."
          : (stream.fault?.message ?? null);
    return {
      policy,
      pending,
      recoverable:
        admin &&
        available &&
        !upgradeRequired &&
        policy.kind === "known" &&
        stream.phase === "live" &&
        unconfirmed,
      error,
      editable:
        admin &&
        available &&
        !upgradeRequired &&
        policy.kind === "known" &&
        stream.phase === "live" &&
        !pending,
      words: upgradeRequired
        ? "Update HQ Core to manage automatic Mate updates."
        : pending
          ? progress?.stage === "uncertain" || progress?.stage === "unresolved"
            ? `${available && stream.phase === "live" ? "Current policy" : "Last known policy"}: ${policy.kind !== "known" ? "unknown" : policy.enabled ? "On" : "Off"}; change unconfirmed`
            : "Saving…"
          : policy.kind !== "known"
            ? hq === "none"
              ? "Set up HQ to read this policy."
              : hq === "unreadable"
                ? "HQ is unavailable; check its connection."
                : fact.kind === "withheld"
                  ? "Access refused"
                  : stream.fault !== null
                    ? "Policy unavailable"
                    : "Waiting for HQ…"
            : `${available && stream.phase === "live" ? "" : "Last known: "}${policy.enabled ? "On" : "Off"}`,
      retryRead: stream.fault !== null,
      requestId: autoUpdatePolicyRequestId(orgId, attempt),
    };
  },
};

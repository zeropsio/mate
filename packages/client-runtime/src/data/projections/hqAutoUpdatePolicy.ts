import {
  autoUpdatePolicyRequestId,
  autoUpdatePolicyScope,
} from "../families/hqAutoUpdatePolicy.ts";
import type { Projection } from "../store.ts";
import { operationProgress } from "./operation.ts";
import { hqVerdict } from "./hqVerdict.ts";
import { sameValue } from "./equal.ts";

export interface AutoUpdatePolicySettings {
  readonly enabled: boolean | null;
  readonly editable: boolean;
  readonly pending: boolean;
  readonly words: string;
  readonly error: string | null;
  readonly retryRead: boolean;
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
    const pending =
      progress !== null &&
      ["submitting", "accepted", "reflected", "uncertain", "unresolved"].includes(progress.stage);
    const enabled = fact.kind === "known" ? fact.value.enabled : null;
    const error =
      progress?.stage === "refused" || progress?.stage === "unsent"
        ? (progress.reason ?? "HQ did not take this change.")
        : progress?.stage === "uncertain" || progress?.stage === "unresolved"
          ? "HQ could not confirm this change. An organization admin must check the policy at HQ before trying again."
          : (stream.fault?.message ?? null);
    return {
      enabled,
      pending,
      error,
      editable: admin && available && enabled !== null && stream.phase === "live" && !pending,
      words: pending
        ? progress?.stage === "uncertain" || progress?.stage === "unresolved"
          ? "Change unconfirmed"
          : "Saving…"
        : enabled === null
          ? hq === "none"
            ? "Set up HQ to read this policy."
            : hq === "unreadable"
              ? "HQ is unavailable; check its connection."
              : fact.kind === "withheld"
                ? "Access refused"
                : stream.fault !== null
                  ? "Policy unavailable"
                  : "Waiting for HQ…"
          : `${available && stream.phase === "live" ? "" : "Last known: "}${enabled ? "On" : "Off"}`,
      retryRead: stream.fault !== null,
      requestId: autoUpdatePolicyRequestId(orgId, attempt),
    };
  },
};

/** A restart's receipt and current Mate reading have separate outcomes. Time supplies neither. */
import { mateServerCompatibility } from "../../zerops/serverCompatibility.ts";
import { containerVerdict } from "../../zerops/environments/containerMachine.ts";
import type { ContainerVerdict } from "../../zerops/environments/environmentMachine.ts";
import type { Projection } from "../store.ts";
import { mateLink } from "./mateLinks.ts";
import { operationProgress, type OperationProgress } from "./operation.ts";
import { sameValue } from "./equal.ts";
export type MateUpgradeRecovery =
  | { readonly state: "waiting" }
  | { readonly state: "ready" }
  | { readonly state: "failed" | "unresolved"; readonly reason: string };
export function upgradeRecoveryFromEvidence(input: {
  readonly progress: OperationProgress;
  readonly verdict: ContainerVerdict;
  readonly serverVersion: string | undefined;
  readonly returned: boolean;
}): MateUpgradeRecovery {
  const { progress, verdict, serverVersion, returned } = input;
  if (progress.stage === "refused" || progress.stage === "unsent")
    return { state: "failed", reason: progress.reason ?? "Zerops did not take the restart." };
  if (progress.stage === "done" && progress.outcome !== "succeeded")
    return { state: "failed", reason: progress.reason ?? `The restart ${progress.outcome}.` };
  if (progress.stage === "uncertain" || progress.stage === "unresolved")
    return {
      state: "unresolved",
      reason:
        progress.stage === "unresolved"
          ? `${progress.reason ?? "The restart cannot be followed."} ${progress.nextAction ?? "Check the connection"}.`
          : "Zerops did not answer whether it took the restart. Check the connection.",
    };
  if (returned && verdict.level === "ready" && serverVersion !== undefined)
    return mateServerCompatibility(serverVersion) === "too-old"
      ? {
          state: "failed",
          reason:
            "The container still runs an incompatible Mate version. Check the connection again after a compatible release is available.",
        }
      : { state: "ready" };
  if ("overdue" in verdict && verdict.overdue)
    return {
      state: "unresolved",
      reason: "The container has not come back yet. Check it in Zerops, then check the connection.",
    };
  return { state: "waiting" };
}
export const mateUpgradeRecovery: Projection<
  {
    readonly requestId: string;
    readonly targetKey: string;
    readonly previousInitAt: string | null;
  },
  MateUpgradeRecovery
> = {
  name: "mateUpgradeRecovery",
  keyOf: (key) => JSON.stringify(key),
  equals: sameValue,
  derive: (read, { requestId, targetKey, previousInitAt }) => {
    const link = mateLink.derive(read, targetKey);
    const reading = link?.container.reading?.reading;
    const progress = operationProgress.derive(read, requestId);
    const returned =
      link !== null &&
      link.container.intent === null &&
      (previousInitAt === null
        ? progress.stage === "done" && progress.outcome === "succeeded"
        : reading?.kind === "ready" &&
          reading.initAt !== null &&
          reading.initAt !== previousInitAt);
    return upgradeRecoveryFromEvidence({
      progress,
      returned,
      verdict: link === null ? { level: "unknown" } : containerVerdict(link.container),
      serverVersion: reading?.kind === "ready" ? reading.descriptor.serverVersion : undefined,
    });
  },
};

import type { ZeropsProjectFlow } from "~/zerops/projectFlows";

/** The stage that follows `main`: where a merge lands first. */
export function mainStageOf(
  flow: ZeropsProjectFlow,
): ZeropsProjectFlow["environmentInputs"][number] | undefined {
  return flow.environmentInputs.find(
    (entry) =>
      entry.tier === "stage" &&
      flow.environments.find((row) => row.id === entry.id)?.source === "main",
  );
}

import type {
  CheckpointHistory,
  CheckpointHistoryRoot,
  OrchestrationCheckpointSummary,
} from "@t3tools/contracts";

/** Compare actual interval endpoints. A root added midway has no start endpoint. */
export function workspaceHistoryRange(
  checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>,
  fromTurnCount: number,
  toTurnCount: number,
): CheckpointHistory | undefined {
  const selected = checkpoints
    .filter((c) => c.checkpointTurnCount > fromTurnCount && c.checkpointTurnCount <= toTurnCount)
    .toSorted((a, b) => a.checkpointTurnCount - b.checkpointTurnCount);
  const end = selected.at(-1)?.history;
  if (!end) return undefined;
  if (selected.length === 1 && toTurnCount === fromTurnCount + 1) return end;
  const start =
    selected[0]?.checkpointTurnCount === fromTurnCount + 1 ? selected[0].history : undefined;
  const roots = new Map<string, CheckpointHistoryRoot>();
  for (const checkpoint of selected)
    for (const entry of checkpoint.history?.roots ?? []) roots.set(entry.root.rootId, entry);
  const entries = [...roots.values()].map((entry): CheckpointHistoryRoot => {
    const before =
      start && start.policyVersion !== end.policyVersion
        ? {
            status: "unsupported" as const,
            reason: "Capture selection policies differ across this range.",
          }
        : (start?.roots.find((r) => r.root.rootId === entry.root.rootId)?.before ?? {
            status: "missing-baseline",
            reason: "This source has no captured start for the requested range.",
          });
    const after = end.roots.find((r) => r.root.rootId === entry.root.rootId)?.after ?? {
      status: "missing-end",
      reason: "This source has no captured end for the requested range.",
    };
    return { root: entry.root, before, after };
  });
  const complete =
    selected.length === toTurnCount - fromTurnCount &&
    selected.every(
      (c) => c.history?.coverage === "complete" && c.history.policyVersion === end.policyVersion,
    );
  return {
    ...end,
    roots: entries,
    runId: `range:${start?.runId ?? "unknown"}:${end.runId}`,
    coverage:
      complete &&
      entries.every((r) => r.before.status === "captured" && r.after.status === "captured")
        ? "complete"
        : "partial",
  };
}

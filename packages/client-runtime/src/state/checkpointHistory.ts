import type {
  CheckpointHistory,
  CheckpointHistoryRoot,
  CheckpointDiffRootResult,
} from "@t3tools/contracts";

export function checkpointHistoryNotice(
  history: Pick<CheckpointHistory, "coverage"> | undefined,
): string {
  if (!history) return "Coverage of this older history is unknown.";
  if (history.coverage !== "complete")
    return "History is incomplete. Recorded file counts cover available snapshots only.";
  return "Observed workspace changes between snapshots; other writers may be included.";
}

export function checkpointRootNotice(entry: CheckpointHistoryRoot): string {
  if (entry.before.status !== "captured") return entry.before.reason;
  if (entry.after.status !== "captured") return entry.after.reason;
  return "Snapshots recorded. Detail depends on the service and retained objects.";
}

export function checkpointDiffNotice(
  roots: ReadonlyArray<CheckpointDiffRootResult> | undefined,
): string | null {
  const unavailable = roots?.filter((root) => root.status !== "available" || root.truncated);
  return unavailable?.length
    ? unavailable
        .map(
          (root) =>
            `${root.label}: ${root.reason ?? (root.truncated ? "Only part of this diff is shown." : "Diff unavailable.")}`,
        )
        .join(" ")
    : null;
}

/** Empty text proves no changes only when the requested comparison succeeded. */
export function checkpointDetailState(
  data: {
    readonly diff: string;
    readonly coverage?: CheckpointHistory["coverage"];
    readonly roots?: ReadonlyArray<CheckpointDiffRootResult>;
  } | null,
  error: string | null,
  pending: boolean,
): {
  readonly kind: "changes" | "empty" | "loading" | "unavailable";
  readonly message: string | null;
} {
  if (data?.diff.trim())
    return { kind: "changes", message: error ?? checkpointDiffNotice(data.roots) };
  if (error) return { kind: "unavailable", message: error };
  if (pending) return { kind: "loading", message: null };
  const notice = checkpointDiffNotice(data?.roots);
  if (notice) return { kind: "unavailable", message: notice };
  if (data?.coverage === "complete")
    return { kind: "empty", message: "No changes between these snapshots." };
  return {
    kind: "unavailable",
    message:
      data?.coverage === "partial"
        ? "No patch is available for the missing parts of this history."
        : "No recorded patch. Coverage of this older history is unknown.",
  };
}

/** An older server may ignore the root selector and return an aggregate patch. */
export function checkpointRootResponseError(
  data: { readonly roots?: ReadonlyArray<CheckpointDiffRootResult> } | null,
  rootId: string | undefined,
): string | null {
  if (!data || rootId === undefined) return null;
  return data.roots?.length === 1 && data.roots[0]?.rootId === rootId
    ? null
    : "This server did not provide a comparison for the requested service.";
}

export function legacyCheckpointDiffNotice(
  data: { readonly roots?: ReadonlyArray<CheckpointDiffRootResult> } | null,
): string | null {
  if (!data) return null;
  const coverage =
    data.roots === undefined
      ? "Coverage of this older history is unknown."
      : "Service membership for this older history is inferred; coverage is unknown.";
  const unavailable = checkpointDiffNotice(data.roots);
  return unavailable ? `${coverage} ${unavailable}` : coverage;
}

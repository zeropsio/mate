/**
 * What a commit's page on the Git tab shows for the read of its changes
 * (`review.getDiffPreview` with `commit`), decided apart from drawing it.
 */
import type { ReviewDiffPreviewResult, ReviewDiffPreviewSource } from "@t3tools/contracts";

export type CommitChangesState =
  | { readonly kind: "loading" }
  | { readonly kind: "changes"; readonly source: ReviewDiffPreviewSource }
  | { readonly kind: "empty" }
  /** The checkout holds no such commit: rewritten, or never fetched there. */
  | { readonly kind: "absent" }
  /** The Mate's server answered with its branch and working tree: it cannot read one commit. */
  | { readonly kind: "needs-update" }
  | { readonly kind: "failed"; readonly message: string };

export function commitChangesState(
  query: {
    readonly data: ReviewDiffPreviewResult | null;
    readonly error: string | null;
    readonly isPending: boolean;
  },
  sha: string,
): CommitChangesState {
  const data = query.data;
  if (data === null) {
    if (query.error !== null) return { kind: "failed", message: query.error };
    return { kind: "loading" };
  }
  const source = data.sources.find(
    (candidate) =>
      candidate.id === "commit" &&
      candidate.headRef !== null &&
      (candidate.headRef.startsWith(sha) || sha.startsWith(candidate.headRef)),
  );
  if (source !== undefined) {
    const nothing = source.diff.trim().length === 0 && (source.files?.length ?? 0) === 0;
    return nothing ? { kind: "empty" } : { kind: "changes", source };
  }
  return data.sources.length === 0 ? { kind: "absent" } : { kind: "needs-update" };
}

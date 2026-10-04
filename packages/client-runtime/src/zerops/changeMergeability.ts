/**
 * Whether a change merges into `main`, in the four words every surface keys its answer on — the
 * Git tab, a change's row, the review, the next step. HQ is the authority: a change's record says
 * it as HQ last judged it (`MergeabilityKind` in `@t3tools/shared/hqChanges`), and its detail as it
 * is now (`Mergeability`). Nothing here recomputes whether a branch merges, it only names what HQ
 * said.
 *
 * Pure (rule R1).
 *
 * @module changeMergeability
 */
import type {
  Mergeability,
  MergeabilityKind as HqMergeabilityKind,
} from "@t3tools/shared/hqChanges";

/**
 * - `checking`: not said yet;
 * - `mergeable`: it merges cleanly;
 * - `conflicting`: it does not — a conflict, or a branch that shares no history with `main`;
 * - `empty`: there is nothing in it `main` does not have.
 */
export type MergeabilityKind = "checking" | "mergeable" | "conflicting" | "empty";

/** HQ's word on a change, from its record or its detail, in those words. */
export function mergeabilityKindOf(
  kind: HqMergeabilityKind | Mergeability["kind"],
): MergeabilityKind {
  switch (kind) {
    case "unknown":
      return "checking";
    case "clean":
      return "mergeable";
    case "conflict":
    case "unrelated":
      return "conflicting";
    case "empty":
    case "already_merged":
    case "no_change":
      return "empty";
  }
}

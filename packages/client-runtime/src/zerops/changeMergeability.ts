/**
 * Whether a change merges into `main`, in the four words every surface keys its answer on — the
 * Git tab, a change's row, the review, the next step. HQ is the authority (`Mergeability` in
 * `@t3tools/shared/hqChanges`, its git layer's own judgement): nothing here recomputes whether a
 * branch merges.
 *
 * - `checking`: not said yet;
 * - `mergeable`: it merges cleanly;
 * - `conflicting`: it does not — a conflict, or a branch that shares no history with `main`;
 * - `empty`: there is nothing in it `main` does not have.
 *
 * @module changeMergeability
 */
export type MergeabilityKind = "checking" | "mergeable" | "conflicting" | "empty";

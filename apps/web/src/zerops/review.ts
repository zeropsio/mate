/**
 * Review: the one door to merging, landing, releasing and rolling back.
 *
 * The same act had five doors that behaved differently: the menu and a
 * change's page asked before merging, the "waiting on you to merge" banner,
 * the projects page and the Git tab merged on one click, rolling production
 * back asked nothing, and nowhere could a pull request's diff be read before
 * merging it. So every change, crew task and release now says *Review*, and
 * every one of those words opens the same surface, which carries the verb:
 * Merge, Land, Release or Roll back. Nothing moves from a row.
 *
 * This is the seam the surfaces call; the review's provider answers it.
 * Outside a provider (a harness, a test) opening a review does nothing.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { createContext, useContext } from "react";

export type ReviewTarget =
  /** A pull request into a project's group repository. */
  | {
      readonly kind: "change";
      readonly groupId: string;
      readonly repository: string;
      readonly number: number;
    }
  /** What production would get from main: the next release. */
  | { readonly kind: "release"; readonly groupId: string }
  /** Production back to an earlier release, named by its tag. */
  | { readonly kind: "rollback"; readonly groupId: string; readonly tag: string }
  /** A crew task ready to land into its Mate's work. */
  | {
      readonly kind: "crew-task";
      readonly environmentId: EnvironmentId;
      readonly taskId: string;
    };

export interface OpenReviewOptions {
  /** What was pressed: the review opens from it, and focus returns to it. */
  readonly from?: HTMLElement | null | undefined;
}

export type OpenReview = (target: ReviewTarget, options?: OpenReviewOptions) => void;

const NO_REVIEW: OpenReview = () => {};

export const ReviewContext = createContext<OpenReview>(NO_REVIEW);

export function useOpenReview(): OpenReview {
  return useContext(ReviewContext);
}

/** One key per thing under review, so two doors to it open one review. */
export function reviewTargetKey(target: ReviewTarget): string {
  switch (target.kind) {
    case "change":
      return `change:${target.groupId}:${target.repository}#${String(target.number)}`;
    case "release":
      return `release:${target.groupId}`;
    case "rollback":
      return `rollback:${target.groupId}:${target.tag}`;
    case "crew-task":
      return `crew-task:${target.environmentId}:${target.taskId}`;
  }
}

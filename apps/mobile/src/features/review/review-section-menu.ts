import type { ReviewSectionItem } from "./reviewModel";

export interface ReviewSectionMenu {
  readonly workingTree: ReviewSectionItem | null;
  readonly branchChanges: ReviewSectionItem | null;
}

export function buildReviewSectionMenu(
  sections: ReadonlyArray<ReviewSectionItem>,
): ReviewSectionMenu {
  return {
    workingTree: sections.find((section) => section.kind === "working-tree") ?? null,
    branchChanges: sections.find((section) => section.kind === "branch-range") ?? null,
  };
}

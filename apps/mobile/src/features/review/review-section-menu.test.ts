import { describe, expect, it } from "vite-plus/test";

import type { ReviewSectionItem, ReviewSectionKind } from "./reviewModel";
import { buildReviewSectionMenu } from "./review-section-menu";

function section(id: string, kind: ReviewSectionKind): ReviewSectionItem {
  return {
    id,
    kind,
    title: id,
    subtitle: null,
    diff: null,
    isLoading: false,
  };
}

describe("buildReviewSectionMenu", () => {
  it("exposes the working tree and the branch's changes at the top level", () => {
    const workingTree = section("git:working-tree", "working-tree");
    const branchChanges = section("git:branch-range", "branch-range");

    expect(buildReviewSectionMenu([workingTree, branchChanges])).toEqual({
      workingTree,
      branchChanges,
    });
  });

  it("keeps unavailable scopes empty while data loads", () => {
    expect(buildReviewSectionMenu([])).toEqual({
      workingTree: null,
      branchChanges: null,
    });
  });
});

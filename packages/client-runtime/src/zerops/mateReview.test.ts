import { describe, expect, it } from "vite-plus/test";

import { mateReviewOffer } from "./mateReview.ts";
import type { FlowPullRequest } from "./projectFlow.ts";

function pull(overrides: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 4,
    title: "Add a due date to each todo.",
    kind: "code",
    mateProjectId: "p-iris",
    author: "mate-p-iris",
    url: "https://gitea.example/notes/appdev/pulls/4",
    checks: "neutral",
    checkWord: undefined,
    mergeable: true,
    headSha: "abc",
    baseBranch: "main",
    line: "appdev #4",
    updatedAt: undefined,
    ...overrides,
  };
}

describe("what a Mate's conversation offers to merge", () => {
  it("is the Mate's own request, named after the Mate", () => {
    const offer = mateReviewOffer({
      pullRequests: [pull(), pull({ number: 9, mateProjectId: "p-other" })],
      mateProjectId: "p-iris",
      mateName: "Iris",
    });
    expect(offer?.pull.number).toBe(4);
    expect(offer?.title).toBe("Iris is waiting on you to merge #4.");
  });

  it.each([
    { name: "a request Gitea will not merge", pulls: [pull({ mergeable: false })] },
    {
      name: "the group's recipe, which is not this Mate's work",
      pulls: [pull({ kind: "recipe" })],
    },
    { name: "another Mate's", pulls: [pull({ mateProjectId: "p-other" })] },
    { name: "a person's own branch", pulls: [pull({ mateProjectId: undefined })] },
    { name: "nothing open", pulls: [] },
  ])("offers nothing for $name", ({ pulls }) => {
    expect(
      mateReviewOffer({ pullRequests: pulls, mateProjectId: "p-iris", mateName: "Iris" }),
    ).toBeUndefined();
  });

  it("offers nothing where the conversation is not a Mate's", () => {
    expect(
      mateReviewOffer({ pullRequests: [pull()], mateProjectId: undefined, mateName: undefined }),
    ).toBeUndefined();
  });

  it("takes the newest where a Mate somehow has two, so the row does not flicker", () => {
    const offer = mateReviewOffer({
      pullRequests: [pull({ number: 4 }), pull({ number: 7 })],
      mateProjectId: "p-iris",
      mateName: undefined,
    });
    expect(offer?.pull.number).toBe(7);
    expect(offer?.title).toBe("This Mate is waiting on you to merge #7.");
  });
});

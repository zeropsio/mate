import { describe, expect, it } from "vite-plus/test";

import { mateNextStep } from "./mateNextStep.ts";
import type { FlowPullRequest } from "./projectFlow.ts";

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "app",
    number: 1,
    title: "Greet with a fuller line",
    kind: "code",
    mateProjectId: "p-wren",
    author: "mate-p-wren",
    url: undefined,
    checks: "none",
    checkWord: undefined,
    mergeability: "mergeable",
    merged: false,
    mergedAt: undefined,
    headSha: "abc",
    baseBranch: "main",
    line: "app #1",
    updatedAt: undefined,
    ...over,
  };
}

describe("mateNextStep", () => {
  it("offers the Mate's own mergeable pull request (sm-fixture)", () => {
    expect(
      mateNextStep({ pullRequests: [pull()], mateProjectId: "p-wren", mateName: "Wren" }),
    ).toEqual({
      kind: "merge",
      pull: pull(),
      title: "Wren is waiting on you to merge #1.",
      verb: "Merge",
      running: "Merging…",
    });
  });

  it("offers the newest where the Mate has two, so the banner is stable", () => {
    const step = mateNextStep({
      pullRequests: [pull({ number: 4 }), pull({ number: 7 }), pull({ number: 5 })],
      mateProjectId: "p-wren",
      mateName: "Wren",
    });
    expect(step.kind === "merge" ? step.pull.number : undefined).toBe(7);
  });

  it("names the Mate as this Mate where its name is not known", () => {
    const step = mateNextStep({
      pullRequests: [pull()],
      mateProjectId: "p-wren",
      mateName: undefined,
    });
    expect(step.kind === "merge" ? step.title : undefined).toBe(
      "This Mate is waiting on you to merge #1.",
    );
  });

  // A release carries every Mate's merges and production is the project's:
  // both stay on the left, with the project, so the conversation reads only
  // the open changes and offers nothing else.
  it.each([
    { case: "a Mate with no open change (testzcp)", pullRequests: [], mate: "p-rune" },
    { case: "another Mate's change", pullRequests: [pull()], mate: "p-juno" },
    {
      case: "its own change that does not merge",
      pullRequests: [pull({ mergeability: "conflicting", checks: "failing" })],
      mate: "p-wren",
    },
    {
      case: "its own change Gitea is still checking",
      pullRequests: [pull({ mergeability: "checking" })],
      mate: "p-wren",
    },
    {
      case: "its own landed change Gitea still calls mergeable",
      pullRequests: [pull({ merged: true })],
      mate: "p-wren",
    },
    {
      case: "a recipe change of its own",
      pullRequests: [pull({ repository: "group", kind: "recipe" })],
      mate: "p-wren",
    },
    { case: "a project not read yet", pullRequests: undefined, mate: "p-wren" },
    { case: "a conversation that is no Mate's", pullRequests: [pull()], mate: undefined },
  ])("offers nothing for $case", ({ pullRequests, mate }) => {
    expect(mateNextStep({ pullRequests, mateProjectId: mate, mateName: "Wren" })).toEqual({
      kind: "none",
    });
  });
});

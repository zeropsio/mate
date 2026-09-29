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
  // The composer's top (C3): what waits on the person, in the Mate's words,
  // and the one door to it — Review. Nothing merges from here.
  it.each<{
    readonly case: string;
    readonly pullRequests: ReadonlyArray<FlowPullRequest> | undefined;
    readonly mate: string | undefined;
    readonly mateName: string | undefined;
    readonly step:
      | { readonly title: string; readonly detail: string; readonly number: number }
      | "none";
  }>([
    {
      case: "its own change, waiting for the person's review",
      pullRequests: [pull()],
      mate: "p-wren",
      mateName: "Wren",
      step: {
        title: "Wren is waiting for your review of #1",
        detail: "Greet with a fuller line",
        number: 1,
      },
    },
    {
      case: "the newest where it has two, so the strip is stable",
      pullRequests: [pull({ number: 4 }), pull({ number: 7, title: "Seven" }), pull({ number: 5 })],
      mate: "p-wren",
      mateName: "Wren",
      step: { title: "Wren is waiting for your review of #7", detail: "Seven", number: 7 },
    },
    {
      case: "a Mate whose name is not known yet",
      pullRequests: [pull()],
      mate: "p-wren",
      mateName: undefined,
      step: {
        title: "This Mate is waiting for your review of #1",
        detail: "Greet with a fuller line",
        number: 1,
      },
    },
    // A release carries every Mate's merges and production is the project's:
    // both stay on the left, with the project, so the conversation reads only
    // this Mate's open changes.
    {
      case: "nothing waiting (testzcp)",
      pullRequests: [],
      mate: "p-rune",
      mateName: "Rune",
      step: "none",
    },
    {
      case: "another Mate's change",
      pullRequests: [pull()],
      mate: "p-juno",
      mateName: "Juno",
      step: "none",
    },
    {
      case: "its own change that does not merge",
      pullRequests: [pull({ mergeability: "conflicting", checks: "failing" })],
      mate: "p-wren",
      mateName: "Wren",
      step: "none",
    },
    {
      case: "its own change Gitea is still checking",
      pullRequests: [pull({ mergeability: "checking" })],
      mate: "p-wren",
      mateName: "Wren",
      step: "none",
    },
    {
      case: "its own landed change Gitea still calls mergeable",
      pullRequests: [pull({ merged: true })],
      mate: "p-wren",
      mateName: "Wren",
      step: "none",
    },
    {
      case: "a recipe change of its own",
      pullRequests: [pull({ repository: "group", kind: "recipe" })],
      mate: "p-wren",
      mateName: "Wren",
      step: "none",
    },
    {
      case: "a project not read yet",
      pullRequests: undefined,
      mate: "p-wren",
      mateName: "Wren",
      step: "none",
    },
    {
      case: "a conversation that is no Mate's",
      pullRequests: [pull()],
      mate: undefined,
      mateName: "Wren",
      step: "none",
    },
  ])("$case", ({ pullRequests, mate, mateName, step }) => {
    const next = mateNextStep({ pullRequests, mateProjectId: mate, mateName });
    expect(
      next.kind === "review"
        ? { title: next.title, detail: next.detail, number: next.pull.number }
        : next.kind,
    ).toEqual(step);
  });
});

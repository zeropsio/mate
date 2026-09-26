import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";

import type { ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import { zeropsNextStepBannerItem, type ZeropsNextStepPending } from "./ZeropsNextStepBanner";

const PULL: FlowPullRequest = {
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
};

function nextStep(over: Partial<ZeropsMateNextStep>): ZeropsMateNextStep {
  return {
    step: { kind: "none" },
    running: false,
    trouble: null,
    merge: () => undefined,
    ...over,
  };
}

const MERGE: ZeropsMateNextStep["step"] = {
  kind: "merge",
  pull: PULL,
  title: "Wren is waiting on you to merge #1.",
  verb: "Merge",
  running: "Merging…",
};

const NOTHING_PENDING: ZeropsNextStepPending = { question: false, approval: false };

describe("zeropsNextStepBannerItem", () => {
  it("offers this Mate's merge under the pull request's title", () => {
    const item = zeropsNextStepBannerItem(nextStep({ step: MERGE }), NOTHING_PENDING);
    expect(item).toMatchObject({
      id: "mate-next-step:merge:app#1",
      variant: "info",
      title: "Wren is waiting on you to merge #1.",
      description: "Greet with a fuller line",
    });
    expect(renderToStaticMarkup(<>{item?.actions}</>)).toContain(">Merge<");
  });

  it("says a refusal in its own words and takes no second click while the verb runs", () => {
    const item = zeropsNextStepBannerItem(
      nextStep({ step: MERGE, trouble: "Gitea: not mergeable", running: true }),
      NOTHING_PENDING,
    );
    expect(item).toMatchObject({ variant: "error", description: "Gitea: not mergeable" });
    const html = renderToStaticMarkup(<>{item?.actions}</>);
    expect(html).toContain(">Merging…<");
    expect(html).toContain("disabled");
  });

  it("draws nothing where the flow asks nothing of this conversation", () => {
    expect(zeropsNextStepBannerItem(nextStep({}), NOTHING_PENDING)).toBeNull();
  });

  // The Mate cannot go on until the person answers what the composer asks, so
  // the merge is not a second ask stacked on it; it comes back with the answer.
  it.each<{
    readonly pending: ZeropsNextStepPending;
    readonly over: Partial<ZeropsMateNextStep>;
    readonly asked: string;
    readonly merge: "held back" | "offered";
  }>([
    {
      asked: "a question waits on the person",
      pending: { question: true, approval: false },
      over: {},
      merge: "held back",
    },
    {
      asked: "an approval waits on the person",
      pending: { question: false, approval: true },
      over: {},
      merge: "held back",
    },
    {
      asked: "a question and an approval wait on the person",
      pending: { question: true, approval: true },
      over: {},
      merge: "held back",
    },
    {
      asked: "a question waits over a refused merge",
      pending: { question: true, approval: false },
      over: { trouble: "Gitea: not mergeable" },
      merge: "held back",
    },
    {
      asked: "an approval waits over a merge in flight",
      pending: { question: false, approval: true },
      over: { running: true },
      merge: "held back",
    },
    {
      asked: "the question is answered",
      pending: NOTHING_PENDING,
      over: {},
      merge: "offered",
    },
  ])("$asked: the merge is $merge", ({ pending, over, merge }) => {
    const item = zeropsNextStepBannerItem(nextStep({ step: MERGE, ...over }), pending);
    expect(item === null ? "held back" : "offered").toBe(merge);
  });
});

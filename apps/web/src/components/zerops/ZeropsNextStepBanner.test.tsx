import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";

import type { ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import { zeropsNextStepBannerItem } from "./ZeropsNextStepBanner";

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

describe("zeropsNextStepBannerItem", () => {
  it("offers this Mate's merge under the pull request's title", () => {
    const item = zeropsNextStepBannerItem(nextStep({ step: MERGE }));
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
    );
    expect(item).toMatchObject({ variant: "error", description: "Gitea: not mergeable" });
    const html = renderToStaticMarkup(<>{item?.actions}</>);
    expect(html).toContain(">Merging…<");
    expect(html).toContain("disabled");
  });

  it("draws nothing where the flow asks nothing of this conversation", () => {
    expect(zeropsNextStepBannerItem(nextStep({}))).toBeNull();
  });
});

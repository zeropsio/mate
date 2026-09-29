import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import type { ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import hookSource from "../../zerops/useZeropsMateNextStep.ts?raw";
import stripSource from "./ZeropsNextStepBanner.tsx?raw";
import {
  ZeropsNextStepStrip,
  zeropsNextStepStrip,
  type ZeropsNextStepPending,
  type ZeropsNextStepStripModel,
} from "./ZeropsNextStepBanner";

const PULL: FlowPullRequest = {
  repository: "app",
  number: 2,
  title: "Add a status page",
  kind: "code",
  mateProjectId: "p-nova",
  author: "mate-p-nova",
  url: undefined,
  checks: "passing",
  checkWord: "Passed",
  mergeability: "mergeable",
  merged: false,
  mergedAt: undefined,
  headSha: "abc",
  baseBranch: "main",
  line: "app #2",
  updatedAt: undefined,
};

const WAITING: ZeropsMateNextStep = {
  kind: "review",
  step: {
    kind: "review",
    pull: PULL,
    title: "Nova is waiting for your review of #2",
    detail: "Add a status page",
  },
  tint: "slate",
  target: { kind: "change", groupId: "g-1", repository: "app", number: 2 },
};

const NOTHING_PENDING: ZeropsNextStepPending = { question: false, approval: false };

describe("zeropsNextStepStrip", () => {
  it.each<{
    readonly case: string;
    readonly nextStep: ZeropsMateNextStep;
    readonly pending: ZeropsNextStepPending;
    readonly words: { readonly title: string; readonly detail: string } | null;
  }>([
    {
      case: "a change of this Mate's waits for review",
      nextStep: WAITING,
      pending: NOTHING_PENDING,
      words: { title: "Nova is waiting for your review of #2", detail: "Add a status page" },
    },
    { case: "nothing waits", nextStep: { kind: "none" }, pending: NOTHING_PENDING, words: null },
    // The Mate cannot go on until the person answers what the composer asks,
    // so the review is not a second ask stacked on it; it comes back after.
    {
      case: "a question waits on the person first",
      nextStep: WAITING,
      pending: { question: true, approval: false },
      words: null,
    },
    {
      case: "an approval waits on the person first",
      nextStep: WAITING,
      pending: { question: false, approval: true },
      words: null,
    },
    {
      case: "a question and an approval wait on the person first",
      nextStep: WAITING,
      pending: { question: true, approval: true },
      words: null,
    },
  ])("$case", ({ nextStep, pending, words }) => {
    const strip = zeropsNextStepStrip(nextStep, pending);
    expect(strip === null ? null : { title: strip.title, detail: strip.detail }).toEqual(words);
  });
});

describe("ZeropsNextStepStrip", () => {
  const STRIP = zeropsNextStepStrip(WAITING, NOTHING_PENDING) as ZeropsNextStepStripModel;

  it("reads as the composer's top: the Mate's face asking, the words, Review", () => {
    const markup = renderToStaticMarkup(<ZeropsNextStepStrip onReview={() => {}} strip={STRIP} />);

    expect(markup).toContain('data-composer-top="review"');
    expect(markup).toContain("Nova is waiting for your review of #2");
    expect(markup).toContain("Add a status page");
    expect(markup).toContain(">Review<");
    expect(markup).not.toContain("Merge");
  });

  it("opens the change's review from the button that was pressed", () => {
    const onReview = vi.fn();
    const tree = ZeropsNextStepStrip({ onReview, strip: STRIP }) as ReactElement;
    const button = visitElements(tree, (element) => element.type === "button");
    if (button === null) throw new Error("the strip has no Review button");
    const pressed = { tagName: "BUTTON" } as unknown as HTMLElement;
    (button.props.onClick as (event: { currentTarget: HTMLElement }) => void)({
      currentTarget: pressed,
    });

    expect(onReview).toHaveBeenCalledWith(
      { kind: "change", groupId: "g-1", repository: "app", number: 2 },
      pressed,
    );
  });

  // Nothing merges from the composer any more (R1): the strip and the hook
  // behind it read the project's flow and open the review, whose own button
  // merges after the change can be read.
  it.each([
    { file: "ZeropsNextStepBanner.tsx", source: stripSource, reads: "openReview(target" },
    { file: "useZeropsMateNextStep.ts", source: hookSource, reads: "mateNextStep({" },
  ])("$file has no path that merges", ({ source, reads }) => {
    expect(source).toContain(reads);
    expect(source).not.toMatch(/mergePullRequest|flowVerbKey|\.merge\b|merge:/);
  });
});

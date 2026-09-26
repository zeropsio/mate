/**
 * The one next step this Mate's conversation offers, as a composer banner,
 * right where the person is reading its answer: the merge of this Mate's own
 * change (the owner, 2026-09-18), from the project's flow rather than from
 * what the agent said (2026-09-23). A release and a production are the
 * project's, never one Mate's, and stay on the left (2026-09-26).
 *
 * Kept out of `ChatView.tsx`, which is upstream-shaped: the conversation
 * takes one banner item from here and stacks it with its own.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { GitBranchIcon } from "lucide-react";
import { useMemo } from "react";

import { useZeropsMateNextStep, type ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import type { ComposerBannerStackItem } from "../chat/ComposerBannerStack";
import { Button } from "../ui/button";

/** The banner for `nextStep`, or `null` where the flow asks nothing of this conversation. */
export function zeropsNextStepBannerItem(
  nextStep: ZeropsMateNextStep,
): ComposerBannerStackItem | null {
  const { step, trouble } = nextStep;
  if (step.kind !== "merge") return null;
  return {
    id: `mate-next-step:merge:${step.pull.repository}#${step.pull.number}`,
    variant: trouble === null ? "info" : "error",
    icon: <GitBranchIcon />,
    title: step.title,
    description: trouble ?? step.pull.title,
    actions: (
      <Button disabled={nextStep.running} size="xs" onClick={nextStep.merge}>
        {nextStep.running ? step.running : step.verb}
      </Button>
    ),
  };
}

/** This conversation's next-step banner, its merge wired. */
export function useZeropsNextStepBanner(
  threadRef: ScopedThreadRef | null,
): ComposerBannerStackItem | null {
  const nextStep = useZeropsMateNextStep(threadRef);
  return useMemo(() => zeropsNextStepBannerItem(nextStep), [nextStep]);
}

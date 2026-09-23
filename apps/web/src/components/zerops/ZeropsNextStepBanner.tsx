/**
 * The one next step this Mate's conversation offers, as a composer banner,
 * right where the person is reading its answer, from the project's flow
 * rather than from what the agent said (the owner, 2026-09-23): merge this
 * Mate's own change (the owner, 2026-09-18, unchanged), release what is
 * already merged, or add the production a release would go to — the Mate's
 * part ends at the pull request and the recipe, so that verb only links to
 * where it lives, on the projects page.
 *
 * Kept out of `ChatView.tsx`, which is upstream-shaped: the conversation
 * takes one banner item from here and stacks it with its own.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { GitBranchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useZeropsMateNextStep, type ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import type { ComposerBannerStackItem } from "../chat/ComposerBannerStack";
import { Button } from "../ui/button";
import { ZeropsReleaseDialog } from "./ZeropsReleaseDialog";

export interface ZeropsNextStepBannerControls {
  /** Whether the release confirm dialog is open. */
  readonly confirmOpen: boolean;
  readonly setConfirmOpen: (open: boolean) => void;
  /** Opens the project on the projects page, where *Add production* lives. */
  readonly openProject: (groupId: string) => void;
}

/** The banner for `nextStep`, or `null` where the flow asks nothing of this conversation. */
export function zeropsNextStepBannerItem(
  nextStep: ZeropsMateNextStep,
  controls: ZeropsNextStepBannerControls,
): ComposerBannerStackItem | null {
  const { step, trouble } = nextStep;
  if (step.kind === "merge") {
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
  if (step.kind === "release") {
    return {
      id: `mate-next-step:release:${nextStep.groupId}`,
      variant: trouble === null ? "info" : "error",
      icon: <GitBranchIcon />,
      title: step.title,
      description:
        trouble ??
        (step.waiting === 1
          ? "1 change ready to go live."
          : `${step.waiting} changes ready to go live.`),
      actions: (
        <>
          <Button
            disabled={nextStep.running}
            size="xs"
            onClick={() => controls.setConfirmOpen(true)}
          >
            {nextStep.running ? step.running : step.verb}
          </Button>
          <ZeropsReleaseDialog
            contents={nextStep.releaseContents}
            onConfirm={() => {
              controls.setConfirmOpen(false);
              nextStep.release();
            }}
            onOpenChange={controls.setConfirmOpen}
            open={controls.confirmOpen}
            releasing={nextStep.running}
            tag={step.tag}
          />
        </>
      ),
    };
  }
  if (step.kind === "add-production") {
    return {
      id: `mate-next-step:add-production:${nextStep.groupId}`,
      variant: "info",
      icon: <GitBranchIcon />,
      title: step.title,
      description: step.detail,
      actions: (
        <Button
          size="xs"
          onClick={() => {
            if (nextStep.groupId !== undefined) controls.openProject(nextStep.groupId);
          }}
        >
          {step.verb}
        </Button>
      ),
    };
  }
  return null;
}

/** This conversation's next-step banner, its release confirm and its way to the projects page wired. */
export function useZeropsNextStepBanner(
  threadRef: ScopedThreadRef | null,
): ComposerBannerStackItem | null {
  const nextStep = useZeropsMateNextStep(threadRef);
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  return useMemo(
    () =>
      zeropsNextStepBannerItem(nextStep, {
        confirmOpen,
        setConfirmOpen,
        openProject: (groupId) => {
          void navigate({ to: "/zerops", search: { view: "projects", group: groupId } });
        },
      }),
    [confirmOpen, navigate, nextStep],
  );
}

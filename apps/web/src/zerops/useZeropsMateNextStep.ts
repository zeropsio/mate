/**
 * What this Mate's conversation offers next, from the project's flow rather
 * than from what the agent said (the owner, 2026-09-23 — "extremely important
 * findings the whole UI should be built around"): this Mate's own change,
 * waiting for the person's review, where HQ says it merges.
 *
 * It opens the review and nothing else (R1): the merge is the review's
 * button, so this reads the flow and never writes to it.
 *
 * Nothing that is the project's: a release carries every Mate's merges and
 * production is the project's to add, so both stay on the left, with the
 * project (the owner, 2026-09-26 — "merges could be coming from different
 * mates"). The pull requests are the flow's own, the same ones the left menu
 * and the projects page read, so the conversation and the page cannot
 * disagree about a change.
 */
import {
  mateNextStep,
  readZeropsMembership,
  type MateNextStep,
} from "@t3tools/client-runtime/zerops";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";

import { zeropsMateAt } from "./mateIdentities";
import { useZeropsProjectFlowOptional } from "./projectFlowContext";
import { useMateOfEnvironment } from "./accountEnvironments";
import type { ReviewTarget } from "./review";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsMateDirectory } from "./useZeropsMates";

export type ZeropsMateNextStep =
  /**
   * HQ has not answered for this Mate's project yet — nor, until it is
   * known, whose project this conversation is: the strip the conversation
   * showed last stands in (`composerTopMemory.ts`).
   */
  | { readonly kind: "unknown" }
  /** HQ answered, and nothing of this Mate's waits on the person. */
  | { readonly kind: "none" }
  | {
      readonly kind: "review";
      readonly step: Extract<MateNextStep, { kind: "review" }>;
      /** Whose change it is: the Mate's face, in its tint, once the Mate is known. */
      readonly tint: MateTintId | undefined;
      /** The shape its person picked, once the Mate is known. */
      readonly shape: MateShapeId | undefined;
      /** What Review opens. */
      readonly target: Extract<ReviewTarget, { kind: "change" }>;
    };

const NOTHING: ZeropsMateNextStep = { kind: "none" };
const UNKNOWN: ZeropsMateNextStep = { kind: "unknown" };

export function useZeropsMateNextStep(threadRef: ScopedThreadRef | null): ZeropsMateNextStep {
  const flow = useZeropsProjectFlowOptional();
  const inventory = useZeropsInventory();
  const projectId = useMateOfEnvironment(threadRef?.environmentId)?.projectId;
  const mates = useZeropsMateDirectory();

  const project = inventory.projects.find((entry) => entry.id === projectId);
  const groupId = readZeropsMembership(project).groupId;
  const projectFlow = groupId === undefined ? undefined : flow?.flows.get(groupId);

  if (threadRef === null) return NOTHING;
  if (groupId === undefined || projectFlow?.changesKnown !== true) return UNKNOWN;
  const step = mateNextStep({
    pullRequests: projectFlow.pullRequests,
    mateProjectId: projectId,
    mateName: projectId === undefined ? undefined : flow?.mateNames.get(projectId),
  });
  if (step.kind === "none") return NOTHING;
  const mate = zeropsMateAt(mates, threadRef.environmentId);
  return {
    kind: "review",
    step,
    tint: mate.kind === "mate" ? mate.mate.tint : undefined,
    shape: mate.kind === "mate" ? mate.mate.shape : undefined,
    target: {
      kind: "change",
      groupId,
      repository: step.pull.repository,
      number: step.pull.number,
    },
  };
}

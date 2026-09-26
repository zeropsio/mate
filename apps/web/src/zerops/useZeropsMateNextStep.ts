/**
 * What this Mate's conversation offers next, from the project's flow rather
 * than from what the agent said (the owner, 2026-09-23 — "extremely important
 * findings the whole UI should be built around"): the merge of this Mate's
 * own change, where Gitea says it merges.
 *
 * Nothing that is the project's: a release carries every Mate's merges and
 * production is the project's to add, so both stay on the left, with the
 * project (the owner, 2026-09-26 — "merges could be coming from different
 * mates"). The pull requests are the flow's own, the same ones the left menu
 * and the projects page read, so the conversation and the page cannot
 * disagree about a change.
 */
import {
  flowVerbKey,
  mateNextStep,
  readZeropsGroupTags,
  type MateNextStep,
} from "@t3tools/client-runtime/zerops";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { useZeropsProjectFlowOptional } from "./projectFlowContext";
import { useRegistrationRecord } from "./registrationRecords";
import { useZeropsInventory } from "./ZeropsInventoryProvider";

export interface ZeropsMateNextStep {
  readonly step: MateNextStep;
  /** True while this step's own verb is in flight, so it takes no second click. */
  readonly running: boolean;
  /** What the last verb's refusal said, in Gitea's or the platform's words; `null` until one does. */
  readonly trouble: string | null;
  /** Merges `step.pull` as the person; a no-op where `step.kind` is not `"merge"`. */
  readonly merge: () => void;
}

const NOTHING: ZeropsMateNextStep = {
  step: { kind: "none" },
  running: false,
  trouble: null,
  merge: () => undefined,
};

export function useZeropsMateNextStep(threadRef: ScopedThreadRef | null): ZeropsMateNextStep {
  const flow = useZeropsProjectFlowOptional();
  const inventory = useZeropsInventory();
  const projectId = useRegistrationRecord(threadRef?.environmentId)?.projectRef?.projectId;

  const project = inventory.projects.find((entry) => entry.id === projectId);
  const groupId = readZeropsGroupTags(project?.tagList ?? []).groupId;
  const slug = groupId === undefined ? undefined : flow?.slugs.get(groupId);
  const projectFlow = groupId === undefined ? undefined : flow?.flows.get(groupId);

  const step = mateNextStep({
    pullRequests: projectFlow?.pullRequests,
    mateProjectId: projectId,
    mateName: projectId === undefined ? undefined : flow?.mateNames.get(projectId),
  });

  const merge = useCallback(() => {
    if (flow === null || flow === undefined || slug === undefined || step.kind !== "merge") return;
    void flow.mergePullRequest(slug, step.pull);
  }, [flow, slug, step]);

  if (flow === null || flow === undefined || slug === undefined || step.kind === "none")
    return NOTHING;

  return {
    step,
    running: flow.pending.has(
      flowVerbKey({
        kind: "merge",
        slug,
        repository: step.pull.repository,
        number: step.pull.number,
      }),
    ),
    trouble: flow.trouble,
    merge,
  };
}

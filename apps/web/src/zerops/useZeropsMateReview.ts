/**
 * What this Mate is waiting to have merged, for the conversation it was asked
 * in (the owner, 2026-09-18: "can the merge request have a mergable button
 * directly in the chat? which would then put its git on main where it was
 * merged").
 *
 * The Git tab has had the verb all along, in a side panel a person has to go
 * and open; the request belongs where they are already reading the Mate's
 * answer. Nothing new is read for it: the project flow already holds every
 * open pull request of the account, and which Mate each belongs to.
 *
 * Merging is Gitea's, as the person. The Mate's checkout is not the app's to
 * move: its branch takes the merged `main` in at its next delivery, which
 * merges the base in before it pushes (zcp, MB-26), so a request opened after
 * this one carries only the new work.
 */
import {
  mateReviewOffer,
  readZeropsGroupTags,
  flowVerbKey,
  type MateReviewOffer,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { lookupEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import { useCallback, useEffect, useState } from "react";

import { useZeropsProjectFlowOptional } from "./projectFlowContext";
import { browserZeropsStorage } from "./storage";
import { useZeropsInventory } from "./ZeropsInventoryProvider";

export interface ZeropsMateReview {
  readonly offer: MateReviewOffer | undefined;
  /** True while this merge is in flight, so the verb takes no second click. */
  readonly merging: boolean;
  /** What the last verb's refusal said, in Gitea's words; `null` until one does. */
  readonly trouble: string | null;
  readonly merge: () => void;
}

const NOTHING: ZeropsMateReview = {
  offer: undefined,
  merging: false,
  trouble: null,
  merge: () => undefined,
};

export function useZeropsMateReview(threadRef: ScopedThreadRef | null): ZeropsMateReview {
  const flow = useZeropsProjectFlowOptional();
  const inventory = useZeropsInventory();
  const environmentId = threadRef?.environmentId;
  const [projectId, setProjectId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (environmentId === undefined) {
      setProjectId(undefined);
      return;
    }
    let cancelled = false;
    void lookupEnvironmentProjectRef(browserZeropsStorage, environmentId as EnvironmentId).then(
      (ref) => {
        if (!cancelled) setProjectId(ref?.projectId);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  const project = inventory.projects.find((entry) => entry.id === projectId);
  const groupId = readZeropsGroupTags(project?.tagList ?? []).groupId;
  const slug = groupId === undefined ? undefined : flow?.slugs.get(groupId);
  const projectFlow = groupId === undefined ? undefined : flow?.flows.get(groupId);
  const offer = mateReviewOffer({
    pullRequests: projectFlow?.pullRequests ?? [],
    mateProjectId: projectId,
    mateName: projectId === undefined ? undefined : flow?.mateNames.get(projectId),
  });

  const merge = useCallback(() => {
    if (flow === null || slug === undefined || offer === undefined) return;
    void flow.mergePullRequest(slug, {
      repository: offer.pull.repository,
      number: offer.pull.number,
    });
  }, [flow, offer, slug]);

  if (flow === null || offer === undefined || slug === undefined) return NOTHING;
  return {
    offer,
    merging: flow.pending.has(
      flowVerbKey({
        kind: "merge",
        slug,
        repository: offer.pull.repository,
        number: offer.pull.number,
      }),
    ),
    trouble: flow.trouble,
    merge,
  };
}

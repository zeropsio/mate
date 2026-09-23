/**
 * What this Mate's conversation offers next, from the project's flow rather
 * than from what the agent said (the owner, 2026-09-23 — "extremely important
 * findings the whole UI should be built around").
 *
 * `useZeropsMateReview` only ever offered a merge; the flow can also ask for
 * a release of what is already merged, or for the production that has
 * nowhere to go yet. `mateNextStep` (`client-runtime`) picks the one step
 * from the project's `GroupFlow`, so "put it on production" gets the right
 * button beside the answer even where the agent's own answer is wrong about
 * how that happens — production is the person's to add and to release, on
 * the projects page; the Mate's part ends at the pull request and the
 * recipe.
 *
 * `GroupFlow` wants more than this conversation reads today
 * (`groupFlow.ts`'s `GroupFlowInput`): a group stage's platform state, a
 * default-branch read of `main`, and whether this viewer may still add a
 * production. Only what this step actually consults is supplied:
 *
 * - `mates: []` — `mateNextStep` never reads `GroupFlow.mates` or
 *   `GroupFlow.nextStep`; only `pullRequests` and `production` feed it, so
 *   the flow's own next-step ranking (which does read `mates`) is left
 *   unused here rather than approximated.
 * - `mainHasCode: undefined` — the default-branch read
 *   (`planMainHeadReads`) runs only for a group that already has a
 *   production, so this conversation cannot tell "no code" from "not read".
 *   `groupFlow` falls back to a merged code pull request as proof either
 *   way, which is what `mateNextStep.test.ts`'s fixtures rely on.
 * - `productionAddable` — the full gate (`ZeropsProjectsPage.tsx`'s
 *   `groupAddsOffered`, unexported, and `ZeropsGroupTree.logic.ts`'s
 *   `creatableRoles`, which needs a `ZeropsGroup` this hook does not build)
 *   is not reproduced. This only checks the viewer's own
 *   `canCreateProjects`: the tier being already taken is already excluded
 *   through `flow.missing` (`missingEnvironmentRows` drops a tier once a
 *   declared environment fills it), so the one gate left out is "some Mate
 *   in the group is up" — moot in practice, since *Add production* only
 *   shows once a code change has merged, which took a Mate being up to
 *   begin with.
 */
import {
  flowVerbKey,
  groupFlow,
  mateNextStep,
  readZeropsGroupTags,
  releaseContentsSummary,
  type FlowVerb,
  type GroupFlow,
  type GroupFlowStopInput,
  type MateNextStep,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { lookupEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useZeropsProjectFlowOptional,
  type ZeropsProjectFlow,
  type ZeropsProjectFlowValue,
} from "./projectFlowContext";
import { browserZeropsStorage } from "./storage";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

export interface ZeropsMateNextStep {
  readonly step: MateNextStep;
  readonly groupId: string | undefined;
  /** True while this step's own verb is in flight, so it takes no second click. */
  readonly running: boolean;
  /** What the last verb's refusal said, in Gitea's or the platform's words; `null` until one does. */
  readonly trouble: string | null;
  /** Merges `step.pull` as the person; a no-op where `step.kind` is not `"merge"`. */
  readonly merge: () => void;
  /** Tags `step.tag` as the person; a no-op where `step.kind` is not `"release"`. */
  readonly release: () => void;
  /** What the release confirm dialog lists — `step.kind === "release"`'s own commits. */
  readonly releaseContents: ReadonlyArray<{
    readonly commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
  }>;
}

const NOTHING: ZeropsMateNextStep = {
  step: { kind: "none" },
  groupId: undefined,
  running: false,
  trouble: null,
  merge: () => undefined,
  release: () => undefined,
  releaseContents: [],
};

/**
 * This Mate's project, read as the `GroupFlow` `mateNextStep` wants —
 * exported and pure so the assembly above is tested directly (`R1`), the way
 * `groupFlow.ts` itself is, rather than only through the hook that wires it
 * to React state.
 */
export function zeropsMateGroupFlow(
  groupId: string,
  projectFlow: ZeropsProjectFlow,
  deployments: ZeropsProjectFlowValue["deployments"],
  productionAddable: boolean,
): GroupFlow {
  const stops: ReadonlyArray<GroupFlowStopInput> = projectFlow.environments.map((row) => ({
    projectId: row.projectId,
    name: row.name,
    tier: row.tier,
    row,
    deployment: deployments.get(row.projectId),
    route: undefined,
  }));
  return groupFlow({
    groupId,
    mates: [],
    pullRequests: projectFlow.pullRequests,
    merged: projectFlow.merged,
    stops,
    missing: projectFlow.missing,
    release: {
      gate: projectFlow.release.gate,
      suggestion: projectFlow.release.suggestion,
      waiting: releaseContentsSummary(projectFlow.release.contents).total,
    },
    mainHasCode: undefined,
    mainHead: undefined,
    productionAddable,
  });
}

export function useZeropsMateNextStep(threadRef: ScopedThreadRef | null): ZeropsMateNextStep {
  const flow = useZeropsProjectFlowOptional();
  const inventory = useZeropsInventory();
  const session = useZeropsSessionOptional();
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
  const canCreateProjects = session?.activeOrganization?.canCreateProjects ?? false;

  const group = useMemo(() => {
    if (flow === null || groupId === undefined || projectFlow === undefined) return undefined;
    return zeropsMateGroupFlow(groupId, projectFlow, flow.deployments, canCreateProjects);
  }, [flow, groupId, projectFlow, canCreateProjects]);

  const step = mateNextStep({
    group,
    mateProjectId: projectId,
    mateName: projectId === undefined ? undefined : flow?.mateNames.get(projectId),
  });

  const merge = useCallback(() => {
    if (flow === null || flow === undefined || slug === undefined || step.kind !== "merge") return;
    void flow.mergePullRequest(slug, {
      repository: step.pull.repository,
      number: step.pull.number,
    });
  }, [flow, slug, step]);

  const release = useCallback(() => {
    if (flow === null || flow === undefined || groupId === undefined || step.kind !== "release")
      return;
    void flow.release(groupId);
  }, [flow, groupId, step]);

  if (flow === null || flow === undefined || groupId === undefined || step.kind === "none")
    return NOTHING;

  const verb: FlowVerb | undefined =
    step.kind === "merge"
      ? slug === undefined
        ? undefined
        : { kind: "merge", slug, repository: step.pull.repository, number: step.pull.number }
      : step.kind === "release"
        ? { kind: "release", groupId }
        : undefined;

  return {
    step,
    groupId,
    running: verb === undefined ? false : flow.pending.has(flowVerbKey(verb)),
    trouble: flow.trouble,
    merge,
    release,
    releaseContents: projectFlow?.release.contents ?? [],
  };
}

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
 * The `GroupFlow` input is the projects page's own (`groupFlowInputOf`),
 * from the same group of the same account's projects, so the conversation
 * and the page cannot disagree about a project's production. Three facts the
 * page holds and this conversation does not are left out; none reaches
 * `mateNextStep`:
 *
 * - no Mate facts (`GroupMemberFacts.mate`) and no routes or hostnames:
 *   they come from the candidates and the agent activity, and feed only
 *   `GroupFlow.mates`, a Mate's preview and a stop's link, while
 *   `mateNextStep` reads `pullRequests` and `production`.
 * - `mainHasCode` stays unread, as on the page: a merged code change is the
 *   proof either way.
 * - `productionAddable` is the page's gate (`canCreateProjectsInOrganization`
 *   and `creatableRoles`) less `groupAddsOffered` ("some Mate in the group
 *   is up"), which needs the candidates' health probes.
 *   It is moot here: *Add production* follows a merged code change, which
 *   took a Mate being up to begin with.
 */
import {
  buildZeropsGroupTree,
  canCreateProjectsInOrganization,
  environmentNameUnderGroup,
  flowVerbKey,
  groupFlow,
  mateNextStep,
  readZeropsGroupTags,
  type FlowVerb,
  type GroupFlow,
  type MateNextStep,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { lookupEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import { useCallback, useEffect, useMemo, useState } from "react";

import { creatableRoles } from "../components/zerops/ZeropsGroupTree.logic";
import {
  groupFlowInputOf,
  type GroupMemberFacts,
} from "../components/zerops/projects/projectsView.logic";
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
export function zeropsMateGroupFlow(input: {
  readonly groupId: string;
  /** The account's projects, as the inventory lists them. */
  readonly projects: ReadonlyArray<ZeropsProject>;
  readonly projectFlow: ZeropsProjectFlow;
  readonly deployments: ZeropsProjectFlowValue["deployments"];
  /** Whether this viewer may create a project (`canCreateProjectsInOrganization`). */
  readonly mayCreate: boolean;
}): GroupFlow {
  const tree = buildZeropsGroupTree(
    input.projects.map((project) => ({ project })),
    { order: "name" },
  );
  const group = tree.groups.find((entry) => entry.group.groupId === input.groupId);
  const members: ReadonlyArray<GroupMemberFacts> = (group?.environments ?? []).map(
    ({ item, role }) => ({
      projectId: item.project.id,
      role,
      name: environmentNameUnderGroup(
        readZeropsGroupTags(item.project.tagList).label,
        item.project.name,
      ),
      mate: undefined,
      routes: [],
      hostnames: [],
    }),
  );
  return groupFlow(
    groupFlowInputOf({
      groupId: input.groupId,
      members,
      flow: input.projectFlow,
      deployments: input.deployments,
      productionAddable:
        input.mayCreate && group !== undefined && creatableRoles(group.group).includes("prod"),
    }),
  );
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
  const activeOrganization = session?.activeOrganization;
  const mayCreate =
    activeOrganization === undefined || activeOrganization === null
      ? false
      : canCreateProjectsInOrganization(activeOrganization);

  const group = useMemo(() => {
    if (flow === null || groupId === undefined || projectFlow === undefined) return undefined;
    return zeropsMateGroupFlow({
      groupId,
      projects: inventory.projects,
      projectFlow,
      deployments: flow.deployments,
      mayCreate,
    });
  }, [flow, groupId, inventory.projects, projectFlow, mayCreate]);

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

/**
 * What the left menu's stop rows measure themselves by, derived from one
 * project's flow as the provider holds it (`ZeropsProjectFlow`) — so the tree
 * is handed numbers, not the reads they come from.
 *
 * Nothing here reads anything: `main`'s heads, what each service runs and the
 * changes waiting are already in the flow, and each stop is placed among them
 * (`stopDistance.ts`, the owner, 2026-09-25).
 */
import {
  productionDistance,
  releaseDeploys,
  stageDistance,
  stageMarks,
  stageStandings,
  type EnvironmentRow,
  type GroupEnvironmentRowInput,
  type ServiceChanges,
  type StageMark,
  type StopDistance,
} from "@t3tools/client-runtime/zerops";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";

/** What the tree needs to say how far each stop is from `main`. */
export interface SidebarStopReads {
  /** By Zerops project id; a stop nothing places is absent — shown as nothing, never guessed. */
  readonly distances: ReadonlyMap<string, StopDistance>;
  /** Where each change production does not run stands on the stage, by lower-case sha. */
  readonly stageMarks: ReadonlyMap<string, StageMark>;
}

/**
 * Each stop's distance from `main`, and the marks the list under production
 * wears. The stage the marks are read from is the first that follows `main`
 * and nothing else: a branch-fed stage runs work `main` does not have, so
 * whether it ran a change says nothing about the change on `main`.
 */
export function sidebarStopReads(input: {
  readonly flow: {
    readonly environmentInputs: ReadonlyArray<GroupEnvironmentRowInput>;
    readonly environments: ReadonlyArray<EnvironmentRow>;
    readonly mainHeads: ReadonlyMap<string, string>;
    readonly release: { readonly contents: ReadonlyArray<ServiceChanges> };
  };
  readonly deployments: ReadonlyMap<string, Shown<Deployment>> | undefined;
}): SidebarStopReads {
  const { flow, deployments } = input;
  const contents = flow.release.contents;
  const { mainHeads } = flow;
  const production = releaseDeploys(flow.environmentInputs).production;
  const sourceOf = (projectId: string) =>
    flow.environments.find((row) => row.projectId === projectId)?.source;
  const distances = new Map<string, StopDistance>();
  let marked: ReturnType<typeof stageStandings> | undefined;
  for (const environment of flow.environmentInputs) {
    const { projectId } = environment;
    if (environment.tier === "production") {
      const distance = productionDistance({ contents, mainHeads });
      if (distance !== undefined) distances.set(projectId, distance);
      continue;
    }
    const source = sourceOf(projectId);
    const standings = stageStandings({ environment, deployment: deployments?.get(projectId) });
    if (source === "main" && marked === undefined) marked = standings;
    const distance = stageDistance({
      source,
      stage: standings.runs,
      mainHeads,
      production,
      contents,
    });
    if (distance !== undefined) distances.set(projectId, distance);
  }
  return {
    distances,
    stageMarks: stageMarks({ contents, mainHeads, stage: marked }),
  };
}

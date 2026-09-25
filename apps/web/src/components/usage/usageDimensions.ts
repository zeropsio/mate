/**
 * Who spent the usage: the Mate (one environment) is the atom; a person (the
 * Mate's owner) and a project (the left menu's group) are rollups of the
 * merge's per-environment totals.
 *
 * A dimension is shown only when it tells two things apart: it is visible when
 * the environments with activity carry at least two distinct values of it. One
 * Mate therefore sees the page it always had.
 *
 * @module usageDimensions
 */
import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentTotals } from "@t3tools/shared/usageMerge";

import type {
  UsageEnvironmentIdentities,
  UsageEnvironmentOwner,
} from "../../zerops/usageEnvironmentIdentities";

export type UsageDimensionMetric = "cost" | "tokens";
export type UsageDimension = "person" | "project" | "mate";

/** The Usage page's scope, as the `/usage` search params carry it. */
export interface UsageScope {
  /** An owner's `UsageEnvironmentOwner.id`. */
  readonly person?: string | undefined;
  /** A project's name as the left menu's group header shows it. */
  readonly project?: string | undefined;
  readonly mate?: EnvironmentId | undefined;
}

interface UsageAmounts {
  readonly costUsd: number;
  readonly totalTokens: number;
  /** Of the rolled-up environments' cost; 0 when that is 0. */
  readonly costShare: number;
  readonly tokenShare: number;
}

export interface UsageMateRow extends UsageAmounts {
  readonly environmentId: EnvironmentId;
  /** The Mate's name, or the environment's label when it is not a Mate. */
  readonly mateName: string;
  readonly projectName: string | null;
  readonly owner: UsageEnvironmentOwner | null;
}

export interface UsagePersonRow extends UsageAmounts {
  /** Null for the environments whose owner is unknown: "Unassigned". */
  readonly owner: UsageEnvironmentOwner | null;
  readonly mates: readonly UsageMateRow[];
}

export interface UsageProjectRow extends UsageAmounts {
  /** Null for the environments outside any named project: "Unassigned". */
  readonly projectName: string | null;
  /** Distinct owners of the project's Mates, costliest first. */
  readonly owners: readonly UsageEnvironmentOwner[];
  readonly mates: readonly UsageMateRow[];
}

export interface UsageDimensions {
  readonly visible: Readonly<Record<UsageDimension, boolean>>;
  readonly people: readonly UsagePersonRow[];
  readonly projects: readonly UsageProjectRow[];
  readonly mates: readonly UsageMateRow[];
}

/** Largest first by the active metric, the other metric breaking ties. */
function byMetric(metric: UsageDimensionMetric) {
  return (left: UsageAmounts, right: UsageAmounts): number =>
    metric === "cost"
      ? right.costUsd - left.costUsd || right.totalTokens - left.totalTokens
      : right.totalTokens - left.totalTokens || right.costUsd - left.costUsd;
}

function rollUp<K>(
  mates: readonly UsageMateRow[],
  keyOf: (mate: UsageMateRow) => K,
  totalCost: number,
  totalTokens: number,
): Map<K, { costUsd: number; totalTokens: number; mates: UsageMateRow[] } & UsageAmounts> {
  const groups = new Map<K, { costUsd: number; totalTokens: number; mates: UsageMateRow[] }>();
  for (const mate of mates) {
    const key = keyOf(mate);
    const group = groups.get(key) ?? { costUsd: 0, totalTokens: 0, mates: [] };
    group.costUsd += mate.costUsd;
    group.totalTokens += mate.totalTokens;
    group.mates.push(mate);
    groups.set(key, group);
  }
  return new Map(
    [...groups].map(([key, group]) => [
      key,
      {
        ...group,
        costShare: totalCost === 0 ? 0 : group.costUsd / totalCost,
        tokenShare: totalTokens === 0 ? 0 : group.totalTokens / totalTokens,
      },
    ]),
  );
}

export function usageDimensions(input: {
  readonly byEnvironment: readonly EnvironmentTotals[];
  readonly identities: UsageEnvironmentIdentities;
  /** Each environment's own label, the name of an environment that is not a Mate. */
  readonly labels: ReadonlyMap<EnvironmentId, string>;
  readonly metric: UsageDimensionMetric;
}): UsageDimensions {
  const sort = byMetric(input.metric);
  const totalCost = input.byEnvironment.reduce((sum, row) => sum + row.costUsd, 0);
  const totalTokens = input.byEnvironment.reduce((sum, row) => sum + row.totalTokens, 0);

  const mates: UsageMateRow[] = input.byEnvironment
    .map((row) => {
      const identity = input.identities.get(row.environmentId);
      return {
        environmentId: row.environmentId,
        mateName:
          identity?.mateName ?? input.labels.get(row.environmentId) ?? String(row.environmentId),
        projectName: identity?.projectName ?? null,
        owner: identity?.owner ?? null,
        costUsd: row.costUsd,
        totalTokens: row.totalTokens,
        costShare: totalCost === 0 ? 0 : row.costUsd / totalCost,
        tokenShare: totalTokens === 0 ? 0 : row.totalTokens / totalTokens,
      };
    })
    .toSorted(sort);

  const people: UsagePersonRow[] = [
    ...rollUp(mates, (mate) => mate.owner?.id ?? null, totalCost, totalTokens).values(),
  ]
    .map((group) => ({ ...group, owner: group.mates[0]?.owner ?? null }))
    .toSorted(sort);

  const projects: UsageProjectRow[] = [
    ...rollUp(mates, (mate) => mate.projectName, totalCost, totalTokens),
  ]
    .map(([projectName, group]) => {
      const owners = new Map<string, UsageEnvironmentOwner>();
      for (const mate of group.mates) {
        if (mate.owner !== null && !owners.has(mate.owner.id))
          owners.set(mate.owner.id, mate.owner);
      }
      return { ...group, projectName, owners: [...owners.values()] };
    })
    .toSorted(sort);

  return {
    visible: {
      person: people.filter((row) => row.owner !== null).length >= 2,
      project: projects.filter((row) => row.projectName !== null).length >= 2,
      mate: mates.length >= 2,
    },
    people,
    projects,
    mates,
  };
}

/** Whether an environment falls inside the scope; an empty scope includes every one. */
export function usageScopeIncludes(
  scope: UsageScope,
  identities: UsageEnvironmentIdentities,
  environmentId: EnvironmentId,
): boolean {
  if (scope.mate !== undefined && scope.mate !== environmentId) return false;
  const identity = identities.get(environmentId);
  if (scope.person !== undefined && identity?.owner?.id !== scope.person) return false;
  if (scope.project !== undefined && identity?.projectName !== scope.project) return false;
  return true;
}

export function isUsageScopeEmpty(scope: UsageScope): boolean {
  return scope.person === undefined && scope.project === undefined && scope.mate === undefined;
}

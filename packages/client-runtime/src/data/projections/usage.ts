/**
 * One project's resources as its open panel shows them: what each service holds and uses now,
 * summed over the containers that run, and every service's last day by the hour. Read only while
 * a screen demands the project's `usage` and `usageHistory` details.
 *
 * @module data/projections/usage
 */
import type { ZeropsServiceUsage } from "../../zerops/topology.ts";
import { usageScope, type ContainerUsage, type StatPair } from "../families/usage.ts";
import { usageHistoryScope, type UsageBucket } from "../families/usageHistory.ts";
import type { ScopeKey } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";
import type { ProjectKey } from "./processes.ts";

export interface ProjectUsage {
  /** Whether the current use answered at all: until it has, a service without use is unread. */
  readonly read: boolean;
  /**
   * Each service's use, by service id. A service is absent while no container of it runs, or
   * while one of its containers leaves a figure unsaid.
   */
  readonly byService: Readonly<Record<string, ZeropsServiceUsage>>;
  /** Every service's hours, oldest first. */
  readonly history: ReadonlyArray<UsageBucket>;
  /** Why the use or the hours are not read now: the fault of a read refused or catching up. */
  readonly failure: string | undefined;
}

/** The known values of a scope's members. */
function membersOf<F extends "usage" | "usageHistory">(
  read: ProjectionReads,
  family: F,
  scope: ScopeKey,
) {
  return read.members(scope).ids.flatMap((id) => {
    const fact = read.fact(family, id);
    return fact.kind === "known" ? [fact.value] : [];
  });
}

const add = (total: StatPair | null, pair: StatPair | null): StatPair | null =>
  total === null || pair === null
    ? null
    : { used: total.used + pair.used, limit: total.limit + pair.limit };

/** A container's cores: dedicated (`cpu`) and shared (`vCpu`) together; unknown if it says neither. */
const coresOf = (container: ContainerUsage): StatPair | null =>
  container.cpu === null && container.vCpu === null
    ? null
    : add(container.cpu ?? { used: 0, limit: 0 }, container.vCpu ?? { used: 0, limit: 0 });

const NONE: StatPair = { used: 0, limit: 0 };

function useByService(containers: ReadonlyArray<ContainerUsage>) {
  const sums = new Map<
    string,
    {
      containers: number;
      cores: StatPair | null;
      memoryGb: StatPair | null;
      diskGb: StatPair | null;
    }
  >();
  for (const container of containers) {
    const sum = sums.get(container.serviceId) ?? {
      containers: 0,
      cores: NONE,
      memoryGb: NONE,
      diskGb: NONE,
    };
    sums.set(container.serviceId, {
      containers: sum.containers + 1,
      cores: add(sum.cores, coresOf(container)),
      memoryGb: add(sum.memoryGb, container.ramGBytes),
      diskGb: add(sum.diskGb, container.diskGBytes),
    });
  }
  const byService: Record<string, ZeropsServiceUsage> = {};
  for (const [serviceId, { containers: count, cores, memoryGb, diskGb }] of sums)
    if (cores !== null && memoryGb !== null && diskGb !== null)
      byService[serviceId] = { containers: count, cores, memoryGb, diskGb };
  return byService;
}

function failureOf(read: ProjectionReads, scope: ScopeKey) {
  const { phase, fault } = read.stream(scope);
  return phase === "refused" || phase === "recovering" ? fault?.message : undefined;
}

export const projectUsage: Projection<ProjectKey, ProjectUsage> = {
  name: "projectUsage",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) => {
    const usage = usageScope(orgId, projectId);
    const hours = usageHistoryScope(orgId, projectId);
    return {
      read: read.coverage(usage) !== "unknown",
      byService: useByService(membersOf(read, "usage", usage)),
      // Corrections arrive out of order; a chart's points stay chronological.
      history: membersOf(read, "usageHistory", hours).sort(
        (left, right) => Date.parse(left.from) - Date.parse(right.from),
      ),
      failure: failureOf(read, usage) ?? failureOf(read, hours),
    };
  },
  equals: sameValue,
};

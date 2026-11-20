/**
 * What a stop's chips read of its running work: the builds under way and the version each builds,
 * the name every build of the project gave its version, how the newest build seen of each service
 * ended, and the version the organization's active versions hold each service runs. The services
 * themselves are not a family of this store yet; a stop names them by id, one key per stop. What
 * a version a service's own row names is, it reads per version (`versionSource`).
 *
 * Every answer comes from the account's store: a name outlives its build because the store keeps
 * the ended process, not because anything remembers it.
 *
 * @module data/projections/stopWork
 */
import { runningScope, runsStill } from "../families/process.ts";
import type { ProcessValue } from "../../zerops/projectProcesses.ts";
import { activeScope } from "../families/version.ts";
import type { EndedBuild, StopBuild, StopWork, WorkSource } from "../../zerops/flow/stopWork.ts";
import type { VersionValue } from "../../zerops/serviceVersion.ts";
import { linkKeys } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import type { StreamState } from "../streamMachine.ts";
import { sameValue } from "./equal.ts";

export interface StopWorkKey {
  readonly orgId: string;
  readonly projectId: string;
  /** The stop's services: one key per stop however often what they run changes. */
  readonly serviceIds: ReadonlyArray<string>;
}

const CATCHING_UP: ReadonlySet<StreamState["phase"]> = new Set(["recovering", "reauthenticating"]);

function refusalReason(stream: StreamState): "expired-session" | "forbidden" | "refused" {
  switch (stream.fault?.outcome) {
    case "authoritative-denial":
      return "forbidden";
    case "definitive-refusal":
    case "recoverable-session":
      return "expired-session";
    default:
      return "refused";
  }
}

function sourceOf(read: ProjectionReads, orgId: string): WorkSource {
  const link = read.stream(linkKeys.zerops(orgId));
  const scopes = [read.stream(runningScope(orgId)), read.stream(activeScope(orgId))];
  const refusal = [link, ...scopes].find((stream) => stream.phase === "refused");
  if (refusal !== undefined) return { kind: "refused", reason: refusalReason(refusal) };
  if (link.phase === "live" && scopes.every((scope) => scope.phase === "live"))
    return { kind: "observing" };
  // Catching up is the streams' own word: a link retrying or repairing its session, a scope an
  // attempt already registered left stale. The first connect is not.
  if (
    CATCHING_UP.has(link.phase) ||
    scopes.some((scope) => scope.phase === "stale" && scope.generation > 0)
  )
    return { kind: "catching-up" };
  return { kind: "establishing" };
}

export const stopWork: Projection<StopWorkKey, StopWork> = {
  name: "stopWork",
  keyOf: ({ orgId, projectId, serviceIds }) => `${orgId}/${projectId}/${serviceIds.join(",")}`,
  derive: (read, { orgId, projectId, serviceIds }) => {
    const running = runningScope(orgId);
    const seen = read.index("seenRunning", projectId);
    const held: Array<{ readonly process: ProcessValue; readonly seenRunning: boolean }> = [];
    for (const id of read.index("project", projectId)) {
      const fact = read.fact("process", id);
      if (fact.kind !== "known") continue;
      // Seen while it ran — listed by the running work, or its end pushed through its updates —
      // whichever read brought its end.
      held.push({ process: fact.value, seenRunning: seen.has(id) || fact.scope === running });
    }
    const builds: Array<StopBuild> = [];
    for (const id of read.index("running", projectId)) {
      const fact = read.fact("process", id);
      if (fact.kind !== "known" || fact.value.actionName !== "stack.build") continue;
      const process = fact.value;
      builds.push({
        processId: process.id,
        serviceIds: process.serviceStackIds,
        appVersionId: process.appVersion?.id ?? null,
        name: process.appVersion?.name ?? null,
        created: process.created,
      });
    }
    const names: Record<string, string> = {};
    for (const { process } of held) {
      const { id, name } = process.appVersion ?? {};
      if (id !== undefined && name !== undefined && name !== null) names[id] = name;
    }
    const newest = new Map<string, ProcessValue>();
    for (const { process, seenRunning } of held) {
      if (!seenRunning || process.actionName !== "stack.build") continue;
      for (const serviceId of process.serviceStackIds) {
        const before = newest.get(serviceId);
        if (before === undefined || before.created < process.created)
          newest.set(serviceId, process);
      }
    }
    const lastBuilds: Record<string, EndedBuild> = {};
    for (const [serviceId, process] of newest) {
      if (!runsStill(process.status))
        lastBuilds[serviceId] = { processId: process.id, status: process.status };
    }
    const active: Record<string, VersionValue> = {};
    for (const serviceId of serviceIds) {
      for (const id of read.index("active", serviceId)) {
        const fact = read.fact("version", id);
        if (fact.kind === "known") active[serviceId] = fact.value;
      }
    }
    return {
      source: sourceOf(read, orgId),
      complete: read.coverage(running) === "complete",
      builds,
      names,
      lastBuilds,
      active,
    };
  },
  equals: sameValue,
};

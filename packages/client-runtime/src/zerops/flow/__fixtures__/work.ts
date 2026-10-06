/**
 * The account's store's word on a stop's work, for the flow's tests: its running work read whole
 * and live, no build under way, nothing named, no version held — unless a test says otherwise.
 */
import type { StopBuild, StopWork } from "../../../data/projections/stopWork.ts";

export const work = (patch: Partial<StopWork> = {}): StopWork => ({
  source: { kind: "observing" },
  complete: true,
  builds: [],
  names: {},
  lastBuilds: {},
  versions: {},
  active: {},
  ...patch,
});

/** A `stack.build` of the services, building the version `appVersion` names where it does. */
export const runningBuild = (
  serviceIds: ReadonlyArray<string>,
  appVersion?: { readonly id: string; readonly name?: string },
): StopBuild => ({
  processId: "build",
  serviceIds,
  appVersionId: appVersion?.id ?? null,
  name: appVersion?.name ?? null,
  created: "2026-09-20T09:00:00Z",
});

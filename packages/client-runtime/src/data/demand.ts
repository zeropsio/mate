/**
 * What the account observes, and what that costs each source (HANDOFF §4.1, §4.2). Navigation is
 * always demanded: for Zerops it is a constant set of organization registrations, never one per
 * menu row. Each family is a pair: a membership `listStream`, whose answer is the scope's baseline,
 * and an `updateStream` of whole rows. Running work pairs the running membership with the
 * status-unfiltered process updates: the running-filtered update stream never sends a process's
 * end (`klient/probe-org3`), so an indicator fed by it would never go out.
 *
 * Request shapes as measured: `klient/probe-org-data/20261005T184903Z-registration-formats.jsonl`.
 *
 * @module data/demand
 */
import { scopeKeys, type ScopeKey } from "./model.ts";

export interface Registration {
  readonly scope: ScopeKey;
  readonly family: "project" | "process";
  /** `membership`: a `listStream`, answered with the baseline. `updates`: an `updateStream`. */
  readonly role: "membership" | "updates";
  readonly path: string;
  readonly search: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

/** The statuses the running registration admits. */
export const RUNNING_PROCESS_STATUSES = ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"] as const;

/** A whole organization's search: the platform answers up to this many rows in one page. */
export const ORGANIZATION_SEARCH_LIMIT = 2000;

/** The organization's navigation on Zerops: projects and running work, two pairs. */
export function zeropsNavigation(orgId: string): ReadonlyArray<Registration> {
  const organization = { name: "clientId", operator: "eq", value: orgId };
  const notBalancer = { name: "executorTag", operator: "ne", value: "L7_MASTER" };
  const projects = scopeKeys.projects(orgId);
  const running = scopeKeys.running(orgId);
  // Updates register before membership: an update racing the baseline is caught, never lost.
  return [
    {
      scope: projects,
      family: "project",
      role: "updates",
      path: "/project/search",
      search: [organization],
    },
    {
      scope: projects,
      family: "project",
      role: "membership",
      path: "/project/search",
      search: [organization],
    },
    {
      scope: running,
      family: "process",
      role: "updates",
      path: "/process/search",
      search: [organization, notBalancer],
    },
    {
      scope: running,
      family: "process",
      role: "membership",
      path: "/process/search",
      search: [
        organization,
        { name: "status", operator: "in", value: RUNNING_PROCESS_STATUSES },
        notBalancer,
      ],
    },
  ];
}

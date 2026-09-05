/**
 * The service map's presentation model, derived from the client-side
 * topology projection (`topology.ts`) and the lifecycle feed.
 *
 * Everything here is a pure function over plain values, so the rules that are
 * worth arguing about — grouping order, dev↔stage pairing, what counts as
 * live — are tested directly instead of through markup.
 *
 * What this deliberately does NOT do: infer state the feeds do not carry.
 * `transient` is `projectTopology`'s own answer, and a running tool is
 * attributed to the map rather than to a row because `ZeropsRecentTool` has
 * no hostname. It also no longer carries `mounted`, `adoptionState`, or
 * `doorbellConnected` — those were `zcp studio topology`-only facts; liveness
 * is now `useProjectTopology`'s own signal, composed by the caller rather than
 * by this function.
 */
import type { ZeropsLifecycle } from "@t3tools/contracts";

import type { ZeropsTopologyGroup, ZeropsTopologyService, ZeropsTopologyView } from "./topology.ts";

/** Reading order: what the user builds, what it stores, what runs it. */
const GROUP_ORDER: ReadonlyArray<{ group: ZeropsTopologyGroup; title: string }> = [
  { group: "runtimes", title: "Runtimes" },
  { group: "data", title: "Data" },
  { group: "infrastructure", title: "Infrastructure" },
];

const STAGE_SUFFIX = "stage";
const DEV_SUFFIX = "dev";

/**
 * `"<name> (<projectId>)"`, the shape zcp renders a production launch as
 * (`internal/workflow/compute_envelope.go`, `prodLaunchRefsRender`).
 */
const PRODUCTION_LAUNCH = /^(.*?)\s*\(([^()\s]+)\)$/u;

/** Zerops' own dashboard, the same deep link zcp hands out on a launch failure. */
const projectUrl = (projectId: string): string => `https://app.zerops.io/project/${projectId}`;

export interface ZeropsProductionLink {
  readonly label: string;
  readonly projectId?: string;
  readonly url?: string;
}

export interface ZeropsServiceRow {
  readonly service: ZeropsTopologyService;
  readonly tone: ZeropsServiceTone;
  /** `type` without its OS prefix: `ubuntu/nodejs@22` reads as `nodejs@22`. */
  readonly typeLabel: string;
  /** The paired stage service, folded into its dev row. */
  readonly stage?: ZeropsTopologyService;
  readonly stageTone?: ZeropsServiceTone;
  /** Production projects this service feeds, from the lifecycle envelope. */
  readonly production: ReadonlyArray<ZeropsProductionLink>;
}

export interface ZeropsServiceMapGroup {
  readonly group: ZeropsTopologyGroup;
  readonly title: string;
  readonly rows: ReadonlyArray<ZeropsServiceRow>;
}

export interface ZeropsServiceMapView {
  readonly groups: ReadonlyArray<ZeropsServiceMapGroup>;
  readonly project: ZeropsTopologyView["project"];
  readonly isEmpty: boolean;
  readonly warnings: ReadonlyArray<string>;
  /**
   * A phrase for the Zerops operation running right now, if any — the
   * caller's own reading of `ZeropsThreadModel.running` (passed in as
   * `runningTool`, see `buildZeropsServiceMap`), never derived here.
   *
   * The topology projection carries no live process state of its own beyond
   * `transient`, so this is the only signal that something is in flight. It
   * belongs to the map rather than to a row: the model records an operation,
   * never a hostname, and attributing it to a service would be a guess
   * dressed as a fact.
   */
  readonly runningTool?: string;
}

/** `ubuntu/nodejs@22` → `nodejs@22`; a type with no OS prefix is unchanged. */
export function zeropsTypeLabel(type: string): string {
  const slash = type.indexOf("/");
  return slash < 0 ? type : type.slice(slash + 1);
}

/**
 * A settled status is chrome; anything else is the interesting case. Failure
 * words are matched loosely on purpose — the platform's vocabulary grows
 * (`REPAIR_FAILED`, `CONTAINER_FAILED`, `ACTION_FAILED`) and a status this
 * build has not seen should still read as bad news rather than as normal.
 */
export type ZeropsServiceTone = "error" | "warning" | "outline";

export function serviceStatusTone(service: ZeropsTopologyService): ZeropsServiceTone {
  if (/FAIL/u.test(service.status)) {
    return "error";
  }
  return service.transient ? "warning" : "outline";
}

/** `kanbanstage` → `kanbandev`, the hostname its dev partner would have. */
const devPartnerOf = (hostname: string): string | undefined =>
  hostname.endsWith(STAGE_SUFFIX) && hostname.length > STAGE_SUFFIX.length
    ? `${hostname.slice(0, -STAGE_SUFFIX.length)}${DEV_SUFFIX}`
    : undefined;

export function parseZeropsProductionLaunch(entry: string): ZeropsProductionLink {
  const match = PRODUCTION_LAUNCH.exec(entry.trim());
  const label = match?.[1]?.trim();
  const projectId = match?.[2];
  return label === undefined || label.length === 0 || projectId === undefined
    ? { label: entry.trim() }
    : { label, projectId, url: projectUrl(projectId) };
}

const productionOf = (
  hostname: string,
  lifecycle: ZeropsLifecycle | undefined,
): ReadonlyArray<ZeropsProductionLink> => {
  const snapshot = lifecycle?.envelope?.services.find((entry) => entry.hostname === hostname);
  return (snapshot?.feedsProduction ?? []).map(parseZeropsProductionLaunch);
};

/**
 * The map to render, or undefined when there is nothing to render at all —
 * `useProjectTopology` has not produced a view yet (no session, no resolved
 * project, or the first read still in flight). `runningTool` is the
 * caller's own reading of `ZeropsThreadModel.running` — this layer no
 * longer reads `lifecycle.recentTools` (§2.1 principle 5: one owner for
 * "which Zerops call is running").
 */
export function buildZeropsServiceMap(
  topology: ZeropsTopologyView | undefined,
  lifecycle?: ZeropsLifecycle,
  runningTool?: string,
): ZeropsServiceMapView | undefined {
  if (topology === undefined) {
    return undefined;
  }

  // A stage folded into its dev row must not also stand on its own.
  const byHostname = new Map(topology.services.map((entry) => [entry.hostname, entry]));
  const folded = new Set<string>();
  for (const entry of topology.services) {
    const partner = devPartnerOf(entry.hostname);
    const dev = partner === undefined ? undefined : byHostname.get(partner);
    // Pairing is within a group: a `cachestage` managed service is not the
    // stage half of a `cachedev` runtime, whatever the names suggest.
    if (dev !== undefined && dev.group === entry.group) {
      folded.add(entry.hostname);
    }
  }

  const groups = GROUP_ORDER.map(({ group, title }) => ({
    group,
    title,
    rows: topology.services
      .filter((entry) => entry.group === group && !folded.has(entry.hostname))
      .map((entry): ZeropsServiceRow => {
        const stage = topology.services.find(
          (candidate) =>
            folded.has(candidate.hostname) && devPartnerOf(candidate.hostname) === entry.hostname,
        );
        return {
          service: entry,
          tone: serviceStatusTone(entry),
          typeLabel: zeropsTypeLabel(entry.type),
          ...(stage === undefined ? {} : { stage, stageTone: serviceStatusTone(stage) }),
          production: productionOf(entry.hostname, lifecycle),
        };
      }),
  })).filter((group) => group.rows.length > 0);

  return {
    groups,
    project: topology.project,
    isEmpty: topology.services.length === 0,
    warnings: topology.warnings,
    ...(runningTool === undefined ? {} : { runningTool }),
  };
}

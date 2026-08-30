/**
 * The service map's presentation model, derived from the two feeds.
 *
 * Everything here is a pure function over the contract types, so the rules that
 * are worth arguing about — grouping, dev↔stage pairing, what counts as live —
 * are tested directly instead of through markup.
 *
 * What this deliberately does NOT do: infer state the feeds do not carry.
 * `mounted` is zcp's own answer, `transient` is the contract's settled
 * allow-list, and a running tool is attributed to the map rather than to a row
 * because `ZeropsRecentTool` has no hostname.
 */
import type {
  ZeropsLifecycle,
  ZeropsService,
  ZeropsServiceGroup,
  ZeropsTopologySnapshot,
} from "@t3tools/contracts";

/** Reading order: what the user builds, what it stores, what runs it. */
const GROUP_ORDER: ReadonlyArray<{ group: ZeropsServiceGroup; title: string }> = [
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
  readonly service: ZeropsService;
  /** `type` without its OS prefix: `ubuntu/nodejs@22` reads as `nodejs@22`. */
  readonly typeLabel: string;
  /** The paired stage service, folded into its dev row. */
  readonly stage?: ZeropsService;
  /** Production projects this service feeds, from the lifecycle envelope. */
  readonly production: ReadonlyArray<ZeropsProductionLink>;
}

export interface ZeropsServiceMapGroup {
  readonly group: ZeropsServiceGroup;
  readonly title: string;
  readonly rows: ReadonlyArray<ZeropsServiceRow>;
}

export interface ZeropsServiceMapView {
  readonly groups: ReadonlyArray<ZeropsServiceMapGroup>;
  readonly project?: ZeropsTopologySnapshot["project"];
  readonly isEmpty: boolean;
  readonly degraded: boolean;
  readonly degradedReason?: string;
  readonly warnings: ReadonlyArray<string>;
  /**
   * The `zerops_*` tool running right now, if any.
   *
   * The topology feed carries no process state and its doorbell never fires on
   * a status change, so this is the only signal that something is in flight.
   * It belongs to the map rather than to a row: the lifecycle feed records a
   * tool name, never a hostname, and attributing it to a service would be a
   * guess dressed as a fact.
   */
  readonly runningTool?: string;
  /**
   * How the map is being kept current, or undefined when there is nothing to
   * say about it.
   *
   * `polling` is NOT an error: the push channel is down, the map is still
   * correct and a few seconds behind, and the feed recovers on its own. And
   * `undefined` is deliberately not `polling` — it means the feed reported no
   * doorbell at all, which is a different claim from "the doorbell is down"
   * and must not be drawn as a degraded state.
   */
  readonly liveness?: "live" | "polling";
}

/** `ubuntu/nodejs@22` → `nodejs@22`; a type with no OS prefix is unchanged. */
export function zeropsTypeLabel(type: string): string {
  const slash = type.indexOf("/");
  return slash < 0 ? type : type.slice(slash + 1);
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
 * no feed yet, or an environment with no zcp in it. `available: false` is not
 * an error and never surfaces as one; the panel is simply absent.
 */
export function buildZeropsServiceMap(
  topology: ZeropsTopologySnapshot | undefined,
  lifecycle?: ZeropsLifecycle,
): ZeropsServiceMapView | undefined {
  if (topology === undefined || !topology.available) {
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
          typeLabel: zeropsTypeLabel(entry.type),
          ...(stage === undefined ? {} : { stage }),
          production: productionOf(entry.hostname, lifecycle),
        };
      }),
  })).filter((group) => group.rows.length > 0);

  const running = lifecycle?.recentTools.find((tool) => tool.status === "inProgress");

  return {
    groups,
    ...(topology.project === undefined ? {} : { project: topology.project }),
    isEmpty: topology.services.length === 0,
    degraded: topology.degraded,
    ...(topology.degraded && topology.reason !== undefined
      ? { degradedReason: topology.reason }
      : {}),
    warnings: topology.warnings,
    ...(running === undefined ? {} : { runningTool: running.toolName }),
    ...(topology.doorbellConnected === undefined
      ? {}
      : { liveness: topology.doorbellConnected ? ("live" as const) : ("polling" as const) }),
  };
}

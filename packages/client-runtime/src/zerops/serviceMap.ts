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

import type { ZeropsStatPair } from "./api.ts";
import type {
  ZeropsScalingRange,
  ZeropsServiceScaling,
  ZeropsServiceUsage,
  ZeropsTopologyGroup,
  ZeropsTopologyService,
  ZeropsTopologyView,
  ZeropsUsageSample,
} from "./topology.ts";

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
export const zeropsProjectUrl = (projectId: string): string =>
  `https://app.zerops.io/project/${projectId}`;

export interface ZeropsProductionLink {
  readonly label: string;
  readonly projectId?: string;
  readonly url?: string;
}

/** One chip under a service's name: a short phrase, optionally dated or linked. */
export interface ZeropsServiceFact {
  readonly id: "hostname" | "type" | "deploy";
  readonly label: string;
  readonly url?: string;
  /** The instant the fact is dated at; the client says how long ago that was. */
  readonly at?: string;
}

/**
 * One figure of a service's live strip — what the Zerops dashboard shows as
 * "1 container · Cores · RAM · Disk". `fraction` is used over limit, for the
 * thin bar under the figure; absent where there is nothing to fill.
 */
export interface ZeropsServiceMetric {
  readonly id: "containers" | "cores" | "memory" | "disk";
  readonly label: string;
  /** The allocation, as the dashboard prints it; absent while the service holds no container. */
  readonly value?: string;
  /** What is in use of it; absent on the container count. */
  readonly used?: string;
  readonly unit?: string;
  readonly fraction?: number;
  /**
   * The autoscaling envelope the figure moves in — `1 – 3`, or `stays at 1`
   * where the two ends meet — in the row's unit; absent where the platform
   * states no range.
   */
  readonly range?: string;
  /** On the cores row: `Shared` or `Dedicated`. */
  readonly cpuMode?: string;
}

/** One point of a card's graph: the allocation and what was used of it, at an hour. */
export interface ZeropsTrendPoint {
  readonly at: string;
  readonly used: number;
  readonly limit: number;
}

/** The three graphs under a card's figures, oldest point first. */
export interface ZeropsServiceTrends {
  readonly cores: ReadonlyArray<ZeropsTrendPoint>;
  readonly memory: ReadonlyArray<ZeropsTrendPoint>;
  readonly disk: ReadonlyArray<ZeropsTrendPoint>;
}

export interface ZeropsServiceRow {
  readonly service: ZeropsTopologyService;
  readonly tone: ZeropsServiceTone;
  /** The platform's status token as a word: `READY_TO_DEPLOY` reads as `Ready to deploy`. */
  readonly statusLabel: string;
  /** `type` without its OS prefix: `ubuntu/nodejs@22` reads as `nodejs@22`. */
  readonly typeLabel: string;
  /**
   * What the service is, as the card's name line says it beside the port:
   * the platform's name and the major version, `Node.js 22`; the raw type
   * where the platform gave no name. Absent on the control plane, whose
   * name already says what it is.
   */
  readonly typeShort?: string;
  /** The row's name: the hostname, or the glossary word for the control plane. */
  readonly title: string;
  /** The service's declared ports after its name, `:80` or `:80, :443`. */
  readonly portLabel?: string;
  /**
   * The one line under the name, in order: the hostname where the title is
   * not it (the control plane), then what the service is, then how its
   * running version got there. A client joins the segments.
   */
  readonly meta: ReadonlyArray<ZeropsServiceFact>;
  /** The service's own page in the Zerops dashboard. */
  readonly dashboardUrl: string;
  /** The live figures; empty until the first current-stats read, or for a service holding no container. */
  readonly metrics: ReadonlyArray<ZeropsServiceMetric>;
  /** Cores, RAM and disk over the last day; absent until the history read answers. */
  readonly trends?: ZeropsServiceTrends;
  /** The paired stage service, folded into its dev row. */
  readonly stage?: ZeropsTopologyService;
  readonly stageTone?: ZeropsServiceTone;
  readonly stageStatusLabel?: string;
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
  /** Whether a usage read has answered — until then a client reserves the strip's space. */
  readonly usageRead: boolean;
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
 * A running, settled status is chrome; anything else is the interesting
 * case. Failure words are matched loosely on purpose — the platform's
 * vocabulary grows (`REPAIR_FAILED`, `CONTAINER_FAILED`, `ACTION_FAILED`)
 * and a status this build has not seen should still read as bad news rather
 * than as normal. `muted` is settled but not running: a stopped service, or
 * a runtime that has nothing deployed yet — never a green dot.
 */
export type ZeropsServiceTone = "error" | "warning" | "outline" | "muted";

const NOT_RUNNING_STATUSES: ReadonlySet<string> = new Set([
  "STOPPED",
  "READY_TO_DEPLOY",
  "DELETED",
]);

const SERVICE_STATUS_PREFIX = "SERVICE_";

export function serviceStatusTone(service: ZeropsTopologyService): ZeropsServiceTone {
  if (/FAIL/u.test(service.status)) {
    return "error";
  }
  if (service.transient) {
    return "warning";
  }
  const normalized = service.status.startsWith(SERVICE_STATUS_PREFIX)
    ? service.status.slice(SERVICE_STATUS_PREFIX.length)
    : service.status;
  return NOT_RUNNING_STATUSES.has(normalized) ? "muted" : "outline";
}

const withKey = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

/** `READY_TO_DEPLOY` → `Ready to deploy`; a token the client has never seen still reads as words. */
export function zeropsStatusWord(status: string): string {
  const words = status.trim().replaceAll("_", " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The glossary word for the zcp container (`design-system.md` §2). */
const CONTROL_PLANE_TITLE = "Zerops Control Plane";

/** The service's own page in the Zerops dashboard, the GUI's `/service-stack/:id` route. */
const serviceDashboardUrl = (serviceId: string): string =>
  `https://app.zerops.io/service-stack/${serviceId}`;

/** `:80`, or `:80, :443` — the ports the service declares, after its name. */
export function zeropsPortLabel(service: ZeropsTopologyService): string | undefined {
  if (service.ports.length === 0) return undefined;
  return service.ports.map((port) => `:${port.port}`).join(", ");
}

/**
 * A figure the way the dashboard prints it: whole numbers stay whole, the
 * rest keep two decimals with trailing zeros dropped (`2.625` → `2.63`,
 * `0.5` → `0.5`).
 */
export function formatAmount(value: number): string {
  return Number(value.toFixed(2)).toString();
}

const EN_DASH = "\u2013";

/** `1 – 3`, or `stays at 1` where nothing scales. */
export function formatRange(range: ZeropsScalingRange): string {
  return range.min === range.max
    ? `stays at ${formatAmount(range.min)}`
    : `${formatAmount(range.min)} ${EN_DASH} ${formatAmount(range.max)}`;
}

const withRange = (range: ZeropsScalingRange | undefined) =>
  range === undefined ? {} : { range: formatRange(range) };

const CPU_MODE_WORDS: Record<string, string> = { SHARED: "Shared", DEDICATED: "Dedicated" };

const withCpuMode = (mode: string | undefined) =>
  mode === undefined ? {} : { cpuMode: CPU_MODE_WORDS[mode] ?? mode };

/**
 * The name line's word for what a service is: the platform's name and the
 * major version — `Node.js 22`, `PostgreSQL 16`, `Valkey 7.2` — or the bare
 * type where the platform gave no name.
 */
export function zeropsTypeShort(service: Pick<ZeropsTopologyService, "type" | "typeName">): string {
  const label = zeropsTypeLabel(service.type);
  if (service.typeName === undefined) return label;
  const at = label.lastIndexOf("@");
  return at < 0 ? service.typeName : `${service.typeName} ${label.slice(at + 1)}`;
}

const fractionOf = (used: number, limit: number): number | undefined =>
  limit > 0 ? Math.min(1, Math.max(0, used / limit)) : undefined;

const withFraction = (used: number, limit: number) => {
  const fraction = fractionOf(used, limit);
  return fraction === undefined ? {} : { fraction };
};

/**
 * The live strip from a service's usage: the containers it runs, and the
 * cores, RAM and disk they hold. The figure is the allocation (`limit`), as
 * the dashboard shows it; how much of it is in use rides as `fraction`.
 */
export function zeropsServiceMetrics(
  usage: ZeropsServiceUsage | undefined,
  scaling?: ZeropsServiceScaling,
): ReadonlyArray<ZeropsServiceMetric> {
  if (usage === undefined && scaling === undefined) return [];
  const held = (pair: ZeropsStatPair | undefined) =>
    pair === undefined
      ? {}
      : {
          value: formatAmount(pair.limit),
          used: formatAmount(pair.used),
          ...withFraction(pair.used, pair.limit),
        };
  return [
    {
      id: "containers",
      label: usage?.containers === 1 ? "container" : "containers",
      ...(usage === undefined ? {} : { value: String(usage.containers) }),
      ...withRange(scaling?.containers),
    },
    {
      id: "cores",
      label: "Cores",
      ...held(usage?.cores),
      ...withRange(scaling?.cores),
      ...withCpuMode(scaling?.cpuMode),
    },
    {
      id: "memory",
      label: "RAM",
      ...held(usage?.memoryGb),
      unit: "GB",
      ...withRange(scaling?.memoryGb),
    },
    {
      id: "disk",
      label: "Disk",
      ...held(usage?.diskGb),
      unit: "GB",
      ...withRange(scaling?.diskGb),
    },
  ];
}

/** The graphs' series: each resource held and used, hour by hour; nothing until the history answers. */
export function zeropsUsageTrends(
  history: ReadonlyArray<ZeropsUsageSample> | undefined,
): ZeropsServiceTrends | undefined {
  if (history === undefined) return undefined;
  const series = (pick: (sample: ZeropsUsageSample) => ZeropsStatPair) =>
    history.map((sample) => ({
      at: sample.at,
      used: pick(sample).used,
      limit: pick(sample).limit,
    }));
  return {
    cores: series((sample) => sample.cores),
    memory: series((sample) => sample.memoryGb),
    disk: series((sample) => sample.diskGb),
  };
}

const DEPLOY_SOURCE_WORDS: Readonly<Record<string, string>> = {
  CLI: "Deployed from CLI",
  GIT: "Deployed from Git",
  GITHUB: "Deployed from GitHub",
  GITLAB: "Deployed from GitLab",
  GUI: "Uploaded in the GUI",
};

const SHORT_COMMIT_LENGTH = 7;

/**
 * The line under the name: what the service is exactly (falling back to its
 * type-version when the platform gave no display name), and how its running
 * version got there. The type is skipped where it would only repeat the
 * row's title — the control plane is already named by its type.
 */
export function zeropsServiceFacts(
  service: ZeropsTopologyService,
  title: string = service.hostname,
): ReadonlyArray<ZeropsServiceFact> {
  const facts: Array<ZeropsServiceFact> = [];
  if (service.typeName === undefined) {
    facts.push({ id: "type", label: zeropsTypeLabel(service.type) });
  } else if (service.typeName !== title) {
    facts.push({
      id: "type",
      label:
        service.version === undefined ? service.typeName : `${service.typeName} ${service.version}`,
    });
  }
  const deploy = service.deploy;
  if (deploy !== undefined) {
    const verb = DEPLOY_SOURCE_WORDS[deploy.source] ?? "Deployed";
    const ref =
      deploy.branch !== undefined
        ? deploy.commit === undefined
          ? deploy.branch
          : `${deploy.branch}@${deploy.commit.slice(0, SHORT_COMMIT_LENGTH)}`
        : (deploy.tag ?? deploy.name);
    facts.push({
      id: "deploy",
      label: ref === undefined ? verb : `${verb} · ${ref}`,
      ...(deploy.activatedAt === undefined ? {} : { at: deploy.activatedAt }),
    });
  }
  return facts;
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
    : { label, projectId, url: zeropsProjectUrl(projectId) };
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
        const portLabel = zeropsPortLabel(entry);
        // The control plane is named by its glossary word; its hostname and
        // port move down a line so the name reads as one thing.
        const isControlPlane = group === "infrastructure";
        const title = isControlPlane ? CONTROL_PLANE_TITLE : entry.hostname;
        const hostnameFact: ReadonlyArray<ZeropsServiceFact> = isControlPlane
          ? [{ id: "hostname", label: `${entry.hostname}${portLabel ?? ""}` }]
          : [];
        return {
          service: entry,
          tone: serviceStatusTone(entry),
          statusLabel: zeropsStatusWord(entry.status),
          typeLabel: zeropsTypeLabel(entry.type),
          ...(isControlPlane ? {} : { typeShort: zeropsTypeShort(entry) }),
          title,
          ...(isControlPlane || portLabel === undefined ? {} : { portLabel }),
          meta: [...hostnameFact, ...zeropsServiceFacts(entry, title)],
          dashboardUrl: serviceDashboardUrl(entry.serviceId),
          metrics: zeropsServiceMetrics(entry.usage, entry.scaling),
          ...withKey("trends", zeropsUsageTrends(entry.history)),
          ...(stage === undefined
            ? {}
            : {
                stage,
                stageTone: serviceStatusTone(stage),
                stageStatusLabel: zeropsStatusWord(stage.status),
              }),
          production: productionOf(entry.hostname, lifecycle),
        };
      }),
  })).filter((group) => group.rows.length > 0);

  return {
    groups,
    project: topology.project,
    isEmpty: topology.services.length === 0,
    warnings: topology.warnings,
    usageRead: topology.usageRead,
    ...(runningTool === undefined ? {} : { runningTool }),
  };
}

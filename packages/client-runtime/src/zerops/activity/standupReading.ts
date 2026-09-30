/**
 * Where a stand-up call stands, from what the platform says: every service of
 * the environment it stands up and how far each got — waits, building, up,
 * failed — so the person sees what the environment is made of, not only what
 * the call builds.
 *
 * zcp's `zerops_standup` runs as two calls in one turn. The first deploys the
 * dev halves of the tier's pairs, the second the stages. Its own progress
 * never reaches the card (the Claude CLI's headless stream drops MCP progress
 * notifications), but every build it starts is a process of the Mate's own
 * project, which the client already reads over the platform socket, and every
 * service's status is on the project's topology.
 *
 * A call's environment is the project's data services — a database, a cache,
 * a store, shared by both halves — then, in development, its utilities (a
 * runtime no pair holds, such as a mail catcher that keeps its own public
 * build), then the runtimes of the call's half, and every service a build of
 * the call's window names. A pair's stage half is the runtime whose hostname
 * ends in `stage` — zcp's own convention (`IsStageHostname`) — and a half is
 * one only with its partner beside it. The Mate's own container and the
 * platform's services are none of it.
 *
 * The runtimes the call builds are those of its half that run no code (zcp's
 * own rule: it deploys a half that has none, `HasDeployedCode`) — or, when
 * the report before it named them, the stages it queued: those wait until
 * their build starts. Every other service stands as its status says: up,
 * starting, failed, stopped.
 *
 * Pure: the caller reads the topology and the processes and hands them here.
 */
import type { ActivityProcess } from "./dto.ts";
import { CALCULATING_SENTENCE, readPipeline } from "./pipelineReadout.ts";

/** Which half of the tier's pairs a stand-up call deploys. */
export type StandupHalf = "development" | "stage";

export type StandupServiceState = "waits" | "building" | "up" | "failed";

/** A service of the Mate's project, as the stand-up reads it. */
export interface StandupService {
  readonly hostname: string;
  readonly serviceId: string;
  /**
   * Where the project's map draws it: a runtime, a managed data service, or
   * the platform's own (the Mate's container, a build container, the core).
   */
  readonly group: "runtimes" | "data" | "infrastructure";
  /** A deploy put code there: its active version is not the empty start. */
  readonly runsCode: boolean;
  /** The platform's status: `ACTIVE`, `READY_TO_DEPLOY`, `CREATING`… */
  readonly status: string;
}

export interface StandupServiceRow {
  readonly hostname: string;
  readonly state: StandupServiceState;
  /** When its build started; absent while it waits. */
  readonly startedAt?: string;
  /** When its build ended. */
  readonly endedAt?: string;
  /** A build that runs: the step it is on, in the Zerops GUI's words; a service starting, "Starting". */
  readonly sentence?: string;
  /** One held back: what it waits on that did not stand up; one stopped, "stopped". */
  readonly note?: string;
  /** A build that failed: why, as the platform says it, when it says. */
  readonly reason?: string;
}

export interface StandupReading {
  /** Data first, then utilities, then runtimes: a row keeps its place as its state changes. */
  readonly rows: ReadonlyArray<StandupServiceRow>;
  readonly building: number;
  readonly up: number;
  readonly failed: number;
}

/** A reading of rows: how many of them build, are up, failed. */
export function standupReadingOf(rows: ReadonlyArray<StandupServiceRow>): StandupReading {
  return {
    rows,
    building: rows.filter((row) => row.state === "building").length,
    up: rows.filter((row) => row.state === "up").length,
    failed: rows.filter((row) => row.state === "failed").length,
  };
}

/** zcp's `IsStageHostname`: a pair's stage half is named `…stage`. */
export function isStageHostname(hostname: string): boolean {
  return hostname.length > "stage".length && hostname.endsWith("stage");
}

/**
 * Whether a runtime is a half of a pair by zcp's rule (`pairRepositoryRuntimes`):
 * a stage `Xstage` beside its dev half `Xdev` or `X`. A runtime with no
 * partner — no repository, unpaired, a utility the platform built — is none
 * zcp stands up.
 */
function hasPartner(hostname: string, hostnames: ReadonlySet<string>): boolean {
  if (isStageHostname(hostname)) {
    const stem = hostname.slice(0, -"stage".length);
    return hostnames.has(`${stem}dev`) || hostnames.has(stem);
  }
  const stem = hostname.endsWith("dev") ? hostname.slice(0, -"dev".length) : hostname;
  return hostnames.has(`${stem}stage`) || hostnames.has(`${hostname}stage`);
}

const BUILD_ACTIONS: ReadonlySet<string> = new Set(["stack.build", "stack.deploy"]);
const BUILT: ReadonlySet<string> = new Set(["FINISHED"]);
const FAILED: ReadonlySet<string> = new Set(["FAILED", "CANCELED"]);

function stateOf(status: string): StandupServiceState {
  if (BUILT.has(status)) return "up";
  if (FAILED.has(status)) return "failed";
  return "building";
}

/** Whether a build is the call's: it was running, or started, once the call began. */
function inWindow(process: ActivityProcess, sinceMs: number): boolean {
  if (!BUILD_ACTIONS.has(process.actionName)) return false;
  if (process.finished === undefined) return true;
  return Date.parse(process.finished) > sinceMs;
}

function sentenceOf(process: ActivityProcess, hostname: string, nowMs: number): string | undefined {
  if (process.appVersion === undefined) return undefined;
  const pipeline = readPipeline(process.appVersion, {
    nowMs,
    serviceName: hostname,
    ...(process.started === undefined ? {} : { actionStartedAt: process.started }),
  });
  if (pipeline.calculating) return CALCULATING_SENTENCE;
  const current = pipeline.steps.find((step) => step.id === pipeline.currentStepId);
  return current?.sentence;
}

/** Where a service stands in its call's environment: data, a utility, a runtime. */
type Rank = 0 | 1 | 2;

/** Its place in the half's environment; null for one of neither half, or the platform's own. */
function rankOf(
  service: StandupService,
  half: StandupHalf,
  runtimes: ReadonlySet<string>,
): Rank | null {
  if (service.group === "data") return 0;
  if (service.group !== "runtimes") return null;
  const stage = isStageHostname(service.hostname);
  if (!hasPartner(service.hostname, runtimes)) return half === "development" && !stage ? 1 : null;
  return stage === (half === "stage") ? 2 : null;
}

const FAILED_STATUSES: ReadonlySet<string> = new Set([
  "FAILED",
  "ACTION_FAILED",
  "CONTAINER_FAILED",
  "REPAIR_FAILED",
]);
const UP_STATUSES: ReadonlySet<string> = new Set(["ACTIVE", "RUNNING"]);

/** A service no build of the call names, as its status says it stands. */
function standing(service: StandupService): StandupServiceRow {
  const status = service.status.startsWith("SERVICE_")
    ? service.status.slice("SERVICE_".length)
    : service.status;
  const { hostname } = service;
  if (FAILED_STATUSES.has(status)) return { hostname, state: "failed" };
  // A runtime with no code yet has nothing to run: it waits for its build.
  if (service.group === "runtimes" && !service.runsCode) return { hostname, state: "waits" };
  if (UP_STATUSES.has(status)) return { hostname, state: "up" };
  if (status === "STOPPED") return { hostname, state: "waits", note: "stopped" };
  return { hostname, state: "building", sentence: "Starting" };
}

/**
 * The call's environment around the rows it has of its own (`own`, by
 * hostname): every service of it in its place — data, utilities, runtimes,
 * each in the project's order — its own rows as they are, the rest as their
 * status says. A row of its own the project does not list stays, last.
 */
function environment(
  half: StandupHalf,
  services: ReadonlyArray<StandupService>,
  own: ReadonlyMap<string, StandupServiceRow>,
): StandupReading {
  const runtimes = new Set(
    services.filter((service) => service.group === "runtimes").map((service) => service.hostname),
  );
  const ranked = services.flatMap((service) => {
    // One of the call's own that its half would not hold stands with the runtimes.
    const rank = rankOf(service, half, runtimes) ?? (own.has(service.hostname) ? 2 : null);
    if (rank === null) return [];
    return [{ rank, row: own.get(service.hostname) ?? standing(service) }];
  });
  const listed = new Set(ranked.map(({ row }) => row.hostname));
  const rows = [
    ...[0, 1, 2].flatMap((rank) =>
      ranked.filter((entry) => entry.rank === rank).map((entry) => entry.row),
    ),
    ...[...own.values()].filter((row) => !listed.has(row.hostname)),
  ];
  return standupReadingOf(rows);
}

/**
 * A settled call's reading: the rows its report gave the services it built
 * (`rows`), in the environment it stood up, the rest as the project's
 * services say they stand. Without the project read, the report's rows alone.
 */
export function settleStandup(input: {
  readonly half: StandupHalf;
  readonly rows: ReadonlyArray<StandupServiceRow>;
  readonly services?: ReadonlyArray<StandupService>;
}): StandupReading {
  if (input.services === undefined) return standupReadingOf(input.rows);
  return environment(
    input.half,
    input.services,
    new Map(input.rows.map((row) => [row.hostname, row])),
  );
}

export function readStandup(input: {
  readonly half: StandupHalf;
  /** The services the call builds, when the report before it named them. */
  readonly expected?: ReadonlyArray<string>;
  readonly services: ReadonlyArray<StandupService>;
  readonly processes: ReadonlyArray<ActivityProcess>;
  /** When the call started. */
  readonly since: string;
  /** The render clock, epoch ms. */
  readonly nowMs: number;
}): StandupReading {
  const sinceMs = Date.parse(input.since);
  const builds = input.processes
    .filter((process) => inWindow(process, sinceMs))
    .sort((left, right) => Date.parse(left.created) - Date.parse(right.created));
  const runtimes = new Set(
    input.services
      .filter((service) => service.group === "runtimes")
      .map((service) => service.hostname),
  );
  // The rows of the call's own: a runtime a build of its window names, and
  // one it will build that waits for its build to start.
  const own = new Map<string, StandupServiceRow>();
  for (const service of input.services) {
    if (service.group !== "runtimes") continue;
    const latest = builds.findLast((process) =>
      process.serviceStackIds.includes(service.serviceId),
    );
    if (latest === undefined) {
      const waits =
        input.expected === undefined
          ? !service.runsCode && rankOf(service, input.half, runtimes) === 2
          : input.expected.includes(service.hostname);
      if (waits) own.set(service.hostname, { hostname: service.hostname, state: "waits" });
      continue;
    }
    const state = stateOf(latest.status);
    const sentence =
      state === "building" ? sentenceOf(latest, service.hostname, input.nowMs) : undefined;
    own.set(service.hostname, {
      hostname: service.hostname,
      state,
      // When it was made, not when it started: a row's start never moves later.
      startedAt: latest.created,
      ...(state === "building" || latest.finished === undefined
        ? {}
        : { endedAt: latest.finished }),
      ...(sentence === undefined ? {} : { sentence }),
      ...(state === "failed" && latest.failReason !== undefined
        ? { reason: latest.failReason }
        : {}),
    });
  }
  // Told which it builds, the call's runtimes are those alone: a half the
  // report did not name is no runtime of the call's.
  const services =
    input.expected === undefined
      ? input.services
      : input.services.filter(
          (service) => service.group !== "runtimes" || own.has(service.hostname),
        );
  return environment(input.half, services, own);
}

/**
 * Where a stand-up call stands, from what the platform says: each service the
 * call builds and how far it got — waits, building, built, failed.
 *
 * zcp's `zerops_standup` runs as two calls in one turn. The first deploys the
 * dev halves of the tier's pairs, the second the stages. Its own progress
 * never reaches the card (the Claude CLI's headless stream drops MCP progress
 * notifications), but every build it starts is a process of the Mate's own
 * project, which the client already reads over the platform socket.
 *
 * A call's services are those it will build — the stages the call before it
 * queued, when its report named them — and every one a build of the call's
 * window names. Without the names, they are the runtimes of its half that run
 * no code (zcp's own rule: it deploys a half that has none, `HasDeployedCode`),
 * a pair's stage half the runtime whose hostname ends in `stage` — zcp's own
 * convention (`IsStageHostname`). A service that already runs code and builds
 * nothing in the call is not the call's.
 *
 * Pure: the caller reads the topology and the processes and hands them here.
 */
import type { ActivityProcess } from "./dto.ts";
import { CALCULATING_SENTENCE, readPipeline } from "./pipelineReadout.ts";

/** Which half of the tier's pairs a stand-up call deploys. */
export type StandupHalf = "development" | "stage";

export type StandupServiceState = "waits" | "building" | "built" | "failed";

/** A service of the Mate's project, as the stand-up reads it. */
export interface StandupService {
  readonly hostname: string;
  readonly serviceId: string;
  /** A runtime: not a managed service, not the Mate's own container. */
  readonly runtime: boolean;
  /** A deploy put code there: its active version is not the empty start. */
  readonly runsCode: boolean;
}

export interface StandupServiceRow {
  readonly hostname: string;
  readonly state: StandupServiceState;
  /** When its build started; absent while it waits. */
  readonly startedAt?: string;
  /** When its build ended. */
  readonly endedAt?: string;
  /** A build that runs: the step it is on, in the Zerops GUI's words. */
  readonly sentence?: string;
}

export interface StandupReading {
  /** By hostname: a row keeps its place as its state changes. */
  readonly rows: ReadonlyArray<StandupServiceRow>;
  readonly building: number;
  readonly built: number;
  readonly failed: number;
}

/** zcp's `IsStageHostname`: a pair's stage half is named `…stage`. */
export function isStageHostname(hostname: string): boolean {
  return hostname.length > "stage".length && hostname.endsWith("stage");
}

const BUILD_ACTIONS: ReadonlySet<string> = new Set(["stack.build", "stack.deploy"]);
const BUILT: ReadonlySet<string> = new Set(["FINISHED"]);
const FAILED: ReadonlySet<string> = new Set(["FAILED", "CANCELED"]);

function stateOf(status: string): StandupServiceState {
  if (BUILT.has(status)) return "built";
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
  const rows = [...input.services]
    .sort((left, right) => left.hostname.localeCompare(right.hostname))
    .filter((service) => service.runtime)
    .flatMap((service): StandupServiceRow[] => {
      const latest = builds.findLast((process) =>
        process.serviceStackIds.includes(service.serviceId),
      );
      if (latest === undefined) {
        const waits =
          input.expected === undefined
            ? !service.runsCode && isStageHostname(service.hostname) === (input.half === "stage")
            : input.expected.includes(service.hostname);
        return waits ? [{ hostname: service.hostname, state: "waits" }] : [];
      }
      const state = stateOf(latest.status);
      const sentence =
        state === "building" ? sentenceOf(latest, service.hostname, input.nowMs) : undefined;
      return [
        {
          hostname: service.hostname,
          state,
          startedAt: latest.started ?? latest.created,
          ...(state === "building" || latest.finished === undefined
            ? {}
            : { endedAt: latest.finished }),
          ...(sentence === undefined ? {} : { sentence }),
        },
      ];
    });
  return {
    rows,
    building: rows.filter((row) => row.state === "building").length,
    built: rows.filter((row) => row.state === "built").length,
    failed: rows.filter((row) => row.state === "failed").length,
  };
}

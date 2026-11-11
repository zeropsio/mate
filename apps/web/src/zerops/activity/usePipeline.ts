/**
 * One pipeline as its dialog reads it: the app version by id (what started it, and its steps as
 * that read found them), joined with the project's process for it — whose embedded version is
 * the live one while it runs, and whose error says why it failed — and what each of its logs is
 * read by: the build's, the runtime prepare's, and, for a deploy that failed, the service's own
 * around the failure. A log is read only while the dialog shows it (`PipelineViewer`).
 */
import { useAtomValue } from "@effect/atom-react";
import {
  listedProjectAtom,
  NOT_READ_SERVICES,
  pipelineConfigAtom,
  pipelineReadAtom,
  projectServicesAtom,
  type PipelineRead,
  type PipelineValue,
} from "@t3tools/client-runtime/data";
import type { BuildLogQuery } from "@t3tools/client-runtime/zerops/activity/buildLog";
import type {
  ActivityAppVersion,
  ActivityProcess,
} from "@t3tools/client-runtime/zerops/activity/dto";
import { buildLogFor } from "@t3tools/client-runtime/zerops/activity/observe";
import {
  readPipeline,
  type PipelineReadout,
} from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import {
  getPipelineState,
  pipelineTerminalOutcome,
} from "@t3tools/client-runtime/zerops/activity/pipelineState";
import { Atom } from "effect/reactivity";

import { useAccountDataOptional, useDetailDemand } from "../accountData";
import { useSecondsNowMs } from "../useNowMs";
import { useProjectActivity } from "./useProjectActivity";

const NO_PROJECT = Atom.make(null);
const NO_SERVICES = Atom.make(NOT_READ_SERVICES);

/** The logs a pipeline has, each by what reads it. */
export type PipelineLogKind = "build" | "prepare" | "service";

export interface PipelineLog {
  readonly query: BuildLogQuery;
  /** Its step runs: the log streams while it is shown. */
  readonly live: boolean;
}

export interface PipelineView {
  readonly read: PipelineRead;
  /** The record, once known and of the organization the account observes. */
  readonly pipeline: PipelineValue | null;
  /** The name the deploy was given, where Zerops says it. */
  readonly name: string | null;
  /** The zerops.yaml it ran and its setup, once the organization's search answered. */
  readonly config: string | null;
  readonly setup: string | null;
  readonly projectName: string | null;
  readonly serviceName: string | null;
  /** Its process, where the project's recent processes still hold it. */
  readonly process: ActivityProcess | undefined;
  readonly readout: PipelineReadout | undefined;
  /** The pipeline runs: its steps tick, and the running step's log streams. */
  readonly live: boolean;
  readonly logs: Readonly<Partial<Record<PipelineLogKind, PipelineLog>>>;
  /** The log that tells most now: the running step's, else the failed step's, else the build's. */
  readonly telling: PipelineLogKind | null;
  /** The person's Try again on the record's read. */
  readonly again: () => void;
}

/** How long before and after a deploy's failure the service's own log is read. */
const AROUND_FAILURE_MS = 60_000;

export function usePipeline(versionId: string, orgId: string | null): PipelineView {
  useDetailDemand("pipeline", undefined, versionId);
  const retryDetail = useAccountDataOptional()?.retryDetail;
  const read = useAtomValue(pipelineReadAtom(versionId));
  const pipeline = read.kind === "known" && read.value.organizationId === orgId ? read.value : null;
  // Its name and zerops.yaml: searched within its own organization, once it is the one observed.
  useDetailDemand("pipelineConfig", undefined, pipeline === null ? null : versionId);
  const ran = useAtomValue(pipelineConfigAtom(versionId));
  const projectId = pipeline?.projectId ?? null;
  const activity = useProjectActivity(projectId);
  const project = useAtomValue(projectId === null ? NO_PROJECT : listedProjectAtom(projectId));
  const services = useAtomValue(
    projectId === null ? NO_SERVICES : projectServicesAtom(projectId),
  ).services;
  const service = services?.find((entry) => entry.id === pipeline?.serviceId);
  // The pipeline's own process — its build, or a deploy without one — never another process
  // that names the version, such as its activation as a backup.
  const process = activity.processes?.find(
    (entry) => entry.appVersion?.id === versionId && PIPELINE_ACTIONS.has(entry.actionName),
  );
  // The process carries the version as the platform's live stream last said it; the record only
  // as its one read found it.
  const carried = process?.appVersion ?? pipeline?.appVersion;
  // The read by id leaves out the name the steps' sentences say: the search's, where it answered.
  const appVersion =
    carried === undefined || carried.name !== undefined || ran?.name == null
      ? carried
      : { ...carried, name: ran.name };
  const running =
    process === undefined
      ? pipeline !== null && !SETTLED.has(pipeline.status)
      : process.status === "RUNNING" || process.status === "PENDING";
  const live =
    appVersion !== undefined &&
    running &&
    pipelineTerminalOutcome(getPipelineState(appVersion)) === undefined;
  const nowMs = useSecondsNowMs(live);
  const serviceName = service?.name ?? null;
  const readout =
    appVersion === undefined
      ? undefined
      : readPipeline(appVersion, {
          nowMs,
          ...(serviceName === null ? {} : { serviceName }),
          ...(service?.serviceStackTypeInfo?.serviceStackTypeName === undefined
            ? {}
            : { serviceType: service.serviceStackTypeInfo.serviceStackTypeName }),
          ...(process === undefined ? {} : { actionStartedAt: process.created }),
        });
  const logs =
    appVersion === undefined || pipeline === null
      ? {}
      : pipelineLogs(appVersion, pipeline, readout, process?.id ?? versionId);
  return {
    read,
    pipeline,
    name: ran?.name ?? process?.appVersion?.name ?? null,
    config: ran?.config ?? null,
    setup: ran?.setup ?? null,
    projectName: project?.name ?? null,
    serviceName,
    process,
    readout,
    live,
    logs,
    telling: tellingLog(readout, logs),
    again: () => retryDetail?.({ family: "pipeline", ownerId: versionId }),
  };
}

const BUILD_STEPS: ReadonlySet<string> = new Set(["INIT_BUILD_CONTAINER", "RUN_BUILD_COMMANDS"]);
const PREPARE_STEPS: ReadonlySet<string> = new Set([
  "INIT_PREPARE_CONTAINER",
  "RUN_PREPARE_COMMANDS",
]);

const stepRuns = (readout: PipelineReadout | undefined, steps: ReadonlySet<string>) =>
  readout?.steps.some(
    (step) => steps.has(step.id) && (step.state === "running" || step.state === "activating"),
  ) ?? false;

/**
 * Each log the pipeline has: the build's (its builder's lines, `zbuilder@<id>`), the runtime
 * prepare's (the prepare container's own service, untagged — the GUI's prepare log), and for a
 * failed deploy the service's own lines a minute either side of the failure (the GUI's "runtime
 * container error in full service log"). An untagged read is keyed by the pipeline's process,
 * else its version: `processId` only names the read.
 */
function pipelineLogs(
  appVersion: ActivityAppVersion,
  pipeline: PipelineValue,
  readout: PipelineReadout | undefined,
  readKey: string,
): Partial<Record<PipelineLogKind, PipelineLog>> {
  const logs: Partial<Record<PipelineLogKind, PipelineLog>> = {};
  const build = buildLogFor({ appVersion });
  if (build !== undefined) logs.build = { query: build, live: stepRuns(readout, BUILD_STEPS) };
  const prepareService = appVersion.prepareCustomRuntime?.serviceStackId;
  if (prepareService !== undefined) {
    logs.prepare = {
      query: { buildServiceStackId: prepareService, processId: `${readKey}:prepare` },
      live: stepRuns(readout, PREPARE_STEPS),
    };
  }
  const deployFailed = readout?.steps.some(
    (step) => step.id === "DEPLOY" && step.state === "failed",
  );
  const failedAt = Date.parse(appVersion.build?.pipelineFailed ?? "");
  if (deployFailed === true && !Number.isNaN(failedAt)) {
    logs.service = {
      query: {
        buildServiceStackId: pipeline.serviceId,
        processId: `${readKey}:service`,
        fromIso: new Date(failedAt - AROUND_FAILURE_MS).toISOString(),
        tillIso: new Date(failedAt + AROUND_FAILURE_MS).toISOString(),
      },
      live: false,
    };
  }
  return logs;
}

function tellingLog(
  readout: PipelineReadout | undefined,
  logs: Partial<Record<PipelineLogKind, PipelineLog>>,
): PipelineLogKind | null {
  const current = readout?.currentStepId;
  if (current !== undefined) {
    if (PREPARE_STEPS.has(current) && logs.prepare !== undefined) return "prepare";
    if (current === "DEPLOY" && logs.service !== undefined) return "service";
    if (logs.build !== undefined) return "build";
  }
  return logs.build !== undefined ? "build" : logs.prepare !== undefined ? "prepare" : null;
}

/** The processes that run a pipeline (the GUI's pipeline history lists these alone). */
const PIPELINE_ACTIONS: ReadonlySet<string> = new Set(["stack.build", "stack.deploy"]);

/** Statuses a version stays in once its pipeline ended. */
const SETTLED: ReadonlySet<string> = new Set([
  "ACTIVE",
  "BACKUP",
  "BUILD_FAILED",
  "DEPLOY_FAILED",
  "PREPARING_RUNTIME_FAILED",
  "BUILD_VALIDATION_FAILED",
  "CANCELLED",
]);

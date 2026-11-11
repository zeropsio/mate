/**
 * One pipeline as its dialog reads it: the app version by id (what started it, and its steps as
 * that read found them), joined with the project's process for it — whose embedded version is
 * the live one while it runs, and whose error says why it failed — and its build log, streamed
 * while the build runs.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  listedProjectAtom,
  NOT_READ_SERVICES,
  pipelineReadAtom,
  projectServicesAtom,
  type PipelineRead,
  type PipelineValue,
} from "@t3tools/client-runtime/data";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
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
import { useBuildLog, type UseBuildLogResult } from "./useBuildLog";
import { useProjectActivity } from "./useProjectActivity";

const NO_PROJECT = Atom.make(null);
const NO_SERVICES = Atom.make(NOT_READ_SERVICES);

export interface PipelineView {
  readonly read: PipelineRead;
  /** The record, once known and of the organization the account observes. */
  readonly pipeline: PipelineValue | null;
  readonly projectName: string | null;
  readonly serviceName: string | null;
  /** Its process, where the project's recent processes still hold it. */
  readonly process: ActivityProcess | undefined;
  readonly readout: PipelineReadout | undefined;
  /** The pipeline runs: its steps tick, and its log streams. */
  readonly live: boolean;
  readonly buildLog: UseBuildLogResult;
  /** Whether the build log has anything to read: a build ran or runs. */
  readonly hasBuildLog: boolean;
  /** The person's Try again on the record's read. */
  readonly again: () => void;
}

export function usePipeline(versionId: string, orgId: string | null): PipelineView {
  useDetailDemand("pipeline", undefined, versionId);
  const retryDetail = useAccountDataOptional()?.retryDetail;
  const read = useAtomValue(pipelineReadAtom(versionId));
  const pipeline = read.kind === "known" && read.value.organizationId === orgId ? read.value : null;
  const projectId = pipeline?.projectId ?? null;
  const activity = useProjectActivity(projectId);
  const project = useAtomValue(projectId === null ? NO_PROJECT : listedProjectAtom(projectId));
  const services = useAtomValue(
    projectId === null ? NO_SERVICES : projectServicesAtom(projectId),
  ).services;
  const service = services?.find((entry) => entry.id === pipeline?.serviceId);
  const process = activity.processes?.find((entry) => entry.appVersion?.id === versionId);
  // The process carries the version as the platform's live stream last said it; the record only
  // as its one read found it.
  const appVersion = process?.appVersion ?? pipeline?.appVersion;
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
          ...(process === undefined ? {} : { actionStartedAt: process.created }),
        });
  const query = appVersion === undefined ? undefined : buildLogFor({ appVersion });
  const buildLog = useBuildLog({ projectId, query: query ?? null, live });
  return {
    read,
    pipeline,
    projectName: project?.name ?? null,
    serviceName,
    process,
    readout,
    live,
    buildLog,
    hasBuildLog: query !== undefined,
    again: () => retryDetail?.({ family: "pipeline", ownerId: versionId }),
  };
}

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

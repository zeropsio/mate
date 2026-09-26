/**
 * The Zerops GUI's human reading of one pipeline, ported from frontend-legacy:
 * the step states are `getPipelineState` (`pipelineState.ts`); which steps
 * show, each step's start and end, the overall line and "Calculating steps
 * from zerops.yml" are `pipeline-detail.feature.html`; each step's sentence
 * is its `build-state-steps/modules/<step>/<step>.component.html`; the
 * headline word is `pipeline-desc.component.ts`'s `statusName`.
 *
 * The GUI's own semantics stand where they read oddly — a failure ends every
 * earlier step's duration, a waiting step counts from its start, prepare
 * commands running read "Finished". Two readings are this port's own: a
 * step the GUI draws empty (`noop`, a status it does not read) is not
 * listed, and an activating deploy keeps its running sentence, since the GUI
 * has none for it. The GUI's docs links and "please contact support" tails
 * are dropped; every other word is the GUI's.
 *
 * Pure: every duration is measured against the `nowMs` it is read with — the
 * render clock — never against the moment the app version was read.
 */
import type { ActivityAppVersion } from "./dto.ts";
import { type PipelineState, type PipelineStepStatus, getPipelineState } from "./pipelineState.ts";

export type PipelineStepId = keyof PipelineState;

export type PipelineStepLabel =
  | "Build container"
  | "Build"
  | "Prepare container"
  | "Prepare runtime"
  | "Deploy";

export type PipelineTone = "waiting" | "running" | "finished" | "failed" | "cancelled";

/** The pipeline as one word, in the GUI's words. */
export interface PipelineHeadline {
  readonly tone: PipelineTone;
  readonly word: "Waiting to run" | "Running" | "Finished" | "Failed" | "Cancelled";
}

export type PipelineOverallLabel =
  | "Running for"
  | "Finished in"
  | "Failed after"
  | "Cancelled after";

/** "Running for 1m 12s", "Finished in 3m 1s at …". */
export interface PipelineOverall {
  readonly label: PipelineOverallLabel;
  readonly durationMs: number;
  /** When it finished, failed or was cancelled — absent while it runs. */
  readonly endedAt?: string;
}

export interface PipelineReadoutStep {
  readonly id: PipelineStepId;
  readonly label: PipelineStepLabel;
  readonly state: PipelineStepStatus;
  /** What the step does, did or failed to do, in the GUI's words. */
  readonly sentence: string;
  /** A running deploy's "Preparing upgrade…", once whether the service ran containers is known. */
  readonly note?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  /** `endedAt − startedAt`, or the clock's `now − startedAt` while nothing ended it. */
  readonly durationMs?: number;
}

export interface PipelineReadout {
  readonly status: PipelineHeadline;
  /** The platform is still working out the steps from zerops.yml: none is listed yet. */
  readonly calculating: boolean;
  /** Absent while calculating, for a deploy-only pipeline, and before the pipeline's start is known. */
  readonly overall?: PipelineOverall;
  /** The step that is running, else the one that failed. */
  readonly currentStepId?: PipelineStepId;
  /** The steps this pipeline has, in order. */
  readonly steps: ReadonlyArray<PipelineReadoutStep>;
}

export interface ReadPipelineOptions {
  /** The render clock, epoch ms. */
  readonly nowMs: number;
  /** The service the deploy upgrades. */
  readonly serviceName?: string;
  /** The platform's name for the service's type, e.g. `Node.js`. */
  readonly serviceType?: string;
  /** When the process began: a deploy-only pipeline's deploy step starts there. */
  readonly actionStartedAt?: string;
  /** Whether the service ran containers before this pipeline — the GUI's old/new container split. */
  readonly hadContainers?: boolean;
}

const LABEL: Readonly<Record<PipelineStepId, PipelineStepLabel>> = {
  INIT_BUILD_CONTAINER: "Build container",
  RUN_BUILD_COMMANDS: "Build",
  INIT_PREPARE_CONTAINER: "Prepare container",
  RUN_PREPARE_COMMANDS: "Prepare runtime",
  DEPLOY: "Deploy",
};

type SpokenState = Exclude<PipelineStepStatus, "noop">;

/** The four fixed-word steps; the deploy step's sentence names the version and the service. */
const SENTENCE: Readonly<
  Record<Exclude<PipelineStepId, "DEPLOY">, Readonly<Record<SpokenState, string>>>
> = {
  INIT_BUILD_CONTAINER: {
    waiting: "Initialize build container",
    running: "Initializing build container",
    activating: "Initializing build container",
    finished: "Initialized build container",
    cancelled: "Cancelled while creating build container, please try again",
    failed: "Failed while creating build container, please try again",
  },
  RUN_BUILD_COMMANDS: {
    waiting: "Run build commands from zerops.yml",
    running: "Running build commands from zerops.yml",
    activating: "Running build commands from zerops.yml",
    finished: "Build commands from zerops.yml ran successfully",
    failed: "Build commands from zerops.yml failed",
    cancelled: "Couldn't start build container, build step cancelled",
  },
  INIT_PREPARE_CONTAINER: {
    waiting: "Initialize runtime prepare container",
    running: "Initializing runtime prepare container",
    activating: "Initializing runtime prepare container",
    finished: "Initialized runtime prepare container",
    failed: "Failed while creating runtime prepare container, please try again",
    cancelled: "Cancelled initialization of runtime prepare container",
  },
  RUN_PREPARE_COMMANDS: {
    waiting: "Run runtime prepare commands from zerops.yml",
    running: "Running runtime prepare commands from zerops.yml",
    activating: "Running runtime prepare commands from zerops.yml",
    finished: "Runtime prepare commands from zerops.yml ran successfully",
    failed: "Runtime prepare commands from zerops.yml failed",
    cancelled: "Couldn't start runtime prepare container, prepare step cancelled",
  },
};

const FULL_SHA = /^[0-9a-f]{40}$/u;
const SHORT_SHA_LENGTH = 7;

/** A version as words name it: a full commit sha shortens to its first seven, any other name stays whole. */
export function displayVersionName(name: string): string {
  return FULL_SHA.test(name) ? name.slice(0, SHORT_SHA_LENGTH) : name;
}

function deploySentence(
  state: SpokenState,
  appVersion: ActivityAppVersion,
  options: ReadPipelineOptions,
): string {
  const version =
    appVersion.name === undefined
      ? "app version"
      : `app version ${displayVersionName(appVersion.name)}`;
  const service = options.serviceName ?? "the service";
  const type = options.serviceType;
  // "upgrade Node.js service appstage", or the named service alone.
  const upgraded =
    type === undefined
      ? service
      : options.serviceName === undefined
        ? `the ${type} service`
        : `${type} service ${options.serviceName}`;
  // "appstage (Node.js)", the GUI's form where the sentence speaks of a failure.
  const named = type === undefined ? service : `${service} (${type})`;
  switch (state) {
    case "waiting":
      return `Create ${version} and upgrade ${upgraded}`;
    case "running":
    case "activating":
      return `Creating ${version} and upgrading ${upgraded}`;
    case "finished":
      return `Created ${version} and upgraded ${upgraded}`;
    case "failed":
      return `Failed while creating ${version} or upgrading ${named}`;
    case "cancelled":
      return `Cancelled ${version} creation and deploy to ${named}`;
  }
}

function parseMs(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

interface Span {
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
}

/**
 * The GUI's `zui-duration`: nothing without a start, the clock's `now` in
 * place of a missing end. A timestamp that does not parse counts as missing.
 */
function span(start: string | undefined, end: string | undefined, nowMs: number): Span {
  const startMs = parseMs(start);
  if (startMs === undefined) {
    return {};
  }
  const endMs = parseMs(end);
  return {
    startedAt: start!,
    ...(endMs === undefined ? {} : { endedAt: end! }),
    durationMs: Math.max(0, (endMs ?? nowMs) - startMs),
  };
}

/** Each step's start and end, as `pipeline-detail.feature.html` binds its `zui-duration`. */
function stepSpan(
  id: PipelineStepId,
  state: PipelineStepStatus,
  appVersion: ActivityAppVersion,
  options: ReadPipelineOptions,
): Span {
  const build = appVersion.build;
  const prepare = appVersion.prepareCustomRuntime;
  const failedAt = build?.pipelineFailed;
  switch (id) {
    case "INIT_BUILD_CONTAINER":
      return span(
        build?.pipelineStart,
        failedAt === undefined ? build?.startDate : (build?.startDate ?? failedAt),
        options.nowMs,
      );
    case "RUN_BUILD_COMMANDS":
      return span(build?.startDate, failedAt ?? build?.endDate, options.nowMs);
    case "INIT_PREPARE_CONTAINER":
      if (state === "cancelled") {
        return {};
      }
      return build === undefined
        ? span(prepare?.containerCreationStart, prepare?.startDate, options.nowMs)
        : span(build.endDate, failedAt ?? prepare?.startDate, options.nowMs);
    case "RUN_PREPARE_COMMANDS":
      return span(prepare?.startDate, failedAt ?? prepare?.endDate, options.nowMs);
    case "DEPLOY": {
      const start =
        prepare?.endDate ??
        (prepare === undefined
          ? build === undefined
            ? options.actionStartedAt
            : build.endDate
          : undefined);
      return span(start, failedAt ?? appVersion.activationDate, options.nowMs);
    }
  }
}

/** The overall line: a full pipeline's from its build, a build-less one's from its prepare. */
function overallLine(appVersion: ActivityAppVersion, nowMs: number): PipelineOverall | undefined {
  const build = appVersion.build;
  const prepare = appVersion.prepareCustomRuntime;
  let label: PipelineOverallLabel;
  let measured: Span;
  if (build !== undefined) {
    const failedAt = build.pipelineFailed;
    label =
      failedAt !== undefined
        ? appVersion.status === "CANCELLED"
          ? "Cancelled after"
          : "Failed after"
        : build.pipelineFinish !== undefined
          ? "Finished in"
          : "Running for";
    measured = span(build.pipelineStart, failedAt ?? build.pipelineFinish, nowMs);
  } else if (prepare !== undefined) {
    const failed = appVersion.status === "PREPARING_RUNTIME_FAILED";
    label = failed
      ? "Failed after"
      : appVersion.activationDate !== undefined
        ? "Finished in"
        : "Running for";
    measured = span(
      prepare.containerCreationStart,
      failed ? prepare.endDate : appVersion.activationDate,
      nowMs,
    );
  } else {
    return undefined;
  }
  return measured.durationMs === undefined
    ? undefined
    : {
        label,
        durationMs: measured.durationMs,
        ...(measured.endedAt === undefined ? {} : { endedAt: measured.endedAt }),
      };
}

const FAILED_STATUSES: ReadonlySet<string> = new Set([
  "BUILD_VALIDATION_FAILED",
  "BUILD_FAILED",
  "DEPLOY_FAILED",
  "PREPARING_RUNTIME_FAILED",
]);

/**
 * `statusName`, the GUI's precedence: cancelled over failed over running over
 * waiting, else finished. It counts neither the prepare commands nor an
 * activating deploy as running. Its zerops.yml-error branch reads a
 * notification's error code, which a process does not carry.
 */
function headline(state: PipelineState, appVersion: ActivityAppVersion): PipelineHeadline {
  if (appVersion.status === "CANCELLED") {
    return { tone: "cancelled", word: "Cancelled" };
  }
  if (appVersion.status !== undefined && FAILED_STATUSES.has(appVersion.status)) {
    return { tone: "failed", word: "Failed" };
  }
  if (
    state.INIT_BUILD_CONTAINER === "running" ||
    state.INIT_PREPARE_CONTAINER === "running" ||
    state.RUN_BUILD_COMMANDS === "running" ||
    state.DEPLOY === "running"
  ) {
    return { tone: "running", word: "Running" };
  }
  if (
    state.INIT_BUILD_CONTAINER === "waiting" ||
    (appVersion.build === undefined && state.DEPLOY === "waiting")
  ) {
    return { tone: "waiting", word: "Waiting to run" };
  }
  return { tone: "finished", word: "Finished" };
}

/** A build pair only with a build, a prepare pair only with a prepare, the deploy always. */
function visibleStepIds(appVersion: ActivityAppVersion): ReadonlyArray<PipelineStepId> {
  return [
    ...(appVersion.build === undefined
      ? []
      : (["INIT_BUILD_CONTAINER", "RUN_BUILD_COMMANDS"] as const)),
    ...(appVersion.prepareCustomRuntime === undefined
      ? []
      : (["INIT_PREPARE_CONTAINER", "RUN_PREPARE_COMMANDS"] as const)),
    "DEPLOY",
  ];
}

/** The GUI shows this under a running deploy until its new containers appear. */
function preparingNote(hadContainers: boolean | undefined): string | undefined {
  if (hadContainers === undefined) {
    return undefined;
  }
  return hadContainers ? "Preparing upgrade…" : "Preparing to create first containers…";
}

export function readPipeline(
  appVersion: ActivityAppVersion,
  options: ReadPipelineOptions,
): PipelineReadout {
  const state = getPipelineState(appVersion);
  const status = headline(state, appVersion);
  if (state.INIT_BUILD_CONTAINER === "waiting") {
    return { status, calculating: true, steps: [] };
  }

  const steps = visibleStepIds(appVersion).flatMap((id): ReadonlyArray<PipelineReadoutStep> => {
    const stepState = state[id];
    if (stepState === "noop") {
      return [];
    }
    const note =
      id === "DEPLOY" && stepState === "running" ? preparingNote(options.hadContainers) : undefined;
    return [
      {
        id,
        label: LABEL[id],
        state: stepState,
        sentence:
          id === "DEPLOY"
            ? deploySentence(stepState, appVersion, options)
            : SENTENCE[id][stepState],
        ...(note === undefined ? {} : { note }),
        ...stepSpan(id, stepState, appVersion, options),
      },
    ];
  });
  const current =
    steps.find((entry) => entry.state === "running" || entry.state === "activating") ??
    steps.find((entry) => entry.state === "failed");
  const overall = overallLine(appVersion, options.nowMs);

  return {
    status,
    calculating: false,
    ...(overall === undefined ? {} : { overall }),
    ...(current === undefined ? {} : { currentStepId: current.id }),
    steps,
  };
}

const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
/** From here on a duration drops its seconds. */
const SECONDS_UNTIL_S = 10 * MINUTE_S;

/**
 * "42s", "1m 12s", "13m", "2h 6m" — whole seconds, no seconds past ten
 * minutes, and nothing at all under a second.
 */
export function formatDuration(durationMs: number): string | undefined {
  if (!Number.isFinite(durationMs) || durationMs < 1_000) {
    return undefined;
  }
  const totalSeconds = Math.floor(durationMs / 1_000);
  if (totalSeconds < MINUTE_S) {
    return `${totalSeconds}s`;
  }
  if (totalSeconds < SECONDS_UNTIL_S) {
    const seconds = totalSeconds % MINUTE_S;
    const minutes = Math.floor(totalSeconds / MINUTE_S);
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  if (totalSeconds < HOUR_S) {
    return `${Math.floor(totalSeconds / MINUTE_S)}m`;
  }
  const hours = Math.floor(totalSeconds / HOUR_S);
  const minutes = Math.floor((totalSeconds % HOUR_S) / MINUTE_S);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/**
 * `zerops_standup` — zcp stands a new Mate's development up from its group's
 * recipe, in two calls of one turn: the first deploys the dev halves of the
 * tier's pairs, the second the stages. A call is named by the half it
 * deploys: "Standing development up", "Standing stage up".
 *
 * While a call runs, the half is read off the stand-up before it in the
 * thread: a call after one whose dev halves all run code and whose stages do
 * not yet is the stage call; any other is the development call (the first,
 * or a retry after a dev half failed). Settled, its own report says it: the
 * halves it deployed. Its steps are those services, one each, with the
 * address each one answers on as its link — the result row reads them.
 *
 * What runs while the call does is the platform's, never the report's: the
 * card reads the project's builds (`activity/standupReading.ts`).
 */
import { readString } from "../../cards/decode.ts";
import type { StandupHalf } from "../../activity/standupReading.ts";
import type {
  ZeropsCall,
  ZeropsOperationLink,
  ZeropsOperationPhase,
  ZeropsOperationStep,
} from "../types.ts";
import {
  type BuiltCardFields,
  type OperationBuildContext,
  decodeCall,
  errorInfoFor,
  explanationField,
  failedCallReason,
  firstLine,
  phaseFor,
} from "./shared.ts";

interface ReportedService {
  readonly hostname: string;
  readonly role: string;
  /** zcp's pair-level failure: the pair stopped before its deploy (a checkout, an adopt). */
  readonly failed?: string;
  readonly deploy?: {
    readonly status: string;
    readonly url?: string;
    readonly reason?: string;
  };
}

const RUNS_CODE: ReadonlySet<string> = new Set(["deployed", "already deployed"]);
/** What a call did to a service, not what it found there. */
const DEPLOYED_NOW: ReadonlySet<string> = new Set(["deployed", "failed", "still building"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function reportedServices(call: ZeropsCall): ReadonlyArray<ReportedService> | undefined {
  const services = decodeCall(call).document?.services;
  if (!Array.isArray(services)) return undefined;
  return services.flatMap((entry): ReportedService[] => {
    if (!isRecord(entry)) return [];
    const hostname = readString(entry.hostname);
    const role = readString(entry.role);
    if (hostname === undefined || role === undefined) return [];
    const deploy = isRecord(entry.deploy) ? entry.deploy : undefined;
    const status = readString(deploy?.status);
    const url = readString(deploy?.url);
    const reason = readString(deploy?.reason);
    const failed = readString(entry.failed);
    return [
      {
        hostname,
        role,
        ...(failed === undefined ? {} : { failed }),
        ...(deploy === undefined || status === undefined
          ? {}
          : {
              deploy: {
                status,
                ...(url === undefined ? {} : { url }),
                ...(reason === undefined ? {} : { reason }),
              },
            }),
      },
    ];
  });
}

const runsCode = (service: ReportedService) => RUNS_CODE.has(service.deploy?.status ?? "");
const deployedNow = (service: ReportedService) => DEPLOYED_NOW.has(service.deploy?.status ?? "");
const isQueued = (service: ReportedService) => service.deploy?.status === QUEUED;

/** zcp's `standUp` of a first call: every dev half stands, the stages queued. */
const DEVELOPMENT_STOOD = "development";
/** zcp's word for a stage the next call builds. */
const QUEUED = "queued";
/** zcp's word for a half held back by what it waits for. */
const NOT_DEPLOYED = "not deployed";
/** A held stage's step label: it waits on what did not stand up. */
const HELD_LABEL = "Waits";
/** A queued stage's step label: the next call builds it. */
const NEXT_LABEL = "Next";

/** What a stand-up step is to its call: its own, the next call's, or held back by what did not stand up. */
export function standupStepRole(step: ZeropsOperationStep): "own" | "next" | "held" {
  if (step.state !== "queued") return "own";
  return step.stateLabel === HELD_LABEL ? "held" : "next";
}

interface Report {
  readonly standUp: string | undefined;
  readonly services: ReadonlyArray<ReportedService>;
}

function readReport(call: ZeropsCall): Report | undefined {
  const services = reportedServices(call);
  if (services === undefined) return undefined;
  return { standUp: readString(decodeCall(call).document?.standUp), services };
}

/**
 * What a running call deploys, from the stand-up before it: after a
 * development call (its `standUp` says so), the stages it queued; after a
 * report that does not say, stage once every dev half runs and a stage does
 * not; else development — the first call, or a retry after a dev half failed.
 */
function callAfter(earlier: ReadonlyArray<ZeropsCall>): {
  readonly half: StandupHalf;
  readonly queued: ReadonlyArray<ReportedService>;
} {
  const report = earlier
    .filter((call) => call.status !== "inProgress")
    .map(readReport)
    .findLast((candidate) => candidate !== undefined);
  if (report === undefined) return { half: "development", queued: [] };
  const queued = report.services.filter(isQueued);
  if (report.standUp === DEVELOPMENT_STOOD) return { half: "stage", queued };
  const devs = report.services.filter((service) => service.role === "dev");
  const stages = report.services.filter((service) => service.role === "stage");
  return devs.length > 0 && devs.every(runsCode) && stages.some((stage) => !runsCode(stage))
    ? { half: "stage", queued }
    : { half: "development", queued: [] };
}

/**
 * The half a settled call deployed, by its report: a development call says
 * so, else the halves it built — any dev half makes it development. Undefined
 * when it built nothing.
 */
function halfDeployed(report: Report): StandupHalf | undefined {
  if (report.standUp === DEVELOPMENT_STOOD) return "development";
  const now = report.services.filter(deployedNow);
  if (now.length === 0) return undefined;
  return now.some((service) => service.role === "dev") ? "development" : "stage";
}

/** A stage the next call builds: coming, never failed. */
function nextStep(service: ReportedService): ZeropsOperationStep {
  return { id: service.hostname, label: service.hostname, state: "queued", stateLabel: NEXT_LABEL };
}

/**
 * What held a stage back, as the person reads it: "apistage did not stand up"
 * — from zcp's reason ("waits for apistage, which did not stand up: …",
 * "apidev did not deploy, and the stage is built from it").
 */
function heldBy(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  const waited = /^waits for (.+?), which (?:did not stand up|builds on the next)/u.exec(reason);
  if (waited?.[1] !== undefined) return `${waited[1]} did not stand up`;
  const built = /^(\S+) did not (?:deploy|stand up)/u.exec(reason);
  if (built?.[1] !== undefined) return `${built[1]} did not stand up`;
  return firstLine(reason);
}

function stepOf(service: ReportedService): ZeropsOperationStep {
  const status = service.deploy?.status;
  const base = { id: service.hostname, label: service.hostname };
  if (status === undefined) {
    // The pair stopped before its deploy: its failure is zcp's pair-level one.
    return {
      ...base,
      state: "failed",
      stateLabel: "Failed",
      ...(service.failed === undefined ? {} : { note: service.failed }),
    };
  }
  if (status === QUEUED) return nextStep(service);
  if (status === "deployed") return { ...base, state: "done", stateLabel: "Deployed" };
  if (status === "already deployed") return { ...base, state: "done", stateLabel: "Running" };
  if (status === "still building") return { ...base, state: "running", stateLabel: "Building" };
  const reason = service.deploy?.reason;
  if (status === NOT_DEPLOYED) {
    // Held back by what it waits for: it waits, it did not fail.
    const held = heldBy(reason);
    return {
      ...base,
      state: "queued",
      stateLabel: HELD_LABEL,
      ...(held === undefined ? {} : { note: held }),
    };
  }
  return {
    ...base,
    state: "failed",
    stateLabel: "Failed",
    ...(reason === undefined ? {} : { note: reason }),
  };
}

/**
 * The services a settled call answers for: those of its half it built, found
 * failing or held back; a development call also each stage it built (a retry
 * builds the stage of a dev half that already ran) and each stage it queued,
 * named as next. A stage held back because its own dev half failed is that
 * dev half's story; a service it found already running is no work of its.
 */
function callServices(report: Report, half: StandupHalf): ReadonlyArray<ReportedService> {
  return report.services.filter((service) => {
    const status = service.deploy?.status;
    if (status === "already deployed") return false;
    if (half === "development") {
      if (service.role === "dev") return status !== undefined || service.failed !== undefined;
      return (
        service.role === "stage" &&
        status !== undefined &&
        (isQueued(service) || deployedNow(service))
      );
    }
    return (
      service.role === "stage" &&
      !isQueued(service) &&
      (status !== undefined || service.failed !== undefined)
    );
  });
}

export function buildStandupFields(
  call: ZeropsCall,
  _context: OperationBuildContext,
  earlier: ReadonlyArray<ZeropsCall>,
): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const report = call.status === "inProgress" ? undefined : readReport(call);
  const after = callAfter(earlier);
  const half = (report === undefined ? undefined : halfDeployed(report)) ?? after.half;
  const answered = report === undefined ? undefined : callServices(report, half);
  // Running, a stage call's services are the stages the call before it queued.
  const steps = (answered ?? (half === after.half ? after.queued : [])).map(stepOf);
  const links: ZeropsOperationLink[] = (answered ?? []).flatMap((service) =>
    service.deploy?.url === undefined ? [] : [{ label: service.hostname, url: service.deploy.url }],
  );
  const failedStep = steps.find((step) => step.state === "failed");
  const standUp = report?.standUp;
  const phase: ZeropsOperationPhase =
    // A partial whose only open step still builds is no failure: zcp stopped
    // waiting for the build, which goes on.
    call.status === "completed" && (failedStep !== undefined || standUp === "failed")
      ? "failed"
      : phaseFor(call.status);
  const message = readString(decoded.document?.message);
  const explanation =
    errorInfo !== undefined
      ? explanationField(failedCallReason(decoded, errorInfo))
      : explanationField(failedStep?.note ?? (phase === "failed" ? message : undefined));
  const closing =
    phase === "running"
      ? undefined
      : errorInfo !== undefined
        ? firstLine(readString(decoded.document?.message) ?? errorInfo.message)
        : (message ?? (phase === "done" ? "Finished." : "Failed."));

  return {
    subject: half,
    kicker: `Stand-up · ${half}`,
    voice: `Standing ${half} up.`,
    voiceSource: "mate",
    statusWord: phase === "running" ? "Standing up" : phase === "done" ? "Stood up" : "Failed",
    ...(closing === undefined ? {} : { closing }),
    steps,
    links,
    hasResult: decoded.document !== undefined,
    ...explanation,
    phaseOverride: phase,
  };
}

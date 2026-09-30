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
    return [
      {
        hostname,
        role,
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

const ROLE: Readonly<Record<StandupHalf, string>> = { development: "dev", stage: "stage" };

/** A stage the next call builds: coming, never failed. */
function nextStep(service: ReportedService): ZeropsOperationStep {
  return { id: service.hostname, label: service.hostname, state: "queued", stateLabel: "Next" };
}

function stepOf(service: ReportedService): ZeropsOperationStep {
  const status = service.deploy?.status ?? "";
  const base = { id: service.hostname, label: service.hostname };
  if (status === QUEUED) return nextStep(service);
  if (status === "deployed") return { ...base, state: "done", stateLabel: "Deployed" };
  if (status === "already deployed") return { ...base, state: "done", stateLabel: "Running" };
  if (status === "still building") return { ...base, state: "running", stateLabel: "Building" };
  const reason = service.deploy?.reason;
  return {
    ...base,
    state: "failed",
    stateLabel: status === "failed" ? "Failed" : "Not deployed",
    ...(reason === undefined ? {} : { note: reason }),
  };
}

/**
 * The services a settled call answers for: those of its half it deployed or
 * found in its way, and — a development call — each stage it queued, named as
 * next. A stage it left because its dev half failed is that dev half's story.
 */
function callServices(report: Report, half: StandupHalf): ReadonlyArray<ReportedService> {
  return report.services.filter(
    (service) =>
      service.deploy !== undefined &&
      (half === "development"
        ? service.role === "dev" || (service.role === "stage" && isQueued(service))
        : service.role === ROLE[half] && !isQueued(service)),
  );
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
    call.status === "completed" &&
    (failedStep !== undefined || standUp === "failed" || standUp === "partial")
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

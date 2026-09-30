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

/** The half a call deploys, from the stand-up before it: stage once development runs and stage does not. */
function halfAfter(earlier: ReadonlyArray<ZeropsCall>): StandupHalf {
  const report = earlier
    .filter((call) => call.status !== "inProgress")
    .map(reportedServices)
    .findLast((services) => services !== undefined);
  if (report === undefined) return "development";
  const devs = report.filter((service) => service.role === "dev");
  const stages = report.filter((service) => service.role === "stage");
  return devs.length > 0 && devs.every(runsCode) && stages.some((stage) => !runsCode(stage))
    ? "stage"
    : "development";
}

/** The half a settled call deployed, by its report; undefined when it deployed nothing. */
function halfDeployed(services: ReadonlyArray<ReportedService>): StandupHalf | undefined {
  const now = services.filter((service) => DEPLOYED_NOW.has(service.deploy?.status ?? ""));
  if (now.length === 0) return undefined;
  return now.every((service) => service.role === "stage") ? "stage" : "development";
}

const ROLE: Readonly<Record<StandupHalf, string>> = { development: "dev", stage: "stage" };

function stepOf(service: ReportedService): ZeropsOperationStep {
  const status = service.deploy?.status ?? "";
  const base = { id: service.hostname, label: service.hostname };
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

export function buildStandupFields(
  call: ZeropsCall,
  _context: OperationBuildContext,
  earlier: ReadonlyArray<ZeropsCall>,
): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const services = call.status === "inProgress" ? undefined : reportedServices(call);
  const half = (services === undefined ? undefined : halfDeployed(services)) ?? halfAfter(earlier);
  const ofHalf = (services ?? []).filter(
    (service) => service.role === ROLE[half] && service.deploy !== undefined,
  );
  const steps = ofHalf.map(stepOf);
  const links: ZeropsOperationLink[] = ofHalf.flatMap((service) =>
    service.deploy?.url === undefined ? [] : [{ label: service.hostname, url: service.deploy.url }],
  );
  const failedStep = steps.find((step) => step.state === "failed");
  const standUp = readString(decoded.document?.standUp);
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

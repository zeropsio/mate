/** The latest container setup attempt, and a reason grounded in its result and log. */
import type { ActivityProcess } from "../../zerops/activity/dto.ts";
import type { BuildLogQuery } from "../../zerops/activity/buildLog.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { projectProcesses, type ProjectKey } from "./processes.ts";

const SETUP_ACTIONS = new Set([
  "stack.create",
  "stack.start",
  "stack.restart",
  "stack.build",
  "stack.deploy",
]);
const FAILED_VERSIONS = new Set([
  "BUILD_VALIDATION_FAILED",
  "BUILD_FAILED",
  "PREPARING_RUNTIME_FAILED",
  "DEPLOY_FAILED",
  "CANCELLED",
]);

export function failedSetupProcess(
  processes: ReadonlyArray<ActivityProcess> | undefined,
  serviceId: string | undefined,
): ActivityProcess | undefined {
  if (serviceId === undefined) return undefined;
  const latest = processes
    ?.filter(
      (process) =>
        SETUP_ACTIONS.has(process.actionName) && process.serviceStackIds.includes(serviceId),
    )
    .sort((a, b) => b.created.localeCompare(a.created))[0];
  if (latest === undefined) return undefined;
  if (
    latest.status === "FAILED" ||
    latest.status === "CANCELED" ||
    (latest.status === "FINISHED" && FAILED_VERSIONS.has(latest.appVersion?.status ?? ""))
  )
    return latest;
  return undefined;
}

export const setupFailure: Projection<
  ProjectKey & { readonly serviceId: string | undefined },
  ActivityProcess | undefined
> = {
  name: "setupFailure",
  keyOf: ({ orgId, projectId, serviceId }) => `${orgId}/${projectId}/${serviceId ?? ""}`,
  derive: (read, key) =>
    failedSetupProcess(projectProcesses.derive(read, key).processes, key.serviceId),
  equals: sameValue,
};

/** Runtime logs are bounded by this process's own start and end; never a previous attempt's tail. */
export function setupFailureLogQuery(
  process: ActivityProcess | undefined,
  serviceId: string | undefined,
): BuildLogQuery | null {
  if (process?.started === undefined || process.finished === undefined || serviceId === undefined)
    return null;
  const version = process.appVersion;
  const buildFailed =
    version?.status === "BUILD_FAILED" || version?.status === "BUILD_VALIDATION_FAILED";
  if (buildFailed && version?.id !== undefined && version.build?.serviceStackId !== undefined) {
    return {
      buildServiceStackId: version.build.serviceStackId,
      appVersionId: version.id,
      fromIso: process.started,
      tillIso: process.finished,
    };
  }
  return {
    buildServiceStackId:
      version?.status === "PREPARING_RUNTIME_FAILED"
        ? (version.prepareCustomRuntime?.serviceStackId ?? serviceId)
        : serviceId,
    processId: process.id,
    fromIso: process.started,
    tillIso: process.finished,
  };
}

export type SetupFailureCause =
  | "dns"
  | "network"
  | "download"
  | "digest"
  | "disk"
  | "command"
  | "timeout"
  | "unknown";

export function setupFailureReason(
  name: string,
  result: string | undefined,
  lines: ReadonlyArray<string>,
): { readonly cause: SetupFailureCause; readonly text: string; readonly details: string } {
  const evidence = [result ?? "", ...lines].join("\n");
  const rules: ReadonlyArray<readonly [SetupFailureCause, RegExp, string]> = [
    [
      "dns",
      /could not resolve host|temporary failure in name resolution|name or service not known|ENOTFOUND|EAI_AGAIN/iu,
      "the project can't reach the internet (DNS). This is a Zerops platform problem — try again later or contact Zerops support.",
    ],
    [
      "network",
      /network is unreachable|no route to host|failed to connect|connection (?:refused|reset)|could not connect/iu,
      "the project couldn't connect to the download server. Try again later or contact Zerops support if it continues.",
    ],
    [
      "disk",
      /no space left on device|ENOSPC|disk (?:is )?full/iu,
      "the project ran out of disk space. Free space or increase its storage, then try again.",
    ],
    [
      "digest",
      /(?:digest|checksum|sha-?256).*(?:mismatch|failed|invalid|does not match)|integrity check failed/iu,
      "the downloaded setup files failed their integrity check. Try again; contact Zerops support if it continues.",
    ],
    [
      "download",
      /curl: \((?:18|22|23|35|56)\)|download.*(?:failed|error)|(?:failed|unable) to download/iu,
      "the setup files couldn't be downloaded. Try again later or contact Zerops support if it continues.",
    ],
    [
      "timeout",
      /timed? ?out|timeout|deadline exceeded/iu,
      "the setup command timed out. Try again later or contact Zerops support if it continues.",
    ],
    [
      "command",
      /command not found|unknown (?:command|option)|unrecognized (?:command|option)|unsupported version|version mismatch|exit (?:status |code )?127/iu,
      "a required setup command is missing or incompatible. Try again; contact Zerops support if it continues.",
    ],
  ];
  const rule = rules.find(([, pattern]) => pattern.test(evidence));
  return {
    cause: rule?.[0] ?? "unknown",
    text: `${name || "This Mate"} couldn't be set up: ${rule?.[2] ?? "the setup command failed. Open Details or the process in Zerops to see what happened."}`,
    details: lines.length === 0 ? (result ?? "") : lines.slice(-20).join("\n"),
  };
}

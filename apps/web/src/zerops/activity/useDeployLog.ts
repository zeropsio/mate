import {
  deployLogProcess,
  inspectDeployLog,
  type DeployLogTarget,
} from "@t3tools/client-runtime/zerops/hq";
import { useSecondsNowMs } from "../useNowMs";
import { useBuildLog } from "./useBuildLog";
import { useProjectActivity } from "./useProjectActivity";

/** A user-opened inspection leases the account's process history and builder log until closed. */
export function useDeployLog(projectId: string, target: DeployLogTarget, service: string) {
  const activity = useProjectActivity(projectId);
  const process = deployLogProcess(target, projectId, activity.processes ?? []);
  const nowMs = useSecondsNowMs(process?.status === "RUNNING" || process?.status === "PENDING");
  const read =
    activity.processes === undefined
      ? undefined
      : inspectDeployLog(target, projectId, activity.processes, nowMs, service);
  const buildLog = useBuildLog({
    projectId,
    query: read?.query ?? null,
    live: read?.live ?? false,
  });
  const words =
    read !== undefined
      ? undefined
      : activity.unavailableReason !== undefined || activity.processHistory === "failed"
        ? "Couldn't read this deploy's process from Zerops. Close and open it to try again."
        : activity.processHistory === "read"
          ? "This deploy's pipeline isn't in Zerops' recent process history."
          : "Reading this deploy's process…";
  return { read, buildLog, words };
}

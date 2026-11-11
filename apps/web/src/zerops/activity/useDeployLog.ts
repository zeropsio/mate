import {
  deployLogProcess,
  inspectDeployLog,
  type DeployLogTarget,
} from "@t3tools/client-runtime/zerops/hq";
import { useCallback } from "react";
import { useAccountDataOptional } from "../accountData";
import { useSecondsNowMs } from "../useNowMs";
import { useBuildLog } from "./useBuildLog";
import { useProjectActivity } from "./useProjectActivity";

/** A user-opened inspection leases the account's process history and builder log until closed. */
export function useDeployLog(projectId: string, target: DeployLogTarget, service: string) {
  const activity = useProjectActivity(projectId);
  const retryDetail = useAccountDataOptional()?.retryDetail;
  // The person's Try again on the project's process history, once its read failed.
  const again = useCallback(
    () => retryDetail?.({ family: "process", listing: "history", ownerId: projectId }),
    [projectId, retryDetail],
  );
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
  const failed =
    read === undefined &&
    (activity.unavailableReason !== undefined || activity.processHistory === "failed");
  const words =
    read !== undefined
      ? undefined
      : failed
        ? "Couldn't read this deploy's process from Zerops."
        : activity.processHistory === "read"
          ? "This deploy's pipeline isn't in Zerops' recent process history."
          : "Reading this deploy's process…";
  return { read, buildLog, words, again: failed ? again : undefined };
}

/**
 * Restarting a Mate's container, whatever state it is in: the account's `mate-restart` operation,
 * which Zerops executes and whose process says how it ended, or — failed — one HQ start
 * (`start-mate-restart`), whose operation every device reads from navigation. Its container is
 * then intended to come up as a restart's is (`intendContainer`).
 */
import { restartWay } from "@t3tools/client-runtime/data";
import type { TargetKey } from "@t3tools/client-runtime/zerops/environments";
import { useRecoveryCommand } from "./recoveryOutcomes";
import { useCallback } from "react";

import { toastManager } from "~/lib/toasts";
import { randomUUID } from "~/lib/utils";

import { useAccountOperations } from "./accountOperations";
import { MateRestartError } from "./mateRestartRefusal";
import { restartRefusal } from "./mateNoticeVoice";
import { useAccountData } from "./accountData";
import { useHeldZeropsDetailCandidates } from "./useZeropsCandidates";
import { intendContainer } from "./zeropsContainers";

interface RestartTarget {
  /** The Mate's container. */
  readonly key: TargetKey;
  readonly projectId: string;
  readonly serviceId: string;
  /** The container's status as the listing reads it: a failed one is HQ's to restart. */
  readonly status: string | undefined;
}

/**
 * Restarts a Mate's container; resolves once Zerops took the restart and its container was
 * intended to come back, or rejects with what to tell the person.
 */
export function useRestartMate(): (target: RestartTarget) => Promise<void> {
  const command = useRecoveryCommand("restart-confirmation");
  const rows = useHeldZeropsDetailCandidates();
  return async (target) => {
    const { progress } = await command(
      {
        ...target,
        name: rows.find((row) => row.project.id === target.projectId)?.project.name ?? "The Mate",
      },
      "restart",
    );
    if (restartRefusal(progress) !== null) throw new MateRestartError(progress);
  };
}

/**
 * Brings back a Mate whose container failed, by its service. Answers false for a container that
 * has not failed — its *Try now* is the link's own retry — and for one the listing does not hold.
 */
export function useReviveFailedMate(): (serviceId: string | undefined) => boolean {
  const rows = useHeldZeropsDetailCandidates();
  const operations = useAccountOperations();
  const { orgId } = useAccountData();
  return useCallback(
    (serviceId) => {
      if (serviceId === undefined || orgId === null) return false;
      const candidate = rows.find((row) => row.service?.id === serviceId);
      if (candidate?.service === undefined) return false;
      if (restartWay(candidate.service.status) !== "hq") return false;
      intendContainer(candidate.key, { kind: "restart" });
      // A restart HQ took is said by its row from navigation, on every device; one it did not is
      // said here, as the menu says it.
      void operations
        .submit({
          kind: "start-mate-restart",
          orgId,
          projectId: candidate.project.id,
          id: randomUUID(),
        })
        .then(({ progress }) => {
          const refusal = restartRefusal(progress);
          if (refusal !== null) toastManager.add({ type: "error", title: refusal });
        });
      return true;
    },
    [rows, operations, orgId],
  );
}

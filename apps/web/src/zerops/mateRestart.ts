/**
 * Restarting a Mate's container, whatever state it is in, as the account's `mate-restart`
 * operation: Zerops executes it, a failed container is stopped and started once its stop's process
 * has ended, and the restart's process says how it ended. Its container is then intended to come
 * up as a restart's is (`intendContainer`), and shows restarting until it is back.
 */
import { restartWay, type OperationProgress } from "@t3tools/client-runtime/data";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { TargetKey } from "@t3tools/client-runtime/zerops/environments";
import { useCallback } from "react";

import { toastManager } from "~/components/ui/toast";

import { useAccountOperations } from "./accountOperations";
import { useAccountData } from "./ZeropsAccountData";
import { useZeropsCandidates } from "./useZeropsCandidates";
import { intendContainer, readContainerInitAt } from "./zeropsContainers";

/** What the person is told of a restart its owner did not take; `null` once Zerops took it. */
function restartRefusal(progress: OperationProgress): string | null {
  switch (progress.stage) {
    case "refused":
      return progress.reason;
    case "unsent":
      return "Zerops did not take the restart. Try again.";
    case "uncertain":
      return "Zerops did not answer whether it took the restart. Check the Mate before trying again.";
    case "unresolved":
      return `The Mate was stopped, but its stop could not be followed here. ${progress.nextAction ?? "Start the Mate"}.`;
    default:
      return null;
  }
}

export interface RestartTarget {
  /** The Mate's container. */
  readonly key: TargetKey;
  readonly projectId: string;
  readonly serviceId: string;
  /** The container's status as the listing reads it: a failed one is stopped, then started. */
  readonly status: string | undefined;
}

/**
 * Restarts a Mate's container; resolves once Zerops took the restart and its container was
 * intended to come back, or rejects with what to tell the person.
 */
export function useRestartMate(): (target: RestartTarget) => Promise<void> {
  const operations = useAccountOperations();
  const { orgId } = useAccountData();
  return useCallback(
    async (target) => {
      if (orgId === null) throw new Error("No organization is open.");
      // The container's initAt is read before the verb: the restart is over once it moves.
      const initAt = await readContainerInitAt(target.key);
      const { progress } = await operations.submit({
        kind: "mate-restart",
        orgId,
        projectId: target.projectId,
        serviceId: target.serviceId,
        way: restartWay(target.status),
      });
      const refusal = restartRefusal(progress);
      if (refusal !== null) throw new Error(refusal);
      intendContainer(target.key, { kind: "restart", initAt });
    },
    [operations, orgId],
  );
}

/**
 * Brings back a Mate whose container failed, by its service. Answers false for a container that
 * has not failed — its *Try now* is the link's own retry — and for one the listing does not hold.
 */
export function useReviveFailedMate(): (serviceId: string | undefined) => boolean {
  const { listing } = useZeropsCandidates();
  const operations = useAccountOperations();
  const { orgId } = useAccountData();
  return useCallback(
    (serviceId) => {
      if (serviceId === undefined || orgId === null) return false;
      const candidate = heldCandidates(listing).rows.find((row) => row.service?.id === serviceId);
      if (candidate?.service === undefined) return false;
      if (restartWay(candidate.service.status) !== "stop-then-start") return false;
      intendContainer(candidate.key, { kind: "restart" });
      // A restart Zerops took is said by its row and its link once the listing reads it again;
      // one it did not, or a stop it could not follow, is said here, as the menu says it.
      void operations
        .submit({
          kind: "mate-restart",
          orgId,
          projectId: candidate.project.id,
          serviceId,
          way: "stop-then-start",
        })
        .then(({ progress }) => {
          const refusal = restartRefusal(progress);
          if (refusal !== null) toastManager.add({ type: "error", title: refusal });
        });
      return true;
    },
    [listing, operations, orgId],
  );
}

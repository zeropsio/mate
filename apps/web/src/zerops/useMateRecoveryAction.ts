import { createElement } from "react";
import { useHeldZeropsCandidates } from "./useZeropsCandidates";
import { resolveMateProjectRole } from "@t3tools/client-runtime/zerops/mateAccess";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";
import { useRecoveryCommand, useRecoveryFeedback, RecoveryItems } from "./recoveryOutcomes";

/** The same admitted platform operations used by the menu, from the disconnected Mate's notice. */
export function useMateRecoveryAction(projectId: string | null) {
  const rows = useHeldZeropsCandidates();
  const viewer = useZeropsSessionOptional()?.activeOrganization;
  const candidate = rows.find((row) => row.project.id === projectId);
  const role =
    candidate === undefined || viewer == null
      ? null
      : resolveMateProjectRole({ project: candidate.project, viewer });
  const command = useRecoveryCommand("recovery");
  const { items } = useRecoveryFeedback(projectId);
  const busy = items.some(({ outcome }) => outcome.busy);
  const act =
    candidate?.service === undefined ||
    role === null ||
    role === "READ_ONLY" ||
    role === "NO_ACCESS"
      ? undefined
      : async (action: "start" | "restart") => {
          if (candidate.service === undefined) return;
          await command(
            {
              key: candidate.key,
              projectId: candidate.project.id,
              serviceId: candidate.service.id,
              status: candidate.service.status,
              projectStatus: candidate.project.status,
              name: candidate.project.name,
            },
            action,
          );
        };
  return {
    act,
    busy,
    feedback: items.length === 0 ? null : createElement(RecoveryItems, { items, onRetry: act }),
  };
}

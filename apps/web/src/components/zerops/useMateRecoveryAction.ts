import { buildCanonicalGroupTree } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { createElement, useMemo, useState } from "react";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useHeldZeropsDetailCandidates } from "~/zerops/useZeropsCandidates";
import { resolveMateProjectRole } from "@t3tools/client-runtime/zerops/mateAccess";
import { useCreateMateBirth } from "~/zerops/useCreateMateBirth";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { useRecoveryCommand, useRecoveryFeedback } from "~/zerops/recoveryOutcomes";
import { RecoveryItems } from "./RecoveryOutcomes";

/**
 * The same admitted platform operations used by the menu, from the disconnected Mate's notice; and
 * *Enable Zerops Mate*, the projects screen's own Create (`useCreateMateBirth`), where its
 * container's flag reads off. Neither is offered to a viewer whose role cannot write its project.
 */
export function useMateRecoveryAction(projectId: string | null) {
  const rows = useHeldZeropsDetailCandidates();
  const viewer = useZeropsSessionOptional()?.activeOrganization;
  const candidate = rows.find((row) => row.project.id === projectId);
  const role =
    candidate === undefined || viewer == null
      ? null
      : resolveMateProjectRole({ project: candidate.project, viewer });
  const command = useRecoveryCommand("recovery");
  const { items } = useRecoveryFeedback(projectId);
  const busy = items.some(({ outcome }) => outcome.busy);
  // The group it sits in, as the projects screen finds it: its Create is made in that application.
  const groups = useMemo(() => buildCanonicalGroupTree(rows, { order: "name" }).groups, [rows]);
  const createBirth = useCreateMateBirth({ candidates: rows, groups });
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const writes =
    candidate?.service !== undefined &&
    role !== null &&
    role !== "READ_ONLY" &&
    role !== "NO_ACCESS";
  const act = !writes
    ? undefined
    : async (action: "start" | "restart" | "redeploy") => {
        if (candidate?.service === undefined) return;
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
  // HQ runs the birth from here on: the page follows it as it follows any Mate coming.
  const enable =
    !writes || candidate === undefined
      ? undefined
      : () => {
          const isCurrent = captureAccountLifetime();
          setEnableError(null);
          setEnabling(true);
          void createBirth(candidate, isCurrent)
            .catch((cause: unknown) => {
              if (isCurrent()) setEnableError(zeropsErrorMessage(cause));
            })
            .finally(() => {
              setEnabling(false);
            });
        };
  return {
    act,
    busy,
    enable,
    enabling,
    feedback:
      items.length === 0
        ? enableError === null
          ? null
          : createElement("p", { role: "alert" }, enableError)
        : createElement(RecoveryItems, { items, onRetry: act }),
  };
}

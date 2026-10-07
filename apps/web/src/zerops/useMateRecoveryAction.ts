import { useState } from "react";
import { useAccountDataOptional } from "./ZeropsAccountData";
import { useAccountOperations } from "./accountOperations";
import { useHeldZeropsCandidates } from "./useZeropsCandidates";
import { useRestartMate } from "./mateRestart";
import { submitZeropsWrite } from "./zeropsWrite";
import { resolveMateProjectRole } from "@t3tools/client-runtime/zerops/mateAccess";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";
import { toastManager } from "~/components/ui/toast";

/** The same admitted platform operations used by the menu, from the disconnected Mate's notice. */
export function useMateRecoveryAction(projectId: string | null) {
  const account = useAccountDataOptional();
  const operations = useAccountOperations();
  const restart = useRestartMate();
  const rows = useHeldZeropsCandidates();
  const viewer = useZeropsSessionOptional()?.activeOrganization;
  const candidate = rows.find((row) => row.project.id === projectId);
  const role =
    candidate === undefined || viewer == null
      ? null
      : resolveMateProjectRole({ project: candidate.project, viewer });
  const [busy, setBusy] = useState(false);
  const act =
    candidate?.service === undefined ||
    role === null ||
    role === "READ_ONLY" ||
    role === "NO_ACCESS"
      ? undefined
      : async (action: "start" | "restart") => {
          if (busy || candidate.service === undefined) return;
          setBusy(true);
          try {
            if (action === "restart")
              await restart({
                key: candidate.key,
                projectId: candidate.project.id,
                serviceId: candidate.service.id,
                status: candidate.service.status,
              });
            else
              await submitZeropsWrite(
                operations,
                account?.orgId ?? null,
                candidate.project.status === "STOPPED"
                  ? { kind: "start-project", projectId: candidate.project.id }
                  : {
                      kind: "start-service",
                      projectId: candidate.project.id,
                      serviceId: candidate.service.id,
                    },
              );
          } catch (error) {
            toastManager.add({
              type: "error",
              title: `Could not confirm ${candidate.project.name}'s ${action} request.`,
              description:
                error instanceof Error ? error.message : "Zerops did not accept the operation.",
            });
          } finally {
            setBusy(false);
          }
        };
  return { act, busy };
}

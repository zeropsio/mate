import { createElement } from "react";
import { useHeldZeropsDetailCandidates } from "~/zerops/useZeropsCandidates";
import { resolveMateProjectRole } from "@t3tools/client-runtime/zerops/mateAccess";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { useRecoveryCommand, useRecoveryFeedback } from "~/zerops/recoveryOutcomes";
import { RecoveryItems } from "./RecoveryOutcomes";
import { mateProjectChangeOf } from "@t3tools/client-runtime/data";
import { mateProjectChangeLine } from "./SidebarMateRow.logic";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";

/**
 * A Mate's held row and whether the viewer's role writes its project: its recovery verbs and its
 * Enable are offered only where it does.
 */
export function useMateWriteAccess(projectId: string | null) {
  const rows = useHeldZeropsDetailCandidates();
  const viewer = useZeropsSessionOptional()?.activeOrganization;
  const candidate = rows.find((row) => row.project.id === projectId);
  const role =
    candidate === undefined || viewer == null
      ? null
      : resolveMateProjectRole({ project: candidate.project, viewer });
  const writes = role !== null && role !== "READ_ONLY" && role !== "NO_ACCESS";
  return { rows, candidate, writes };
}

/** The same admitted platform operations used by the menu, from the disconnected Mate's notice. */
export function useMateRecoveryAction(projectId: string | null) {
  const { candidate, writes } = useMateWriteAccess(projectId);
  const command = useRecoveryCommand("recovery");
  const { items } = useRecoveryFeedback(projectId);
  const change = mateProjectChangeOf(candidate?.project.hq?.operation);
  const pressing = items.some(({ outcome }) => outcome.busy);
  const standing = change?.standing;
  const line =
    pressing || change?.kind === "mate_rename" ? undefined : mateProjectChangeLine(change);
  const busy = change?.open === true || pressing;
  const act =
    candidate?.service === undefined || !writes || change?.open === true
      ? undefined
      : async (action: "start" | "restart") => {
          if (candidate.service === undefined) return;
          await command(
            {
              key: candidate.key,
              projectId: candidate.project.id,
              serviceId: candidate.service.id,
              status: candidate.service.status,
              name: candidate.project.name,
            },
            action,
          );
        };
  return {
    act,
    busy,
    feedback:
      line !== undefined
        ? createElement(
            "div",
            { className: "flex flex-wrap items-center gap-2" },
            createElement(Text, {
              variant: line.kind === "mate-change-failed" ? "error" : "remark",
              children: line.text,
            }),
            act !== undefined && change?.kind === "mate_start" && standing?.kind === "failed"
              ? createElement(
                  Button,
                  { size: "sm", variant: "ghost", onClick: () => void act("start") },
                  "Try again",
                )
              : null,
          )
        : items.length === 0
          ? null
          : createElement(RecoveryItems, { items, onRetry: act }),
  };
}

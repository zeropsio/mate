/**
 * The lead's plan in its chat (PRD §4.6, §5.4): the lead's `crew_propose`
 * leaves `proposed` tasks on the board, and the chat draws them as the board's
 * plan card — read off the snapshot, never parsed out of what the lead wrote.
 * *Start* accepts the rows (`planAccept`), starting a run first when none is
 * on; *Edit* opens a row's task to edit (`taskEdit`) or takes it out of the
 * plan; *Discard* discards them all (`planDiscard`). Nothing while the lead
 * proposes nothing.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { CrewCommand, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Sheet, SheetPopup } from "~/components/ui/sheet";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useCrew } from "~/zerops/crew/useCrew";
import { useCrewCommand } from "~/zerops/crew/useCrewCommand";

import { CrewPlanCardView, CrewTaskSheetBody } from "./CrewBoardPanel";
import { crewPlanCard, crewRunOn, crewTaskSheet } from "./CrewBoardPanel.logic";
import { CrewRunDialog } from "./CrewRunDialog";

export function CrewLeadPlan({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { snapshot, view, current } = useCrew(environmentId);
  const crewCommand = useCrewCommand(environmentId);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  /** The plan's `planAccept`, waiting for the run dialog to start a run first. */
  const [planToStart, setPlanToStart] = useState<CrewCommand | null>(null);
  if (snapshot === null || view === null) return null;
  const plan = crewPlanCard(snapshot, view);
  if (plan === null) return null;

  const canAct = current && !crewCommand.pending;
  const send = (command: CrewCommand) => void crewCommand.send(command);
  const sheet = openTaskId === null ? null : crewTaskSheet(snapshot, view, openTaskId);
  const sheetTask =
    sheet === null ? null : (view.tasks.find((row) => row.task.id === sheet.taskId)?.task ?? null);
  const openChat = (threadId: ThreadId) => {
    setOpenTaskId(null);
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };

  return (
    <div className="flex flex-col gap-1" data-crew-lead-plan>
      <CrewPlanCardView
        canAct={canAct}
        editing={editing}
        onOpenTask={(taskId) => {
          crewCommand.clearError();
          setOpenTaskId(taskId);
        }}
        onSend={send}
        onStart={(accept) => (crewRunOn(snapshot.run) ? send(accept) : setPlanToStart(accept))}
        onToggleEditing={() => setEditing((on) => !on)}
        plan={plan}
      />
      {crewCommand.error === null || sheet !== null ? null : (
        <p className="text-xs text-destructive-foreground" role="alert">
          {crewCommand.error}
        </p>
      )}
      <CrewRunDialog
        environmentId={environmentId}
        onOpenChange={(open) => (open ? undefined : setPlanToStart(null))}
        onStarted={() => {
          if (planToStart !== null) send(planToStart);
        }}
        open={planToStart !== null}
      />
      <Sheet
        onOpenChange={(open) => (open ? undefined : setOpenTaskId(null))}
        open={sheet !== null}
      >
        <SheetPopup side="right">
          {sheet !== null && sheetTask !== null ? (
            <CrewTaskSheetBody
              canAct={canAct}
              error={crewCommand.error}
              key={sheet.taskId}
              onOpenChat={openChat}
              onSend={send}
              sheet={sheet}
              task={sheetTask}
            />
          ) : null}
        </SheetPopup>
      </Sheet>
    </div>
  );
}

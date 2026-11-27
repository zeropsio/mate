/**
 * A task this conversation handed to a crewmate (`crew_hand_off`), on the card that follows it
 * as the crew holds it: where it stands, what it needs of the person — its review, an answer, a
 * press the crew takes — and a message to its crewmate, which steers it or sends finished work
 * back. The conversation's agent hears of it again when it comes to rest; this card is the
 * person's.
 */
import { crewSeamWords } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewCommand, EnvironmentId } from "@t3tools/contracts";
import { MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { useCrewValue } from "~/zerops/crew/useCrew";
import { useCrewAccess } from "~/zerops/crew/useCrewAccess";
import { useCrewCommand } from "~/zerops/crew/useCrewCommand";
import { useOpenReview } from "~/zerops/review";
import { needsYouTellLabel } from "~/zerops/waiting.logic";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Row } from "../../ui/row";
import { Text } from "../../ui/text";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { MateFace } from "../primitives";
import { Replying } from "../SidebarWaiting";
import { crewHandOffModel } from "./CrewHandOffCard.logic";
import { crewActionOffered, type CrewRowAction } from "./CrewRows.logic";

export function CrewHandOffCard({
  environmentId,
  taskId,
  number,
  mateName,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly taskId: string;
  readonly number: number;
  readonly mateName: string;
}) {
  const { snapshot, view } = useCrewValue(environmentId);
  const access = useCrewAccess(environmentId, snapshot);
  const command = useCrewCommand(environmentId);
  const openReview = useOpenReview();
  const [open, setOpen] = useState<"answer" | "tell" | null>(null);
  const origin = `hand-off:${taskId}`;
  const task = snapshot?.board.tasks.find((candidate) => candidate.id === taskId);
  if (snapshot === null || view === null || task === undefined) {
    // The crew not read yet, or its board no longer holds the task: the line the crew marked.
    return (
      <Text render={<p />} variant="remark">
        {crewSeamWords({ seam: "handed", number })}
      </Text>
    );
  }
  const model = crewHandOffModel({
    task,
    snapshot,
    view: { lead: view.lead, personLands: view.personLands },
    mateName,
  });
  const crewmate = view.crewmates.find((candidate) => candidate.crewmate.handle === task.owner);
  const send = (next: CrewCommand, after: () => void) => {
    void command.send(next, origin).then((result) => {
      if (result !== null) after();
    });
  };
  // What needs the Crew tab (a draft for the Mate, its copy of the app) stays there.
  const [first] = model.actions.filter(
    (action) =>
      action.kind !== "ask" &&
      action.kind !== "try" &&
      crewActionOffered(action, access, null, false),
  );
  const press = (action: CrewRowAction) => {
    switch (action.kind) {
      case "answer":
        setOpen(open === "answer" ? null : "answer");
        return;
      case "review":
        if (environmentId !== null)
          openReview({ kind: "crew-task", environmentId, taskId: action.taskId });
        return;
      case "command":
        send(action.command, () => {});
        return;
      case "ask":
      case "try":
        return;
    }
  };
  const tellLabel = needsYouTellLabel(model.who);
  const tells = model.open && access.reach({ kind: "crewmates", handles: [task.owner] }) === null;
  const failure = command.errorAt(origin) ?? undefined;
  return (
    <Card data-crew-hand-off>
      <div className="px-1.5 py-1">
        <Row
          control={
            <>
              {tells ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-expanded={open === "tell"}
                        aria-label={tellLabel}
                        onClick={() => {
                          setOpen(open === "tell" ? null : "tell");
                        }}
                        size="icon-sm"
                        variant="ghost"
                      />
                    }
                  >
                    <MessageSquareIcon aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipPopup side="top">{tellLabel}</TooltipPopup>
                </Tooltip>
              ) : null}
              {first === undefined ? null : (
                <Button
                  disabled={command.pending}
                  onClick={() => {
                    press(first);
                  }}
                  size="sm"
                  title={first.line}
                >
                  {first.label}
                </Button>
              )}
            </>
          }
          controlStays
          lead={
            crewmate === undefined ? undefined : (
              <span aria-hidden="true">
                <MateFace
                  size={32}
                  state={first !== undefined ? "needs" : crewmate.working ? "working" : "idle"}
                  tint={crewmate.crewmate.tint}
                />
              </span>
            )
          }
          line={model.line}
          meta={model.who}
          title={model.title}
        />
        {open === "tell" ? (
          <div className="flex flex-wrap gap-2 ps-13.5 pe-2.5 pb-2">
            <Replying
              error={failure}
              label={tellLabel}
              onCancel={() => {
                setOpen(null);
              }}
              onSend={(text) => {
                send({ _tag: "message", handle: task.owner, text, attachments: [] }, () => {
                  setOpen(null);
                });
              }}
              placeholder={tellLabel}
              replying
              sending={command.pending}
            >
              {null}
            </Replying>
          </div>
        ) : open === "answer" && first?.kind === "answer" ? (
          <div className="flex flex-wrap gap-2 ps-13.5 pe-2.5 pb-2">
            <Replying
              error={failure}
              label="Your answer"
              onCancel={() => {
                setOpen(null);
              }}
              onSend={(text) => {
                send({ _tag: "answer", handle: first.handle, taskId: first.taskId, text }, () => {
                  setOpen(null);
                });
              }}
              placeholder={`Your answer to ${model.who}`}
              replying
              sending={command.pending}
            >
              {null}
            </Replying>
          </div>
        ) : failure === undefined ? null : (
          <div className="flex flex-wrap gap-2 ps-13.5 pe-2.5 pb-2">
            <Replying error={failure} replying={false} sending={false}>
              {null}
            </Replying>
          </div>
        )}
      </div>
    </Card>
  );
}

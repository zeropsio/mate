/**
 * A crew as one line under its Mate in the left menu (PRD §4.2, seam S8;
 * pass 16, M14): the crew's mark in the faces' column, every crewmate's face
 * whole at 20 px — the lead first, each opening that crewmate's chat and
 * moving with its state — then the crew's one most urgent fact (`crewLine`),
 * and *Review* in blue where a task waits for the person's *Land*. The Mate's
 * own row keeps its full width above it: the crew used to hang outside the
 * row as overlapping slivers of faces with a "+1", narrowing both lines.
 * Nothing at all while there is no crew.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { crewFaceWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { CrewAttention, CrewStatus, EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";

import { buildThreadRouteParams } from "../../../threadRoutes";
import { useCrew } from "../../../zerops/crew/useCrew";
import { useOpenReview } from "../../../zerops/review";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { MateFace } from "../primitives";
import { crewLine } from "./SidebarCrewLine.logic";

/** What the line reads of a crew: `useCrew`'s answer, or a fixture's (a harness). */
export interface SidebarCrewRead {
  readonly status: CrewStatus | null;
  readonly view: Pick<CrewView, "crewmates" | "tasks"> | null;
  readonly attention: ReadonlyArray<CrewAttention>;
}

export function SidebarCrewLine({
  environmentId,
  read,
}: {
  readonly environmentId: EnvironmentId;
  /** A crew handed in instead of the feed's; absent, the line reads its own. */
  readonly read?: SidebarCrewRead | undefined;
}) {
  const live = useCrew(environmentId);
  const navigate = useNavigate();
  const openReview = useOpenReview();
  // A crew surface exists only for a crew read and applied (seam 21): not
  // read yet, or a read that failed, draws nothing here.
  const crew =
    read ??
    (live.snapshot === null
      ? undefined
      : { status: live.status, view: live.view, attention: live.snapshot.attention });
  if (crew === undefined || crew.status !== "applied" || crew.view === null) return null;
  if (crew.view.crewmates.length === 0) return null;
  const { faces, fact } = crewLine(crew.view, crew.attention);
  return (
    // 2 px under its Mate's row, one line of 30 px, its words on the menu's
    // text column and its verb on the right edge the changes' Review stands on.
    <div
      className="menu-line mt-0.5 grid h-7.5 min-w-0 grid-cols-[28px_auto_minmax(0,1fr)_auto] items-center gap-x-3 ps-1.75 pe-1 text-line leading-4.5"
      data-zerops-surface="sidebar-crew"
    >
      <span className="flex justify-center text-muted-foreground">
        <UsersIcon aria-hidden="true" className="size-3.5" />
      </span>
      <span className="-ms-0.75 flex gap-0.5">
        {faces.map((face) => {
          const who = crewFaceWord(face.displayName, face.lead);
          const drawn = <MateFace greets size="sm" state={face.state} tint={face.tint} />;
          if (face.threadId === null) {
            return (
              <span className="flex size-6 items-center justify-center" key={face.handle}>
                {drawn}
              </span>
            );
          }
          const threadId = face.threadId;
          return (
            <Tooltip key={face.handle}>
              <TooltipTrigger
                render={
                  <button
                    aria-label={`Open ${who}`}
                    className="menu-crewface flex size-6 cursor-pointer items-center justify-center outline-none transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      void navigate({
                        to: "/$environmentId/$threadId",
                        params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
                      });
                    }}
                    type="button"
                  />
                }
              >
                {drawn}
              </TooltipTrigger>
              <TooltipPopup side="right">{who}</TooltipPopup>
            </Tooltip>
          );
        })}
      </span>
      <span className="menu-ink-2 min-w-0 truncate" data-zerops-surface="sidebar-crew-fact">
        {fact?.words}
      </span>
      {fact?.kind === "land" ? (
        <button
          className="menu-textbtn outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-zerops-surface="sidebar-crew-review"
          onClick={(event) => {
            openReview(
              { kind: "crew-task", environmentId, taskId: fact.taskId },
              { from: event.currentTarget },
            );
          }}
          type="button"
        >
          Review
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

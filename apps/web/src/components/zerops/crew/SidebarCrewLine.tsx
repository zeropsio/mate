/**
 * A crew as one line under its Mate in the left menu (PRD §4.2, seam S8;
 * pass 16, M14): the crew's mark in the faces' column, every crewmate's face
 * whole at 20 px — the lead first, each opening that crewmate's chat and
 * moving with its state — then the crew's one most urgent fact (`crewLine`),
 * and *Review* in blue where a task waits for the person's *Land*. The Mate's
 * own row keeps its full width above it: the crew used to hang outside the
 * row as overlapping slivers of faces with a "+1", narrowing both lines.
 * Nothing at all while there is no crew.
 *
 * Read from HQ (`useMateCrew`): the crew in its Mate's overview, for a Mate nobody opened as for
 * the open one. While HQ's answer is not current, or the Mate sleeps, the faces stand at rest —
 * which of them works or waits, and the crew's fact, are only true now. *Review* stands only
 * where the task's crewmate is the viewer's to run (D6, `crewTaskReviewable`); its place stays
 * either way.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { crewFaceWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewStatus, EnvironmentId } from "@t3tools/contracts";
import type { CrewDigest, OverviewLogins } from "@t3tools/shared/mateLink";
import { useNavigate } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";

import { buildThreadRouteParams } from "../../../threadRoutes";
import { useMateCrew } from "../../../zerops/crew/useCrew";
import { useOpenReview } from "../../../zerops/review";
import { useZeropsSessionOptional } from "../../../zerops/ZeropsSessionProvider";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { MateFace } from "../primitives";
import {
  crewLine,
  crewTaskReviewable,
  type CrewLineFace,
  type CrewLineFact,
} from "./SidebarCrewLine.logic";

/**
 * A crew handed to the menu instead of HQ's (a harness): its status for the Mate's menu, its
 * digest for the line, and whose its logins are.
 */
export interface SidebarCrewRead {
  readonly status: CrewStatus | null;
  readonly crew: CrewDigest | null;
  readonly logins: OverviewLogins;
}

export function SidebarCrewLine({
  projectId,
  read,
  mine,
}: {
  /** Its Mate's project: what HQ holds its overview under. */
  readonly projectId: string;
  /** A crew handed in instead of HQ's; absent, the line reads HQ's. */
  readonly read?: SidebarCrewRead | undefined;
  /** Its Mate is the viewer's own (HQ's `waitsOnViewer`): only then does the crew need them. */
  readonly mine: boolean;
}) {
  const held = useMateCrew(projectId);
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  const crew =
    read === undefined
      ? held
      : { crew: read.crew, logins: read.logins, current: true, environmentId: undefined };
  if (crew.crew === null || crew.crew.crewmates.length === 0) return null;
  const line = crewLine(crew.crew, mine);
  if (!crew.current) {
    return (
      <CrewLineView
        environmentId={undefined}
        fact={null}
        faces={line.faces.map((face) => ({ ...face, state: "idle", threadId: null }))}
        known={false}
      />
    );
  }
  return (
    <CrewLineView
      environmentId={crew.environmentId}
      fact={line.fact}
      faces={line.faces}
      known
      reviews={crewTaskReviewable(crew.crew, crew.logins, viewerSubject)}
    />
  );
}

/**
 * The line itself: the crew's faces, its fact and its Review. `known` is
 * whether the faces' states are read or stand in from memory, where a change
 * is no arrival to greet.
 */
function CrewLineView({
  environmentId,
  faces,
  fact,
  known,
  reviews,
}: {
  readonly environmentId: EnvironmentId | undefined;
  readonly faces: ReadonlyArray<CrewLineFace>;
  readonly fact: CrewLineFact | null;
  readonly known: boolean;
  /** Whether a task's review is the viewer's to open from here; absent, none is. */
  readonly reviews?: ((taskId: string) => boolean) | undefined;
}) {
  const navigate = useNavigate();
  const openReview = useOpenReview();
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
          const drawn = (
            <MateFace greets known={known} size="sm" state={face.state} tint={face.tint} />
          );
          if (face.threadId === null || environmentId === undefined) {
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
                    className="menu-crewface flex size-6 cursor-pointer items-center justify-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
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
      {/* The faces come first: in a narrow menu the fact gives way, and is
          still there on hover and in its Review's name. */}
      {fact === null ? (
        <span data-zerops-surface="sidebar-crew-fact" />
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="menu-ink-2 min-w-0 truncate"
                data-zerops-surface="sidebar-crew-fact"
              />
            }
          >
            {fact.words}
          </TooltipTrigger>
          <TooltipPopup side="right">{fact.words}</TooltipPopup>
        </Tooltip>
      )}
      {fact?.kind === "land" && environmentId !== undefined && reviews?.(fact.taskId) === true ? (
        <button
          aria-label={`Review: ${fact.words}`}
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

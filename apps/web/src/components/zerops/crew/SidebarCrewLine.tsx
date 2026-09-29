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
 * A reload draws the line where it stood (`menuMemory.ts`), so no row moves
 * when the crew's feed answers: the faces this browser last read, at rest —
 * which of them works or waits, and the crew's fact, are only true now and
 * wait for the feed.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { crewFaceWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { CrewAttention, CrewStatus, EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { buildThreadRouteParams } from "../../../threadRoutes";
import { useCrew } from "../../../zerops/crew/useCrew";
import { menuMemory, rememberedCrewOf, rememberMenu, withCrews } from "../../../zerops/menuMemory";
import { useOpenReview } from "../../../zerops/review";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { MateFace } from "../primitives";
import { crewLine, type CrewLineFace, type CrewLineFact } from "./SidebarCrewLine.logic";

/** What the line reads of a crew: `useCrew`'s answer, or a fixture's (a harness). */
export interface SidebarCrewRead {
  readonly status: CrewStatus | null;
  readonly view: Pick<CrewView, "crewmates" | "tasks"> | null;
  readonly attention: ReadonlyArray<CrewAttention>;
}

export function SidebarCrewLine({
  environmentId,
  projectId,
  read,
}: {
  /** Its Mate's environment once connected; until then only what this browser remembers is drawn. */
  readonly environmentId: EnvironmentId | undefined;
  /** Its Mate's project: what the menu's memory keeps its crew under. */
  readonly projectId: string;
  /** A crew handed in instead of the feed's; absent, the line reads its own. */
  readonly read?: SidebarCrewRead | undefined;
}) {
  const live = useCrew(environmentId ?? null);
  // What this browser last read of the crew, for the line's place on a reload.
  const [remembered] = useState(() => menuMemory().crews[projectId]);
  // A crew surface exists only for a crew read and applied (seam 21): not
  // read yet, or a read that failed, draws only what was remembered.
  const crew =
    read ??
    (live.snapshot === null
      ? undefined
      : { status: live.status, view: live.view, attention: live.snapshot.attention });
  const line =
    crew === undefined || crew.status !== "applied" || crew.view === null
      ? undefined
      : crew.view.crewmates.length === 0
        ? undefined
        : crewLine(crew.view, crew.attention);
  // The crew as read, for the next reload to keep its place; a crew that is
  // gone is forgotten. Not a fixture's, and not while unread.
  const faces = line?.faces;
  const gone = read === undefined && (live.status === "none" || live.status === "off");
  useEffect(() => {
    if (read !== undefined) return;
    if (faces !== undefined) {
      rememberMenu((memory) => withCrews(memory, { [projectId]: rememberedCrewOf(faces) }));
    } else if (gone) {
      rememberMenu((memory) => withCrews(memory, { [projectId]: null }));
    }
  }, [faces, gone, projectId, read]);
  if (line !== undefined) {
    return <CrewLineView environmentId={environmentId} fact={line.fact} faces={line.faces} known />;
  }
  if (crew !== undefined || remembered === undefined) return null;
  return (
    <CrewLineView
      environmentId={undefined}
      fact={null}
      faces={remembered.faces.map((face) => ({ ...face, state: "idle", threadId: null }))}
      known={false}
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
}: {
  readonly environmentId: EnvironmentId | undefined;
  readonly faces: ReadonlyArray<CrewLineFace>;
  readonly fact: CrewLineFact | null;
  readonly known: boolean;
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
      {fact?.kind === "land" && environmentId !== undefined ? (
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

/**
 * The line (`projectLine`), drawn: a picture of where a project's changes are. Its stations stand
 * on one horizontal track, by name; the changes between them are beads; a count stands under each
 * segment.
 *
 * The picture shows and never acts for a place: no address, no verb — those are the project's
 * Places and the place's page. A bead names its change on hover and focus and opens it when
 * pressed.
 *
 * A count stands under each segment and leads to the group of the Changes list it counts. On a
 * project's page (`surface="page"`) the line is the masthead of the Changes card, with no box of
 * its own, a place's dot in its state's tone: the rows right under it wear the same beads. In a
 * Mate's panel (`surface="panel"`) it is a card of its own. Its height is the same in every
 * state, and `held` keeps its shape (names, track, dots, no bead) while the project's reads have
 * not answered. Under 700 px of its own width it is compact: short captions, the same beads (a
 * container query; a Mate's Code page).
 *
 * Behind it stands the line in full (`ProjectLineFull`: each station's state and page, each
 * segment's verb, the rows under `main`), by one control in its corner. `full.kind` says
 * where: `here`, it grows in place into it and back (the project's page), the control in the
 * top corner in both states, and the door carries what the full line acts on
 * (`ProjectLineFullActs`); `page`, the control is the way to the project's page, which arrives
 * with it open (a Mate's panel has no room for it), in the corner under production.
 *
 * Props: `view` (`projectLine(…)`; `undefined` while the project is unread: it holds the
 * line's height, nothing drawn); `held`; `onOpenChange(pull, from)` (a bead: the change's review,
 * as its row in the Changes list opens it); `onShowGroup(group)` (a count: the group it counts —
 * without it a count is plain words); `surface`; `full`.
 */
import { Link } from "@tanstack/react-router";
import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ProjectLineFull, type ProjectLineFullActs } from "./ProjectLineFull";
import {
  Caption,
  LineNode,
  LineRail,
  lineColumns,
  SegmentBeads,
  STATION_NAME,
  useTrackWidths,
  type OpenLineChange,
  type ShowLineGroup,
} from "./ProjectLineParts";
import type { LineStationFull, ProjectLineFullView, ProjectLineView } from "./projectLine.logic";

/** The control's words, closed and open. */
const SHOW_FULL_PICTURE = "Show the full picture";
const SHOW_LESS = "Show less";

type ProjectLineFullDoor =
  | ({
      readonly kind: "here";
      /** The line in full (`projectLineFull(…)`), read whether or not it is open. */
      readonly view: ProjectLineFullView | undefined;
      readonly groupId: string;
      readonly open: boolean;
      readonly onOpen: (open: boolean) => void;
    } & ProjectLineFullActs)
  | {
      readonly kind: "page";
      readonly groupId: string;
      /** Pressed, before the project's page opens: the page is to arrive with it open. */
      readonly onOpen: () => void;
    };

interface ProjectLineProps {
  readonly view: ProjectLineView | undefined;
  /** The project's reads have not answered: the line's shape alone. */
  readonly held?: boolean | undefined;
  readonly onOpenChange: OpenLineChange;
  readonly onShowGroup?: ShowLineGroup;
  readonly surface?: "page" | "panel" | undefined;
  readonly full?: ProjectLineFullDoor | undefined;
}

const UNREAD: ProjectLineView = { stations: [], segments: [] };

/**
 * The line's ground and the inks mixed from it: the track, a faint dash, a count's chip. A bead
 * is cut out of the track by a ring of the ground. Its width is a container: under 700 px it is
 * compact.
 */
const LINE =
  "@container/line relative min-w-0 [--ln-chip:color-mix(in_oklab,var(--foreground)_9%,var(--ln-ground))] [--ln-faint:color-mix(in_oklab,var(--foreground)_20%,var(--ln-ground))] [--ln-ground:var(--card)] [--ln-track:color-mix(in_oklab,var(--foreground)_30%,var(--ln-ground))]";

/**
 * 104 px in every state as a card of its own, 98 px as the masthead of a page's Changes card: its
 * sides then are the rows' under it (18 px: the card's 8 and a row's 10), so its first dot stands
 * over the column of their beads.
 */
const PICTURE = {
  card: "box-border grid h-[104px] min-w-0 pt-4 pr-6 pl-7 sm:@max-[700px]/line:px-5 max-sm:px-4",
  band: "box-border grid h-[98px] min-w-0 px-4.5 pt-3.5",
};

/** A station's name, the track, the count: 20, 16 and 16 px, 8 px between. */
const COLUMN = "relative grid min-w-0 grid-rows-[20px_16px_16px] content-start gap-y-2";

export function ProjectLine({
  view,
  held = false,
  onOpenChange,
  onShowGroup,
  surface = "page",
  full,
}: ProjectLineProps) {
  const here = full?.kind === "here" ? full : undefined;
  const open = here?.open === true;
  // Pressed since it was drawn: only then does a state travel to the next; the first frame is the
  // remembered state as it stands.
  const [moved, setMoved] = useState(false);
  const band = surface === "page";
  const picture = (
    <LinePicture
      band={band}
      held={held}
      onOpenChange={onOpenChange}
      onShowGroup={onShowGroup}
      places={here?.view?.stations}
      view={view}
    />
  );
  return (
    <div
      aria-busy={held || view === undefined ? true : undefined}
      aria-label="Where each change is"
      className={band ? LINE : `${LINE} rounded-card border border-border/70 bg-card`}
      data-zerops-line={here === undefined ? undefined : open ? "full" : "picture"}
      data-zerops-surface="project-line"
      role="group"
    >
      {here === undefined ? (
        picture
      ) : (
        // The picture and, behind it, the line in full, in one card: the picture keeps its height,
        // the full line takes it and the room it needs under it, and the card's height travels
        // between the two while one fades into the other.
        <div className={FOLD[band ? "band" : "card"][open ? "open" : "shut"]}>
          <div className={open ? `${PANE} invisible opacity-0` : PANE} inert={open}>
            {picture}
          </div>
          {open || moved ? (
            // Drawn when it is first asked for, it fades in from nothing then, and stands whole where
            // the page opens with it.
            <div
              className={
                open
                  ? moved
                    ? `${PANE} row-span-2 min-h-0 overflow-hidden starting:opacity-0`
                    : `${PANE} row-span-2 min-h-0 overflow-hidden`
                  : `${PANE} row-span-2 min-h-0 overflow-hidden invisible opacity-0`
              }
              inert={!open}
            >
              <ProjectLineFull
                band={band}
                groupId={here.groupId}
                held={held}
                onOpenChange={onOpenChange}
                onOpenMates={here.onOpenMates}
                onPutLive={here.onPutLive}
                onReviewRelease={here.onReviewRelease}
                onShowGroup={onShowGroup}
                view={here.view}
              />
            </div>
          ) : null}
        </div>
      )}
      {full === undefined ? null : (
        // The way to the line in full, in the card's corner, whichever of the two shows. Where it
        // leads to the project's page (a panel's picture, which never grows) it stands in the
        // corner under production, which holds no word: a panel is too narrow to clear its name.
        <span
          className={
            full.kind === "page"
              ? "absolute right-1.5 bottom-1.5 z-1 flex"
              : "absolute top-2 right-2 z-1 flex sm:@max-[700px]/line:top-1 sm:@max-[700px]/line:right-1 max-sm:top-auto max-sm:bottom-1"
          }
        >
          <Tooltip>
            <TooltipTrigger
              render={
                full.kind === "here" ? (
                  <Button
                    aria-expanded={open}
                    aria-label={open ? SHOW_LESS : SHOW_FULL_PICTURE}
                    onClick={() => {
                      setMoved(true);
                      full.onOpen(!open);
                    }}
                    size="icon-sm"
                    variant="ghost"
                  />
                ) : (
                  <Button
                    aria-label={SHOW_FULL_PICTURE}
                    render={
                      <Link
                        onClick={full.onOpen}
                        params={{ groupId: full.groupId }}
                        to="/group/$groupId/flow"
                      />
                    }
                    size="icon-sm"
                    variant="ghost"
                  />
                )
              }
            >
              {open ? <Minimize2Icon aria-hidden="true" /> : <Maximize2Icon aria-hidden="true" />}
            </TooltipTrigger>
            <TooltipPopup side="top">{open ? SHOW_LESS : SHOW_FULL_PICTURE}</TooltipPopup>
          </Tooltip>
        </span>
      )}
    </div>
  );
}

/**
 * The picture itself: the stations, the track, the beads, a count under each segment. `places`:
 * each station as the line in full knows it, whose dot then wears its state.
 */
const PANE =
  "col-start-1 row-start-1 min-w-0 transition-[opacity,visibility] duration-200 ease-out-strong motion-reduce:transition-none";
const FOLD = {
  card: {
    shut: "grid min-w-0 grid-rows-[104px_0fr] transition-[grid-template-rows] duration-200 ease-out-strong motion-reduce:transition-none",
    open: "grid min-w-0 grid-rows-[104px_1fr] transition-[grid-template-rows] duration-200 ease-out-strong motion-reduce:transition-none",
  },
  band: {
    shut: "grid min-w-0 grid-rows-[98px_0fr] transition-[grid-template-rows] duration-200 ease-out-strong motion-reduce:transition-none",
    open: "grid min-w-0 grid-rows-[98px_1fr] transition-[grid-template-rows] duration-200 ease-out-strong motion-reduce:transition-none",
  },
};

function LinePicture({
  view,
  held,
  places,
  band,
  onOpenChange,
  onShowGroup,
}: {
  readonly band: boolean;
  readonly view: ProjectLineView | undefined;
  readonly held: boolean;
  readonly places: ReadonlyArray<LineStationFull> | undefined;
  readonly onOpenChange: OpenLineChange;
  readonly onShowGroup: ShowLineGroup;
}) {
  const { stations, segments } = view ?? UNREAD;
  const [widths, track] = useTrackWidths(segments.length);
  return (
    <div className={`${PICTURE[band ? "band" : "card"]} ${lineColumns(stations.length)}`}>
      {stations.map((station, at) => {
        const segment = segments[at];
        const place = held ? undefined : places?.find((each) => each.kind === station.kind);
        return (
          <div className={COLUMN} data-kind={station.kind} key={station.kind}>
            <span className={station.kind === "main" ? `${STATION_NAME} font-mono` : STATION_NAME}>
              {station.name}
            </span>
            <div
              className="relative min-w-0"
              ref={(element) => {
                track(at, element);
              }}
            >
              {segment === undefined ? null : <LineRail track={held ? "solid" : segment.track} />}
              <LineNode
                node={held ? "solid" : (place?.node ?? station.node)}
                tone={band ? place?.tone : undefined}
              />
              {segment === undefined || held ? null : (
                <SegmentBeads
                  onOpenChange={onOpenChange}
                  segment={segment}
                  width={widths[at] ?? 0}
                />
              )}
            </div>
            {/* Under the track: a segment's count. */}
            <div className="grid min-w-0 content-start justify-items-start pe-4.5 @max-[700px]/line:pe-2">
              {held || segment === undefined ? null : (
                <Caption onShowGroup={onShowGroup} segment={segment} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

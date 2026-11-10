/**
 * The line (`projectLine`), drawn: a picture of where a project's changes are. Its stations stand
 * on one horizontal track, by name; the changes between them are beads; a count stands under each
 * segment.
 *
 * It shows and never acts for a place: no state line, no address, no verb — those are the
 * project's Places and the place's page. A bead names its change on hover and focus and opens it
 * when pressed; a count leads to the group of the Changes list it counts.
 *
 * Its height is the same in every state, and `held` keeps its shape (names, track, dots, no bead)
 * while the project's reads have not answered. Under 700 px of its own width it is compact: short
 * captions, the same beads (a container query; a Mate's Code page).
 *
 * Behind it stands the line in full (`ProjectLineFull`), by one control in the card's corner.
 * `full.kind` says where: `here`, the card grows in place into it and back (the project's page),
 * the control in the top corner in both states; `page`, the control is the way to the project's
 * page, which arrives with it open (a Mate's panel has no room for it), in the corner under
 * production.
 *
 * Props: `view` (`projectLine(…)`; `undefined` while the project is unread: the card holds the
 * line's height, nothing drawn); `held`; `onOpenChange(pull, from)` (a bead: the change's review,
 * as its row in the Changes list opens it); `onShowGroup(group)` (a count: the group it counts —
 * without it a count is plain words); `surface` (`panel`: a Mate's panel's own card); `full`.
 */
import { Link } from "@tanstack/react-router";
import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ProjectLineFull } from "./ProjectLineFull";
import {
  Caption,
  SegmentBeads,
  useTrackWidths,
  type OpenLineChange,
  type ShowLineGroup,
} from "./ProjectLineParts";
import type { ProjectLineFullView, ProjectLineView } from "./projectLine.logic";

/** The control's words, closed and open. */
export const SHOW_FULL_PICTURE = "Show the full picture";
const SHOW_LESS = "Show less";

export type ProjectLineFullDoor =
  | {
      readonly kind: "here";
      /** The line in full (`projectLineFull(…)`), read whether or not it is open. */
      readonly view: ProjectLineFullView | undefined;
      readonly groupId: string;
      readonly open: boolean;
      readonly onOpen: (open: boolean) => void;
    }
  | {
      readonly kind: "page";
      readonly groupId: string;
      /** Pressed, before the project's page opens: the page is to arrive with it open. */
      readonly onOpen: () => void;
    };

export interface ProjectLineProps {
  readonly view: ProjectLineView | undefined;
  /** The project's reads have not answered: the line's shape alone. */
  readonly held?: boolean | undefined;
  readonly onOpenChange: OpenLineChange;
  readonly onShowGroup?: ShowLineGroup;
  readonly surface?: "page" | "panel" | undefined;
  readonly full?: ProjectLineFullDoor | undefined;
}

const UNREAD: ProjectLineView = { stations: [], segments: [] };

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
  const picture = (
    <LinePicture held={held} onOpenChange={onOpenChange} onShowGroup={onShowGroup} view={view} />
  );
  return (
    <div
      aria-busy={held || view === undefined ? true : undefined}
      aria-label="Where each change is"
      className={
        surface === "panel" ? "ln rounded-xl border border-border/70 bg-card" : "pp-card ln"
      }
      data-stations={String((view ?? UNREAD).stations.length)}
      data-zerops-line={here === undefined ? undefined : open ? "full" : "picture"}
      data-zerops-surface="project-line"
      role="group"
    >
      {here === undefined ? (
        picture
      ) : (
        <div
          className="ln-fold"
          data-moved={moved ? "" : undefined}
          data-open={open ? "" : undefined}
        >
          <div
            className="ln-pane"
            data-hidden={open ? "" : undefined}
            data-pane="picture"
            inert={open}
          >
            {picture}
          </div>
          {open || moved ? (
            <div
              className="ln-pane"
              data-hidden={open ? undefined : ""}
              data-pane="full"
              inert={!open}
            >
              <ProjectLineFull
                groupId={here.groupId}
                held={held}
                onOpenChange={onOpenChange}
                onShowGroup={onShowGroup}
                view={here.view}
              />
            </div>
          ) : null}
        </div>
      )}
      {full === undefined ? null : (
        <span className="ln-corner" data-leads={full.kind === "page" ? "" : undefined}>
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

/** The picture itself: the stations, the track, the beads, a count under each segment. */
function LinePicture({
  view,
  held,
  onOpenChange,
  onShowGroup,
}: {
  readonly view: ProjectLineView | undefined;
  readonly held: boolean;
  readonly onOpenChange: OpenLineChange;
  readonly onShowGroup: ShowLineGroup;
}) {
  const { stations, segments } = view ?? UNREAD;
  const [widths, track] = useTrackWidths(segments.length);
  return (
    <div className="ln-grid">
      {stations.map((station, at) => {
        const segment = segments[at];
        return (
          <div
            className="ln-col"
            data-kind={station.kind}
            data-seg={segment?.key}
            key={station.kind}
          >
            <span className={station.kind === "main" ? "ln-name font-mono" : "ln-name"}>
              {station.name}
            </span>
            <div
              className="ln-track"
              ref={(element) => {
                track(at, element);
              }}
            >
              {segment === undefined ? null : (
                <span
                  aria-hidden="true"
                  className="ln-rail"
                  data-track={held ? "solid" : segment.track}
                />
              )}
              <span
                aria-hidden="true"
                className="ln-node"
                data-node={held ? "solid" : station.node}
              />
              {segment === undefined || held ? null : (
                <SegmentBeads
                  onOpenChange={onOpenChange}
                  segment={segment}
                  width={widths[at] ?? 0}
                />
              )}
            </div>
            <div className="ln-foot">
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

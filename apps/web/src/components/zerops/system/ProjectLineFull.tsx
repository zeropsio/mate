/**
 * The line in full (`projectLineFull`), behind its picture (`ProjectLine`): the same stations,
 * track, beads and counts, with what each station is under its name — its Mates, its repositories,
 * a place's state — and a row under `main` for each further place. Under the line, a row for each
 * Mate: its own changes under the segment each is on, its newest eight and then a count; the rows
 * past the first six fold behind *Show N more Mates*, which stands at the rows' head and so stays
 * where it was pressed.
 *
 * It leads and never acts: a place's station and a further place's row open the place's page, a
 * bead its change's review, a count its group of the Changes list. A place's vault, its addresses
 * and every verb stay with the project's Places.
 *
 * `held` keeps its shape (track, station dots and the room of its side rows, no beads) while the
 * project's reads have not answered. Under 700 px of its own width it is compact: station names
 * only, short captions, the same beads.
 *
 * Props: `view` (`projectLineFull(…)`); `groupId` (a place opens `/group/$groupId/$projectId`);
 * `held`; `onOpenChange(pull, from)`; `onShowGroup(group)`.
 */
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";

import { InlineButton } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { CutText } from "./ChangeRow";
import {
  Bead,
  Caption,
  SegmentBeads,
  textOf,
  useTrackWidths,
  Words,
  type OpenLineChange,
  type ShowLineGroup,
} from "./ProjectLineParts";
import {
  moreChipWidth,
  ROWS_SHOWN,
  type LineMateRow,
  type LineSide,
  type LineStationFull,
  type ProjectLineFullView,
} from "./projectLine.logic";

export interface ProjectLineFullProps {
  /** `undefined` while the project is unread: nothing drawn. */
  readonly view: ProjectLineFullView | undefined;
  readonly groupId: string;
  /** The project's reads have not answered: the line's shape alone. */
  readonly held?: boolean | undefined;
  readonly onOpenChange: OpenLineChange;
  readonly onShowGroup?: ShowLineGroup;
}

const UNREAD: ProjectLineFullView = { stations: [], segments: [], sides: [], mates: [] };

export function ProjectLineFull({
  view,
  groupId,
  held = false,
  onOpenChange,
  onShowGroup,
}: ProjectLineFullProps) {
  const { stations, segments, sides, mates } = view ?? UNREAD;
  const [widths, track] = useTrackWidths(segments.length);
  return (
    <div className="lnx" data-sides={sides.length > 0 ? "" : undefined}>
      <div className="lnx-grid">
        {stations.map((station, at) => {
          const segment = segments[at];
          return (
            <div
              className="lnx-col"
              data-kind={station.kind}
              data-seg={segment?.key}
              key={station.kind}
            >
              <div className="lnx-head">
                <StationName groupId={groupId} held={held} station={station} />
                {held ? null : <StationLines station={station} />}
              </div>
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
                  data-node={station.node}
                  data-tone={held ? "neutral" : station.tone}
                />
                {segment === undefined || held ? null : (
                  <SegmentBeads
                    onOpenChange={onOpenChange}
                    segment={segment}
                    width={widths[at] ?? 0}
                  />
                )}
              </div>
              <div className="lnx-foot">
                {held ? null : segment === undefined ? (
                  // What production runs, where the line is compact and its state has no room.
                  station.version === undefined ? null : (
                    <span className="ln-words ln-short font-mono">{station.version}</span>
                  )
                ) : (
                  <Caption onShowGroup={onShowGroup} segment={segment} />
                )}
              </div>
            </div>
          );
        })}
        {sides.length === 0 ? null : (
          <ul aria-hidden={held ? true : undefined} className="lnx-sides" data-zerops-line-sides="">
            {sides.map((side) =>
              held ? (
                <li className="lnx-side" key={side.key}>
                  <span className="ln-held" />
                </li>
              ) : (
                <SideRow groupId={groupId} key={side.key} side={side} />
              ),
            )}
          </ul>
        )}
      </div>
      {held || mates.length === 0 ? null : <MateRows onOpenChange={onOpenChange} rows={mates} />}
    </div>
  );
}

/**
 * A row for each Mate, on the line's columns. The first six stand; the rest fold behind the verb
 * at the rows' head.
 */
function MateRows({
  rows,
  onOpenChange,
}: {
  readonly rows: ReadonlyArray<LineMateRow>;
  readonly onOpenChange: OpenLineChange;
}) {
  const [all, setAll] = useState(false);
  const label = useId();
  const rest = rows.slice(ROWS_SHOWN);
  const list = (some: ReadonlyArray<LineMateRow>) =>
    some.map((row) => <MateRow key={row.key} onOpenChange={onOpenChange} row={row} />);
  return (
    <div className="lnx-mates" data-zerops-line-mates="">
      <div className="lnx-mates-head">
        <span className="ln-words" id={label}>
          Each Mate’s changes
        </span>
        {rest.length === 0 ? null : (
          <span className="ln-words">
            <InlineButton
              aria-expanded={all}
              onClick={() => {
                setAll((now) => !now);
              }}
              tone="muted"
            >
              {all
                ? "Show fewer Mates"
                : `Show ${String(rest.length)} more ${rest.length === 1 ? "Mate" : "Mates"}`}
            </InlineButton>
          </span>
        )}
      </div>
      <ul aria-labelledby={label} className="lnx-rows">
        {list(rows.slice(0, ROWS_SHOWN))}
      </ul>
      {rest.length === 0 ? null : (
        <div className="lnx-more" data-open={all ? "" : undefined}>
          <ul aria-label="More Mates’ changes" className="lnx-rows" inert={!all}>
            {list(rest)}
          </ul>
        </div>
      )}
    </div>
  );
}

function MateRow({
  row,
  onOpenChange,
}: {
  readonly row: LineMateRow;
  readonly onOpenChange: OpenLineChange;
}) {
  const [work, ...after] = row.cells;
  const cell = (each: LineMateRow["cells"][number], earlier: number) => (
    <span className="lnx-cell" data-seg={each.key} key={each.key}>
      {each.beads.length === 0 && earlier === 0 ? null : (
        <ul aria-label={each.label}>
          {earlier === 0 ? null : (
            <li>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      aria-label={`${String(earlier)} earlier`}
                      className="ln-more"
                      data-wide={moreChipWidth(earlier) > 28 ? "" : undefined}
                      role="img"
                      tabIndex={0}
                    />
                  }
                >
                  +{earlier}
                </TooltipTrigger>
                <TooltipPopup side="top">
                  +{earlier} earlier {earlier === 1 ? "change" : "changes"}
                </TooltipPopup>
              </Tooltip>
            </li>
          )}
          {each.beads.map((bead) => (
            <li key={bead.key}>
              <Bead bead={bead} onOpenChange={onOpenChange} />
            </li>
          ))}
        </ul>
      )}
    </span>
  );
  return (
    <li className="lnx-row">
      <span className="lnx-first">
        <span className="lnx-who">
          <i aria-hidden="true" className="ln-face" data-tint={row.tint} />
          <span>{row.name}</span>
        </span>
        {work === undefined ? null : cell(work, row.earlier)}
      </span>
      {after.map((each) => cell(each, 0))}
    </li>
  );
}

function StationName({
  station,
  groupId,
  held,
}: {
  readonly station: LineStationFull;
  readonly groupId: string;
  readonly held: boolean;
}) {
  if (!held && station.projectId !== undefined)
    return (
      <Link
        className="ln-name rounded-sm"
        params={{ groupId, projectId: station.projectId }}
        preload="intent"
        to="/group/$groupId/$projectId"
      >
        {station.name}
      </Link>
    );
  return (
    <span className={station.kind === "main" ? "ln-name font-mono" : "ln-name"}>
      {station.name}
    </span>
  );
}

/** Under a station's name: its Mates, its repositories, a place's state. */
function StationLines({ station }: { readonly station: LineStationFull }) {
  return (
    <>
      {station.lines.map((line, index) => (
        <CutText className="ln-words" key={textOf(line)} text={textOf(line)}>
          {index === 0
            ? station.tints.map((face) => (
                <i aria-hidden="true" className="ln-face" data-tint={face.tint} key={face.key} />
              ))
            : null}
          <Words words={line} />
        </CutText>
      ))}
    </>
  );
}

function SideRow({ side, groupId }: { readonly side: LineSide; readonly groupId: string }) {
  const words = (
    <CutText className="ln-words" text={textOf(side.words)}>
      <Words words={side.words} />
    </CutText>
  );
  return (
    <li className="lnx-side">
      {side.projectId === undefined ? (
        words
      ) : (
        <Link
          className="min-w-0 rounded-sm"
          params={{ groupId, projectId: side.projectId }}
          preload="intent"
          to="/group/$groupId/$projectId"
        >
          {words}
        </Link>
      )}
    </li>
  );
}

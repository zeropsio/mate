/**
 * The line in full (`projectLineFull`), behind its picture (`ProjectLine`): the same stations,
 * track, beads and counts, with what each station is under its name — its Mates, its repositories,
 * a place's state — and a row under `main` for each further place.
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

import { CutText } from "./ChangeRow";
import {
  Caption,
  SegmentBeads,
  textOf,
  useTrackWidths,
  Words,
  type OpenLineChange,
  type ShowLineGroup,
} from "./ProjectLineParts";
import type { LineSide, LineStationFull, ProjectLineFullView } from "./projectLine.logic";

export interface ProjectLineFullProps {
  /** `undefined` while the project is unread: nothing drawn. */
  readonly view: ProjectLineFullView | undefined;
  readonly groupId: string;
  /** The project's reads have not answered: the line's shape alone. */
  readonly held?: boolean | undefined;
  readonly onOpenChange: OpenLineChange;
  readonly onShowGroup?: ShowLineGroup;
}

const UNREAD: ProjectLineFullView = { stations: [], segments: [], sides: [] };

export function ProjectLineFull({
  view,
  groupId,
  held = false,
  onOpenChange,
  onShowGroup,
}: ProjectLineFullProps) {
  const { stations, segments, sides } = view ?? UNREAD;
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
    </div>
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

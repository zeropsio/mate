/**
 * The line in full (`projectLineFull`), behind its picture (`ProjectLine`), as its board drew it:
 * the same stations, track, beads and counts, with what each station is under its name — its Mates,
 * its repositories, a place's state — under each segment its count and its one verb (*Review the
 * next one*, *Review release*, *Put it live*: the blue one is what waits on the person), and a row
 * under `main` for each copy of the code elsewhere and each further place. Last, what a bead's
 * marks mean. It prints no address and holds no door: a place's Sites and Vault stand on its line
 * in Places, right above (an address is reached through a Sites door, a door stands once).
 *
 * A station's name opens what it names: a place its page, Mates' work the page's Mates. A further
 * place's row opens its page, a bead its change's review, a count its group of the Changes list.
 *
 * `held` keeps its shape (track, station dots and the room of its side rows, no beads) while the
 * project's reads have not answered. Under 700 px of its own width it is compact: station names
 * only, short captions, a release's verb as a link, the same beads.
 *
 * Props: `view` (`projectLineFull(…)`); `groupId` (a place opens `/group/$groupId/$projectId`);
 * `held`; `onOpenChange(pull, from)` (a bead and *Review*); `onShowGroup(group)`;
 * `onReviewRelease(from)`; `onPutLive`; `onOpenMates(from)` (Mates' work: the page's Mates
 * section).
 */
import { REVIEW_RELEASE_LABEL } from "@t3tools/client-runtime/zerops";
import { Link } from "@tanstack/react-router";

import { Button, InlineButton } from "~/components/ui/button";
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
import {
  type LineBead,
  type LineSegmentFull,
  type LineSide,
  type LineStationFull,
  type ProjectLineFullView,
} from "./projectLine.logic";

/** What the line in full acts on: its verbs, and what its stations open. */
export interface ProjectLineFullActs {
  readonly onReviewRelease: (from: HTMLElement) => void;
  readonly onPutLive?: (() => void) | undefined;
  readonly onOpenMates?: ((from: HTMLElement) => void) | undefined;
}

export interface ProjectLineFullProps extends ProjectLineFullActs {
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
  onReviewRelease,
  onPutLive,
  onOpenMates,
}: ProjectLineFullProps) {
  const { stations, segments, sides } = view ?? UNREAD;
  const [widths, track] = useTrackWidths(segments.length);
  const press = (segment: LineSegmentFull, from: HTMLElement) => {
    const verb = segment.verb;
    if (verb === undefined) return;
    if (verb.kind === "review-change") onOpenChange(verb.pull, from);
    else if (verb.kind === "review-release") onReviewRelease(from);
    else onPutLive?.();
  };
  const marks = held ? [] : segments.flatMap((segment) => segment.beads);
  return (
    <div
      className="lnx"
      data-release={!held && segments.at(-1)?.track === "failed" ? "failed" : undefined}
      data-sides={sides.length > 0 ? "" : undefined}
    >
      <div className="lnx-grid">
        {stations.map((station, at) => {
          const segment = segments[at];
          return (
            <div
              className="lnx-col"
              data-kind={station.kind}
              data-seg={segment?.key}
              data-track={held ? undefined : segment?.track}
              key={station.kind}
            >
              <div className="lnx-head">
                <StationName
                  groupId={groupId}
                  held={held}
                  onOpenMates={onOpenMates}
                  station={station}
                />
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
                    tip="end"
                    width={widths[at] ?? 0}
                  />
                )}
              </div>
              <div className="lnx-foot">
                {held ? null : segment === undefined ? (
                  <ProductionFoot station={station} />
                ) : (
                  <SegmentFoot
                    onPress={(from) => {
                      press(segment, from);
                    }}
                    onShowGroup={onShowGroup}
                    segment={segment}
                  />
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
      {held || view === undefined ? null : <Legend beads={marks} />}
    </div>
  );
}

/** Under a segment: its count, then its one verb; compact, a release's verb in the count's place. */
function SegmentFoot({
  segment,
  onShowGroup,
  onPress,
}: {
  readonly segment: LineSegmentFull;
  readonly onShowGroup: ShowLineGroup;
  readonly onPress: (from: HTMLElement) => void;
}) {
  const { verb } = segment;
  const acts = (event: { readonly currentTarget: HTMLElement }) => {
    onPress(event.currentTarget);
  };
  return (
    <>
      {verb !== undefined && segment.caption.length === 0 && !segment.held ? (
        // A verb keeps its place under the track where its segment has no word.
        <span aria-hidden="true" className="ln-words ln-full" />
      ) : null}
      <Caption
        compact={
          verb === undefined || verb.kind === "review-change" ? undefined : (
            <InlineButton onClick={acts}>{verb.label}</InlineButton>
          )
        }
        onShowGroup={onShowGroup}
        segment={segment}
      />
      {verb === undefined ? null : (
        <span className="ln-full">
          <Button
            data-zerops-primary-action={
              verb.kind === "review-release" ? REVIEW_RELEASE_LABEL : undefined
            }
            onClick={acts}
            size="sm"
            variant={isPrimary(verb) ? "primary" : "secondary"}
          >
            {verb.label}
          </Button>
        </span>
      )}
    </>
  );
}

/** The blue verb is the one thing that waits on the person: a release, or going live. */
const isPrimary = (verb: NonNullable<LineSegmentFull["verb"]>) =>
  verb.kind === "put-live" || (verb.kind === "review-release" && verb.primary);

/** Under production's dot, where the line is compact: what it runs. */
function ProductionFoot({ station }: { readonly station: LineStationFull }) {
  return station.version === undefined ? null : (
    <span className="ln-words ln-short font-mono">{station.version}</span>
  );
}

/**
 * What a bead's marks mean, at the card's foot: a change in its Mate's colour, the ring of one that
 * waits on the person, the mark of a stuck one, and work that is no change yet where the line
 * draws any (a Mate's own line reads its checkout; a project's reads none).
 */
function Legend({ beads }: { readonly beads: ReadonlyArray<LineBead> }) {
  const tint = beads.find((bead) => bead.tint !== undefined)?.tint;
  const keys: ReadonlyArray<{ readonly mark: LineBead["mark"]; readonly words: string }> = [
    { mark: undefined, words: "a change, in its Mate’s colour" },
    { mark: "waits", words: "waits on you" },
    { mark: "stuck", words: "stuck, its Mate’s to fix" },
    ...(beads.some((bead) => bead.mark === "work")
      ? [{ mark: "work" as const, words: "work not yet a change" }]
      : []),
  ];
  return (
    <ul aria-label="What the marks mean" className="lnx-legend" data-zerops-line-legend="">
      {keys.map((key) => (
        <li key={key.words}>
          <i aria-hidden="true" className="ln-bead" data-mark={key.mark} data-tint={tint} />
          <span className="ln-words">{key.words}</span>
        </li>
      ))}
    </ul>
  );
}

function StationName({
  station,
  groupId,
  held,
  onOpenMates,
}: {
  readonly station: LineStationFull;
  readonly groupId: string;
  readonly held: boolean;
  readonly onOpenMates: ProjectLineFullProps["onOpenMates"];
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
  if (!held && station.kind === "mates" && onOpenMates !== undefined)
    return (
      <button
        className="ln-name rounded-sm"
        onClick={(event) => {
          onOpenMates(event.currentTarget);
        }}
        type="button"
      >
        {station.name}
      </button>
    );
  return (
    <span className={station.kind === "main" ? "ln-name font-mono" : "ln-name"}>
      {station.name}
    </span>
  );
}

/** Under a station's name: its Mates, its repositories, a place's state. */
function StationLines({ station }: { readonly station: LineStationFull }) {
  return station.lines.map((line, index) => (
    <CutText className="ln-words" key={textOf(line)} text={textOf(line)}>
      {index === 0
        ? station.tints.map((face) => (
            <i aria-hidden="true" className="ln-face" data-tint={face.tint} key={face.key} />
          ))
        : null}
      <Words words={line} />
    </CutText>
  ));
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

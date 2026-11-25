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
 * A bead names its change (`data-zerops-change`), as the change's row in the list under it does:
 * the page marks the one while the other is pointed at.
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
import { mateTintStyle } from "../mateTint";
import { BeadMark } from "./BeadMark";
import {
  Caption,
  LINE_FULL,
  LINE_SHORT,
  LINE_WORDS,
  lineColumns,
  LineNode,
  LineRail,
  SegmentBeads,
  STATION_NAME,
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

interface ProjectLineFullProps extends ProjectLineFullActs {
  /** It is the masthead of a page's Changes card, its sides the rows' under it. */
  readonly band?: boolean | undefined;
  /** `undefined` while the project is unread: nothing drawn. */
  readonly view: ProjectLineFullView | undefined;
  readonly groupId: string;
  /** The project's reads have not answered: the line's shape alone. */
  readonly held?: boolean | undefined;
  readonly onOpenChange: OpenLineChange;
  readonly onShowGroup?: ShowLineGroup;
}

const UNREAD: ProjectLineFullView = { stations: [], segments: [], sides: [] };

/**
 * The line in full, as its board drew it: the picture's stations on the picture's columns, each
 * with what it is under its name (60 px; 30 px compact, its names alone), the track, then its count
 * and its one verb; then a row under `main` for each copy of the code and each further place,
 * 22 px each.
 */
const GRID = {
  card: "box-border grid min-w-0 pt-5 pr-6 pb-3.5 pl-7 @max-[700px]/line:grid-rows-[minmax(90px,auto)] sm:@max-[700px]/line:px-5 max-sm:px-4",
  band: "box-border grid min-w-0 px-4.5 pt-4 @max-[700px]/line:grid-rows-[minmax(90px,auto)]",
};
const COLUMN =
  "relative grid min-w-0 grid-rows-[60px_16px_auto] content-start @max-[700px]/line:grid-rows-[30px_16px_auto]";
/**
 * Rows hung under `main` on a dashed spine: from under `main`'s dot to its column's end, then
 * beside the rows to the last one.
 */
const MAIN_SPINE =
  "after:absolute after:top-[78px] after:bottom-0 after:left-1.25 after:w-0 after:border-l-2 after:border-dashed after:border-(--ln-faint) @max-[700px]/line:after:top-12";
/** Under the track: a segment's count and its one verb; production's version, compact. */
const FOOT =
  "grid min-w-0 content-start justify-items-start gap-2 pt-3 pe-4.5 pb-3.5 @max-[700px]/line:pe-2";

export function ProjectLineFull({
  band = false,
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
  // A release that did not go live says why in one sentence, on two lines where one cuts it. On a
  // line with a stage it takes production's room under the track too; production's address then
  // stands in the page's Addresses.
  const failedRelease = !held && segments.at(-1)?.track === "failed";
  const wide = stations.length === 4;
  const hung = sides.length > 0;
  return (
    <div className="min-w-0">
      <div className={`${GRID[band ? "band" : "card"]} ${lineColumns(stations.length)}`}>
        {stations.map((station, at) => {
          const segment = segments[at];
          const whyFailed = failedRelease && segment?.key === "release";
          return (
            <div
              className={hung && station.kind === "main" ? `${COLUMN} ${MAIN_SPINE}` : COLUMN}
              data-kind={station.kind}
              key={station.kind}
            >
              <div className="grid min-w-0 content-start pe-4.5 @max-[700px]/line:pe-2">
                <StationName
                  groupId={groupId}
                  held={held}
                  onOpenMates={onOpenMates}
                  station={station}
                />
                {held ? null : <StationLines station={station} />}
              </div>
              <div
                className="relative min-w-0"
                ref={(element) => {
                  track(at, element);
                }}
              >
                {segment === undefined ? null : <LineRail track={held ? "solid" : segment.track} />}
                <LineNode node={station.node} tone={held ? "neutral" : station.tone} />
                {segment === undefined || held ? null : (
                  <SegmentBeads
                    onOpenChange={onOpenChange}
                    segment={segment}
                    tip="end"
                    width={widths[at] ?? 0}
                  />
                )}
              </div>
              <div
                className={
                  hung && station.kind === "main"
                    ? `${FOOT} ps-7`
                    : whyFailed && wide
                      ? `${FOOT} overflow-visible pe-0`
                      : failedRelease && wide && station.kind === "production"
                        ? `${FOOT} invisible @max-[700px]/line:visible`
                        : FOOT
                }
              >
                {held ? null : segment === undefined ? (
                  <ProductionFoot station={station} />
                ) : (
                  <SegmentFoot
                    onPress={(from) => {
                      press(segment, from);
                    }}
                    onShowGroup={onShowGroup}
                    segment={segment}
                    whyFailed={whyFailed ? (wide ? "wide" : "column") : undefined}
                  />
                )}
              </div>
            </div>
          );
        })}
        {sides.length === 0 ? null : (
          <ul
            aria-hidden={held ? true : undefined}
            className="relative col-[2/-1] min-w-0 pb-3.5 before:absolute before:top-0 before:bottom-6 before:left-1.25 before:w-0 before:border-l-2 before:border-dashed before:border-(--ln-faint)"
            data-zerops-line-sides=""
          >
            {sides.map((side) =>
              held ? (
                <li className={SIDE} key={side.key}>
                  <span className="my-1 h-2 w-24 rounded-full bg-foreground/8" />
                </li>
              ) : (
                <SideRow groupId={groupId} key={side.key} side={side} />
              ),
            )}
          </ul>
        )}
      </div>
      {held || view === undefined ? null : <Legend band={band} beads={marks} />}
    </div>
  );
}

/** Under a segment: its count, then its one verb; compact, a release's verb in the count's place. */
/** Why a release did not go live, on two lines: across production's room too on a line with a stage. */
const WHY_FAILED = {
  column: "line-clamp-2 block max-h-8 max-w-full min-w-0 text-caption text-muted-foreground",
  wide: "line-clamp-2 block max-h-8 w-max max-w-[calc((100cqw-52px)*0.4519)] min-w-0 text-caption text-muted-foreground",
};

function SegmentFoot({
  segment,
  onShowGroup,
  onPress,
  whyFailed,
}: {
  readonly segment: LineSegmentFull;
  readonly onShowGroup: ShowLineGroup;
  readonly onPress: (from: HTMLElement) => void;
  readonly whyFailed: "column" | "wide" | undefined;
}) {
  const { verb } = segment;
  const acts = (event: { readonly currentTarget: HTMLElement }) => {
    onPress(event.currentTarget);
  };
  return (
    <>
      {verb !== undefined && segment.caption.length === 0 && !segment.held ? (
        // A verb keeps its place under the track where its segment has no word.
        <span aria-hidden="true" className={`${LINE_WORDS} ${LINE_FULL}`} />
      ) : null}
      <Caption
        compact={
          verb === undefined || verb.kind === "review-change" ? undefined : (
            <InlineButton onClick={acts}>{verb.label}</InlineButton>
          )
        }
        fullClassName={whyFailed === undefined ? undefined : WHY_FAILED[whyFailed]}
        onShowGroup={onShowGroup}
        segment={segment}
      />
      {verb === undefined ? null : (
        <span className={LINE_FULL}>
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
    <span className={`${LINE_WORDS} ${LINE_SHORT} font-mono`}>{station.version}</span>
  );
}

/**
 * What a bead's marks mean, at the line's foot: only the marks the line draws now — the ring of a
 * change that waits on the person, the mark of a stuck one, work that is no change yet (a Mate's
 * own line reads its checkout) — after a plain bead to tell them from. A line of plain beads
 * alone has no legend: its rows under it wear the same beads and name them.
 */
function Legend({
  beads,
  band,
}: {
  readonly beads: ReadonlyArray<LineBead>;
  readonly band: boolean;
}) {
  const tint = beads.find((bead) => bead.tint !== undefined)?.tint;
  const drawn = (mark: LineBead["mark"]) => beads.some((bead) => bead.mark === mark);
  const marked: ReadonlyArray<{ readonly mark: LineBead["mark"]; readonly words: string }> = [
    ...(drawn("waits") ? [{ mark: "waits" as const, words: "waits on you" }] : []),
    ...(drawn("stuck") ? [{ mark: "stuck" as const, words: "stuck, its Mate’s to fix" }] : []),
    ...(drawn("work") ? [{ mark: "work" as const, words: "work not yet a change" }] : []),
  ];
  if (marked.length === 0) return null;
  const keys = [{ mark: undefined, words: "a change, in its Mate’s colour" }, ...marked];
  return (
    <ul
      aria-label="What the marks mean"
      className={band ? `${LEGEND} mx-4.5` : `${LEGEND} ms-7 me-6`}
      data-zerops-line-legend=""
    >
      {keys.map((key) => (
        <li className="flex min-w-0 items-center gap-2" key={key.words}>
          <BeadMark className="pointer-events-none flex-none" mark={key.mark} tint={tint} />
          <span className={LINE_WORDS}>{key.words}</span>
        </li>
      ))}
    </ul>
  );
}

/** What a bead's marks mean, at the card's foot. */
const LEGEND =
  "flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-border pt-2.5 pb-3";
/** A row hung under `main`, its dash from the spine to its words. */
const SIDE =
  "relative flex h-5.5 min-w-0 items-center ps-7 before:absolute before:top-2.5 before:left-1.5 before:h-0 before:w-3.5 before:border-t-2 before:border-dashed before:border-(--ln-faint)";

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
        className={`${STATION_NAME} rounded-mark hover:underline hover:underline-offset-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
        params={{ groupId, projectId: station.projectId }}
        preload="intent"
        to="/group/$groupId/$projectId"
      >
        {station.name}
      </Link>
    );
  if (!held && station.kind === "mates" && onOpenMates !== undefined)
    return (
      <span className={STATION_NAME}>
        <InlineButton
          className="max-w-full"
          onClick={(event) => {
            onOpenMates(event.currentTarget);
          }}
          tone="plain"
        >
          <span className="truncate font-semibold">{station.name}</span>
        </InlineButton>
      </span>
    );
  return (
    <span className={station.kind === "main" ? `${STATION_NAME} font-mono` : STATION_NAME}>
      {station.name}
    </span>
  );
}

/** Under a station's name: its Mates, its repositories, a place's state. */
function StationLines({ station }: { readonly station: LineStationFull }) {
  return station.lines.map((line, index) => (
    <CutText className={`${LINE_WORDS} ${LINE_FULL}`} key={textOf(line)} text={textOf(line)}>
      {/* A Mate's tint as a face-shaped square, before the Mates' names. */}
      {index === 0
        ? station.tints.map((face) => (
            <i
              aria-hidden="true"
              className="me-0.75 inline-block size-3.5 rounded-mark bg-(--mate-tint,var(--ln-track)) align-[-3px] last-of-type:me-1.5"
              key={face.key}
              style={face.tint === undefined ? undefined : mateTintStyle(face.tint)}
            />
          ))
        : null}
      <Words words={line} />
    </CutText>
  ));
}

function SideRow({ side, groupId }: { readonly side: LineSide; readonly groupId: string }) {
  const words = (
    <CutText className={LINE_WORDS} text={textOf(side.words)}>
      <Words words={side.words} />
    </CutText>
  );
  return (
    <li className={SIDE}>
      {side.projectId === undefined ? (
        words
      ) : (
        <Link
          className="min-w-0 rounded-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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

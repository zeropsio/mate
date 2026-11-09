/**
 * The line (`projectLine`), drawn: a project's stations on one horizontal track, the changes
 * between them as beads, a row under `main` for each further place or copy that is not calm.
 *
 * Its shape is the project's setup; activity only fills a capped row of beads and changes numbers.
 * Its height is fixed per shape, and `held` keeps that shape (track, station dots and the room of
 * its side rows, no beads) while the project's reads have not answered. Under 700 px of its own width it is compact:
 * station names only, short captions, the same beads (a container query; a Mate's Code page).
 *
 * Props: `view` (`projectLine(…)`); `groupId` (a place's station opens
 * `/group/$groupId/$projectId`); `held`; `onOpenChange(pull, from)` (a bead and *Review*: the
 * change's review, as its row in the Changes list opens it); `onReviewRelease(from)`; `onPutLive`;
 * `onOpenMates(from)` (Mates' work: the page's Mates section).
 */
import { Link } from "@tanstack/react-router";
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { REVIEW_RELEASE_LABEL } from "@t3tools/client-runtime/zerops";
import { useLayoutEffect, useRef, useState } from "react";

import { Button, InlineButton } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { CutText } from "./ChangeRow";
import {
  fitBeads,
  moreChipWidth,
  type LineBead,
  type LineSegment,
  type LineSide,
  type LineStation,
  type LineWord,
  type ProjectLineView,
} from "./projectLine.logic";

export interface ProjectLineProps {
  readonly view: ProjectLineView;
  readonly groupId: string;
  /** The project's reads have not answered: the line's shape alone. */
  readonly held?: boolean | undefined;
  readonly onOpenChange: (pull: FlowPullRequest, from: HTMLElement) => void;
  readonly onReviewRelease: (from: HTMLElement) => void;
  readonly onPutLive?: (() => void) | undefined;
  readonly onOpenMates?: ((from: HTMLElement) => void) | undefined;
}

export function ProjectLine({
  view,
  groupId,
  held = false,
  onOpenChange,
  onReviewRelease,
  onPutLive,
  onOpenMates,
}: ProjectLineProps) {
  const { stations, segments, sides } = view;
  const [widths, track] = useTrackWidths(segments.length);
  const release = segments.at(-1);
  const press = (segment: LineSegment, from: HTMLElement) => {
    const verb = segment.verb;
    if (verb === undefined) return;
    if (verb.kind === "review-change") onOpenChange(verb.pull, from);
    else if (verb.kind === "review-release") onReviewRelease(from);
    else onPutLive?.();
  };
  return (
    <div
      aria-busy={held ? true : undefined}
      aria-label="Where each change is"
      className="pp-card ln"
      data-release={!held && release?.track === "failed" ? "failed" : undefined}
      data-sides={sides.length > 0 ? "" : undefined}
      data-stations={String(stations.length)}
      data-zerops-surface="project-line"
      role="group"
    >
      <div className="ln-grid">
        {stations.map((station, at) => {
          const segment = segments[at];
          const fit =
            segment === undefined || held
              ? undefined
              : fitBeads(segment.beads, segment.more, widths[at] ?? 0);
          return (
            <div
              className="ln-col"
              data-kind={station.kind}
              data-seg={segment?.key}
              data-track={held ? undefined : segment?.track}
              key={station.kind}
            >
              <div className="ln-head">
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
                {segment === undefined || fit === undefined ? null : (
                  <ul aria-label={segment.label} className="ln-beads">
                    {fit.more === 0 ? null : (
                      <li>
                        <span
                          aria-label={`${String(fit.more)} more`}
                          className="ln-more"
                          data-wide={moreChipWidth(fit.more) > 28 ? "" : undefined}
                        >
                          +{fit.more}
                        </span>
                      </li>
                    )}
                    {fit.beads.map((bead) => (
                      <li key={bead.key}>
                        <Bead bead={bead} onOpenChange={onOpenChange} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="ln-foot">
                {held ? null : segment === undefined ? (
                  <ProductionFoot station={station} />
                ) : (
                  <SegmentFoot
                    onPress={(from) => {
                      press(segment, from);
                    }}
                    segment={segment}
                  />
                )}
              </div>
            </div>
          );
        })}
        {sides.length === 0 ? null : (
          <ul aria-hidden={held ? true : undefined} className="ln-sides" data-zerops-line-sides="">
            {sides.map((side) =>
              held ? (
                <li className="ln-side" key={side.key}>
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

/**
 * Each segment's width as laid out, which says how many beads it has room for: read before the
 * first paint, then whenever the line is resized.
 */
function useTrackWidths(
  segments: number,
): readonly [ReadonlyArray<number>, (at: number, element: HTMLElement | null) => void] {
  const elements = useRef<Array<HTMLElement | null>>([]);
  const [widths, setWidths] = useState<ReadonlyArray<number>>([]);
  useLayoutEffect(() => {
    const read = () => {
      const next = Array.from({ length: segments }, (_, at) =>
        Math.floor(elements.current[at]?.getBoundingClientRect().width ?? 0),
      );
      setWidths((now) =>
        now.length === next.length && now.every((width, at) => width === next[at]) ? now : next,
      );
    };
    read();
    const observer = new ResizeObserver(read);
    for (const element of elements.current.slice(0, segments))
      if (element !== null && element !== undefined) observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [segments]);
  return [
    widths,
    (at, element) => {
      elements.current[at] = element;
    },
  ];
}

function Words({ words }: { readonly words: ReadonlyArray<LineWord> }) {
  return (
    <>
      {words.map((word, index) => (
        <span
          className={word.mono === true ? "font-mono" : undefined}
          data-strong={word.strong === true ? "" : undefined}
          data-tone={word.tone}
          // Words keep their order: a line is said whole, never reordered.
          key={`${String(index)}:${word.text}`}
        >
          {word.text}
        </span>
      ))}
    </>
  );
}

const textOf = (words: ReadonlyArray<LineWord>) => words.map((word) => word.text).join("");

function StationName({
  station,
  groupId,
  held,
  onOpenMates,
}: {
  readonly station: LineStation;
  readonly groupId: string;
  readonly held: boolean;
  readonly onOpenMates: ProjectLineProps["onOpenMates"];
}) {
  if (!held && station.projectId !== undefined)
    return (
      <Link
        className="ln-name rounded-sm"
        params={{ groupId, projectId: station.projectId }}
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

/** Under a station's name: its Mates, its repositories, a place's state; a stage's address. */
function StationLines({ station }: { readonly station: LineStation }) {
  return (
    <>
      {station.lines.map((line, index) => (
        <CutText className="ln-words" key={textOf(line)} text={textOf(line)}>
          {index === 0
            ? station.tints.map((tint, at) => (
                // Tints repeat among a project's Mates: their order is their identity here.
                // oxlint-disable-next-line react/no-array-index-key
                <i aria-hidden="true" className="ln-face" data-tint={tint} key={at} />
              ))
            : null}
          <Words words={line} />
        </CutText>
      ))}
      {station.kind === "stage" && station.address !== undefined ? (
        <Address address={station.address} name={station.name} />
      ) : null}
    </>
  );
}

function Address({
  address,
  name,
}: {
  readonly address: NonNullable<LineStation["address"]>;
  readonly name: string;
}) {
  return (
    <span className="ln-words ln-full">
      <a
        aria-label={`Open ${name} at ${address.host}`}
        className="rounded-sm"
        href={address.url}
        rel="noreferrer"
        target="_blank"
      >
        {address.host} ↗
      </a>
    </span>
  );
}

/** Under production's dot: its address; what it runs where the line is compact. */
function ProductionFoot({ station }: { readonly station: LineStation }) {
  return (
    <>
      {station.address === undefined ? null : (
        <Address address={station.address} name={station.name} />
      )}
      {station.version === undefined ? null : (
        <span className="ln-words ln-short font-mono">{station.version}</span>
      )}
    </>
  );
}

/** Under a segment: its caption, then its one verb; compact, a short caption or the release's word. */
function SegmentFoot({
  segment,
  onPress,
}: {
  readonly segment: LineSegment;
  readonly onPress: (from: HTMLElement) => void;
}) {
  const { verb } = segment;
  const acts = (event: { readonly currentTarget: HTMLElement }) => {
    onPress(event.currentTarget);
  };
  const compactVerb = verb !== undefined && verb.kind !== "review-change";
  return (
    <>
      {segment.caption.length > 0 ? (
        <CutText className="ln-words ln-full" text={textOf(segment.caption)}>
          <Words words={segment.caption} />
        </CutText>
      ) : segment.held ? (
        <span aria-hidden="true" className="ln-held ln-full" />
      ) : verb === undefined ? null : (
        // A verb keeps its place under the track where its segment has no word.
        <span aria-hidden="true" className="ln-words ln-full" />
      )}
      {verb === undefined ? null : (
        <span className="ln-full">
          <Button
            data-zerops-primary-action={
              verb.kind === "review-release" && verb.label === REVIEW_RELEASE_LABEL
                ? REVIEW_RELEASE_LABEL
                : undefined
            }
            onClick={acts}
            size="sm"
            variant={verb.kind === "review-change" || !isPrimary(verb) ? "secondary" : "primary"}
          >
            {verb.label}
          </Button>
        </span>
      )}
      {compactVerb ? (
        <span className="ln-words ln-short">
          <InlineButton onClick={acts}>{verb.label}</InlineButton>
        </span>
      ) : segment.short.length === 0 ? null : (
        <span className="ln-words ln-short">
          <Words words={segment.short} />
        </span>
      )}
    </>
  );
}

const isPrimary = (verb: NonNullable<LineSegment["verb"]>) =>
  verb.kind === "put-live" || (verb.kind === "review-release" && verb.primary);

/**
 * One change on the track: its title and "Mate · state" on hover and focus; pressed, its review.
 * Work that is not a change yet opens nothing.
 */
function Bead({
  bead,
  onOpenChange,
}: {
  readonly bead: LineBead;
  readonly onOpenChange: ProjectLineProps["onOpenChange"];
}) {
  const pull = bead.pull;
  const label = `${bead.title}, ${bead.line}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          pull === undefined ? (
            <span
              aria-label={label}
              className="ln-bead"
              data-mark={bead.mark}
              data-tint={bead.tint}
              role="img"
              tabIndex={0}
            />
          ) : (
            <button
              aria-label={label}
              className="ln-bead"
              data-mark={bead.mark}
              data-tint={bead.tint}
              onClick={(event) => {
                onOpenChange(pull, event.currentTarget);
              }}
              type="button"
            />
          )
        }
      />
      <TooltipPopup side="top">
        <span className="grid gap-0.5 py-0.5 text-left">
          <span className="font-medium text-foreground">{bead.title}</span>
          <span className="text-muted-foreground">{bead.line}</span>
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

function SideRow({ side, groupId }: { readonly side: LineSide; readonly groupId: string }) {
  const words = (
    <CutText className="ln-words" text={textOf(side.words)}>
      <Words words={side.words} />
    </CutText>
  );
  return (
    <li className="ln-side">
      {side.projectId === undefined ? (
        words
      ) : (
        <Link
          className="min-w-0 rounded-sm"
          params={{ groupId, projectId: side.projectId }}
          to="/group/$groupId/$projectId"
        >
          {words}
        </Link>
      )}
    </li>
  );
}

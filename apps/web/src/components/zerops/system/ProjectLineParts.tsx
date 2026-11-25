/**
 * What the line's picture and the line in full both draw: a segment's beads, a bead, a segment's
 * count, a line of toned words; and each segment's width as laid out.
 */
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button, InlineButton } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { BeadMark } from "./BeadMark";
import { CutText } from "./ChangeRow";
import {
  fitBeads,
  moreChipWidth,
  type LineBead,
  type LineGroup,
  type LineSegment,
  type LineWord,
} from "./projectLine.logic";

export type OpenLineChange = (pull: FlowPullRequest, from: HTMLElement) => void;
export type ShowLineGroup = ((group: LineGroup) => void) | undefined;

/**
 * Each segment's width as laid out, which says how many beads it has room for: read before the
 * first paint, then whenever the line is resized.
 */
export function useTrackWidths(
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

/** A word's ink: muted unless toned; a name in the ink, its link underlined under the pointer. */
const WORD_TONE: Record<NonNullable<LineWord["tone"]> | "none", string> = {
  none: "",
  danger: "text-destructive-foreground",
  info: "text-info-foreground",
  warning: "text-warning-foreground",
  dim: "text-muted-foreground/72",
};
const STRONG =
  "font-medium text-foreground/82 in-[a:hover]:underline in-[a:hover]:underline-offset-2";

export function Words({ words }: { readonly words: ReadonlyArray<LineWord> }) {
  return (
    <>
      {words.map((word, index) => (
        <span
          className={`${word.mono === true ? "font-mono" : ""} ${word.strong === true ? STRONG : ""} ${WORD_TONE[word.tone ?? "none"]}`}
          // Words keep their order: a line is said whole, never reordered.
          key={`${String(index)}:${word.text}`}
        >
          {word.text}
        </span>
      ))}
    </>
  );
}

export const textOf = (words: ReadonlyArray<LineWord>) => words.map((word) => word.text).join("");

/**
 * A column is a station and the segment after it; the last is production alone. The columns'
 * shares are the board's station offsets; compact, a panel's; on a phone, every station's name
 * reads. The line in full stands on the same columns.
 */
const LINE_COLUMNS: Record<3 | 4, string> = {
  3: "grid-cols-[302fr_310fr_158fr] sm:@max-[700px]/line:grid-cols-[170fr_182fr_100fr] max-sm:grid-cols-[110fr_90fr_88fr]",
  4: "grid-cols-[262fr_160fr_190fr_158fr] sm:@max-[700px]/line:grid-cols-[116fr_108fr_128fr_100fr] max-sm:grid-cols-[84fr_44fr_94fr_74fr]",
};
export const lineColumns = (stations: number) => LINE_COLUMNS[stations === 4 ? 4 : 3];

/** A station's name, cut to its column, clear of the next one's dot. */
export const STATION_NAME =
  "max-w-[calc(100%-18px)] justify-self-start truncate text-body font-semibold text-foreground @max-[700px]/line:max-w-[calc(100%-8px)]";

/** A count's words, or what a station is: caption type cut to its one line. */
export const LINE_WORDS =
  "block h-4 max-w-full min-w-0 truncate text-caption text-muted-foreground";
/** What the line says in full; compact (under 700 px of its own width) its short form instead. */
export const LINE_FULL = "@max-[700px]/line:hidden";
export const LINE_SHORT = "hidden @max-[700px]/line:block";
/** A count's room while the project is read. */
const HELD = "my-1 h-2 rounded-full bg-foreground/8";

/**
 * A station's dot at its column's start, in its state's tone where the line says it (the line in
 * full, a page's masthead); one that runs something ringed, one not live yet a dashed ring.
 */
export function LineNode({
  node,
  tone,
}: {
  readonly node: "solid" | "live" | "absent";
  readonly tone?: "neutral" | "success" | "danger" | "info" | undefined;
}) {
  return (
    <span
      aria-hidden="true"
      className={
        node === "absent"
          ? "absolute top-px -left-px box-border size-3.5 rounded-full border-2 border-dashed border-(--ln-track) bg-(--ln-ground)"
          : node === "live"
            ? NODE_LIVE[tone ?? "neutral"]
            : NODE[tone ?? "neutral"]
      }
    />
  );
}

const NODE: Record<"neutral" | "success" | "danger" | "info", string> = {
  neutral: "absolute top-0.5 left-0 box-border size-3 rounded-full bg-(--ln-track)",
  success: "absolute top-0.5 left-0 box-border size-3 rounded-full bg-success",
  danger: "absolute top-0.5 left-0 box-border size-3 rounded-full bg-destructive",
  info: "absolute top-0.5 left-0 box-border size-3 rounded-full bg-info",
};
const NODE_LIVE: Record<"neutral" | "success" | "danger" | "info", string> = {
  neutral:
    "absolute top-0 -left-0.5 box-border size-4 rounded-full border-3 border-(--ln-ground) bg-(--ln-track) ring-1 ring-(--ln-track)",
  success:
    "absolute top-0 -left-0.5 box-border size-4 rounded-full border-3 border-(--ln-ground) bg-success ring-1 ring-success",
  danger:
    "absolute top-0 -left-0.5 box-border size-4 rounded-full border-3 border-(--ln-ground) bg-destructive ring-1 ring-destructive",
  info: "absolute top-0 -left-0.5 box-border size-4 rounded-full border-3 border-(--ln-ground) bg-info ring-1 ring-info",
};

/** The track from a station's dot to the next one's: solid, dashed where it deploys by itself or leads nowhere yet, blue where a release waits, red where it failed. */
export function LineRail({ track }: { readonly track: LineSegment["track"] }) {
  return <span aria-hidden="true" className={RAIL[track]} />;
}

const RAIL: Record<LineSegment["track"], string> = {
  solid: "absolute top-1.75 -right-1.5 left-1.5 h-0.5 rounded-full bg-(--ln-track)",
  auto: "absolute top-1.75 -right-1.5 left-1.5 h-0 border-t-2 border-dashed border-(--ln-faint)",
  none: "absolute top-1.75 -right-1.5 left-1.5 h-0 border-t-2 border-dashed border-(--ln-faint)",
  ready: "absolute top-1.75 -right-1.5 left-1.5 h-0.5 rounded-full bg-info/62",
  failed: "absolute top-1.75 -right-1.5 left-1.5 h-0.5 rounded-full bg-destructive/52",
};

/**
 * A bead on the track grows under the pointer and the keys; its reach takes in the beads beside it
 * and the track's whole height.
 */
const BEAD_ON_TRACK =
  "transition-transform duration-150 ease-out-strong after:absolute after:-inset-x-[2.5px] after:-inset-y-2 group-hover/bead:scale-125 group-focus-visible/bead:scale-125 motion-reduce:transition-none";
/**
 * One that opens its change is drawn inside its press, which takes the focus; while the change's
 * row in the list is pointed at, it wears a ring in the ink outside its mark's.
 */
const BEAD_PRESSED = `${BEAD_ON_TRACK} cursor-pointer in-data-marked:outline-2 in-data-marked:outline-offset-4 in-data-marked:outline-foreground`;

/**
 * A segment's beads as its width has room for them: past that, a count. `tip`: where a bead's name
 * stands over it (`Bead`).
 */
export function SegmentBeads({
  segment,
  width,
  onOpenChange,
  tip,
}: {
  readonly segment: LineSegment;
  readonly width: number;
  readonly onOpenChange: OpenLineChange;
  readonly tip?: "center" | "end";
}) {
  const fit = fitBeads(segment.beads, segment.more, width);
  return (
    // Beads pack toward the next station, 5 px apart, the last 18 px before its dot; past the room
    // a segment has, how many more.
    <ul
      aria-label={segment.label}
      className="absolute -top-px right-3 flex h-4.5 items-center gap-1.25 *:flex"
    >
      {fit.more === 0 ? null : (
        <li>
          <span
            aria-label={`${String(fit.more)} more`}
            className={moreChipWidth(fit.more) > 28 ? `${MORE} w-8.5` : `${MORE} w-7`}
          >
            +{fit.more}
          </span>
        </li>
      )}
      {fit.beads.map((bead) => (
        <li key={bead.key}>
          <Bead bead={bead} onOpenChange={onOpenChange} tip={tip} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Under a segment: its count. Where it counts a group of the Changes list, the count leads there;
 * compact, its short form — or `compact`, what the line in full says in its place (a verb).
 */
const MORE =
  "block box-border h-4.5 rounded-full bg-(--ln-chip) text-center text-3xs/4.5 font-semibold text-muted-foreground tabular-nums ring-2 ring-(--ln-ground) inset-ring-1 inset-ring-foreground/12";

export function Caption({
  segment,
  onShowGroup,
  compact,
  fullClassName,
}: {
  readonly segment: LineSegment;
  readonly onShowGroup: ShowLineGroup;
  readonly compact?: ReactNode;
  /** The full count's own box, where the line in full gives it more room than one line. */
  readonly fullClassName?: string | undefined;
}) {
  const { group } = segment;
  const leads = (words: ReadonlyArray<LineWord>) =>
    group === undefined || onShowGroup === undefined ? (
      <Words words={words} />
    ) : (
      <InlineButton
        onClick={() => {
          onShowGroup(group);
        }}
        tone="muted"
      >
        {/* One box, so the words keep the spaces between them. */}
        <span>
          <Words words={words} />
        </span>
      </InlineButton>
    );
  return (
    <>
      {segment.caption.length > 0 ? (
        <CutText
          className={`${fullClassName ?? LINE_WORDS} ${LINE_FULL}`}
          text={textOf(segment.caption)}
        >
          {leads(segment.caption)}
        </CutText>
      ) : segment.held ? (
        <span aria-hidden="true" className={`${HELD} w-24 ${LINE_FULL}`} />
      ) : null}
      {compact !== undefined ? (
        <span className={`${LINE_WORDS} ${LINE_SHORT}`}>{compact}</span>
      ) : segment.short.length > 0 ? (
        <span className={`${LINE_WORDS} ${LINE_SHORT}`}>{leads(segment.short)}</span>
      ) : segment.held ? (
        <span aria-hidden="true" className={`${HELD} w-12 ${LINE_SHORT}`} />
      ) : null}
    </>
  );
}

/**
 * One change on the track: its title and "Mate · state" on hover and focus; pressed, its review.
 * It names its change as the change's row in a list does (`data-zerops-change`), so a page that
 * draws both can mark the one from the other. Work that is not a change yet opens nothing. `tip`: `end` ends its name at the bead, over its own
 * segment, where the next station has words above the track (the line in full); default centred.
 */
function Bead({
  bead,
  onOpenChange,
  tip = "center",
}: {
  readonly bead: LineBead;
  readonly onOpenChange: OpenLineChange;
  readonly tip?: "center" | "end" | undefined;
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
              className="group/bead flex rounded-mark focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
              role="img"
              tabIndex={0}
            >
              <BeadMark className={BEAD_ON_TRACK} mark={bead.mark} tint={bead.tint} />
            </span>
          ) : (
            <Button
              aria-label={label}
              className="group/bead"
              data-zerops-change={bead.key}
              onClick={(event) => {
                onOpenChange(pull, event.currentTarget);
              }}
              variant="bare"
            >
              <BeadMark className={BEAD_PRESSED} mark={bead.mark} tint={bead.tint} />
            </Button>
          )
        }
      />
      <TooltipPopup align={tip} side="top">
        <span className="grid gap-0.5 py-0.5 text-left">
          <span className="font-medium text-foreground">{bead.title}</span>
          <span className="text-muted-foreground">{bead.line}</span>
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

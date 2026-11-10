/**
 * What the line's picture and the line in full both draw: a segment's beads, a bead, a segment's
 * count, a line of toned words; and each segment's width as laid out.
 */
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { useLayoutEffect, useRef, useState } from "react";

import { InlineButton } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
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

export function Words({ words }: { readonly words: ReadonlyArray<LineWord> }) {
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

export const textOf = (words: ReadonlyArray<LineWord>) => words.map((word) => word.text).join("");

/** A segment's beads as its width has room for them: past that, a count. */
export function SegmentBeads({
  segment,
  width,
  onOpenChange,
}: {
  readonly segment: LineSegment;
  readonly width: number;
  readonly onOpenChange: OpenLineChange;
}) {
  const fit = fitBeads(segment.beads, segment.more, width);
  return (
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
  );
}

/**
 * Under a segment: its count. Where it counts a group of the Changes list, the count leads there;
 * compact, its short form.
 */
export function Caption({
  segment,
  onShowGroup,
}: {
  readonly segment: LineSegment;
  readonly onShowGroup: ShowLineGroup;
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
        <CutText className="ln-words ln-full" text={textOf(segment.caption)}>
          {leads(segment.caption)}
        </CutText>
      ) : segment.held ? (
        <span aria-hidden="true" className="ln-held ln-full" />
      ) : null}
      {segment.short.length > 0 ? (
        <span className="ln-words ln-short">{leads(segment.short)}</span>
      ) : segment.held ? (
        <span aria-hidden="true" className="ln-held ln-short" />
      ) : null}
    </>
  );
}

/**
 * One change on the track: its title and "Mate · state" on hover and focus; pressed, its review.
 * Work that is not a change yet opens nothing.
 */
export function Bead({
  bead,
  onOpenChange,
}: {
  readonly bead: LineBead;
  readonly onOpenChange: OpenLineChange;
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

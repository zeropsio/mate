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
 * Props: `view` (`projectLine(…)`; `undefined` while the project is unread: the card holds the
 * line's height, nothing drawn); `held`; `onOpenChange(pull, from)` (a bead: the change's review,
 * as its row in the Changes list opens it); `onShowGroup(group)` (a count: the group it counts —
 * without it a count is plain words); `surface` (`panel`: a Mate's panel's own card).
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
  type ProjectLineView,
} from "./projectLine.logic";

export interface ProjectLineProps {
  readonly view: ProjectLineView | undefined;
  /** The project's reads have not answered: the line's shape alone. */
  readonly held?: boolean | undefined;
  readonly onOpenChange: (pull: FlowPullRequest, from: HTMLElement) => void;
  readonly onShowGroup?: ((group: LineGroup) => void) | undefined;
  readonly surface?: "page" | "panel" | undefined;
}

const UNREAD: ProjectLineView = { stations: [], segments: [] };

export function ProjectLine({
  view,
  held = false,
  onOpenChange,
  onShowGroup,
  surface = "page",
}: ProjectLineProps) {
  const { stations, segments } = view ?? UNREAD;
  const [widths, track] = useTrackWidths(segments.length);
  return (
    <div
      aria-busy={held || view === undefined ? true : undefined}
      aria-label="Where each change is"
      className={
        surface === "panel" ? "ln rounded-xl border border-border/70 bg-card" : "pp-card ln"
      }
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
                {held || segment === undefined ? null : (
                  <Caption onShowGroup={onShowGroup} segment={segment} />
                )}
              </div>
            </div>
          );
        })}
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
          data-tone={word.tone}
          // Words keep their order: a caption is said whole, never reordered.
          key={`${String(index)}:${word.text}`}
        >
          {word.text}
        </span>
      ))}
    </>
  );
}

const textOf = (words: ReadonlyArray<LineWord>) => words.map((word) => word.text).join("");

/**
 * Under a segment: its count. Where it counts a group of the Changes list, the count leads there;
 * compact, its short form.
 */
function Caption({
  segment,
  onShowGroup,
}: {
  readonly segment: LineSegment;
  readonly onShowGroup: ProjectLineProps["onShowGroup"];
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

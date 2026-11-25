/**
 * A Mate's row, the drawing of a Mate on its project's overview card: its face, its
 * name (a press opens its conversation), its time with the menu's dot, and its second line in the
 * menu row's own words (`cardMateReading`). Where it waits on the viewer it is lifted, its verbs
 * under its line. On its project's own page a Mate is a card (`MateCard`), from the same props.
 */
import type { MatePart } from "@t3tools/client-runtime/zerops/mateParts";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { InlineButton } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { MateDot } from "../MateDot";
import { drawn } from "../projects/flowSteps";
import type { CardMateReading } from "../projects/projectCard.logic";

/**
 * Props: `name`; `face` (its `MateFace`, 32 px on a card); `time` (the right of its name: a
 * `MateRowTime`); `reading` (`cardMateReading(…)`: its line, tone and lift); `parts` (its preview
 * chips, `mateParts`); `line` (drawn in place of the words); `onOpen` (opens its conversation;
 * `undefined` where it cannot open yet); `actions` (its verbs while lifted, `CardMateLiftActions`);
 * `mark` (after its name, `MateAutomatedMark`). Renders `role="listitem"`: put it in a list.
 */
export interface MateRowProps {
  readonly name: string;
  /** Its face, 32 px, with whose it is on its corner. */
  readonly face: ReactNode;
  /** The right of its name: its time, its dot. */
  readonly time: ReactNode;
  readonly reading: CardMateReading;
  /**
   * Its parts (`mateParts`), each a chip on its name's line by its real hostname: a door to its
   * preview, or to its dev where it has no preview, or muted with why where it has neither.
   */
  readonly parts?: ReadonlyArray<MatePart> | undefined;
  /** Drawn in place of the words where its container has something else to say. */
  readonly line?: ReactNode;
  /** Opens its conversation; `undefined` where it cannot open yet. */
  readonly onOpen: (() => void) | undefined;
  /** Its verbs while lifted (`CardMateLiftActions`), or a verb its container needs (Start). */
  readonly actions?: ReactNode;
  /** The mark after its name: an automated Mate's (`MateAutomatedMark`); absent, none. */
  readonly mark?: ReactNode;
}

/**
 * A Mate on a card: a 32 px face, its name and time, its second line. What waits on the viewer is
 * lifted onto a white card, its line in ink over two lines, its buttons under it.
 */
export function MateRow({
  name,
  face,
  time,
  reading,
  parts = [],
  line,
  onOpen,
  actions,
  mark,
}: MateRowProps) {
  const lifted = reading.lift !== undefined;
  return (
    <div
      className={cn(
        MATE,
        lifted ? "bg-foreground/4 shadow-edge" : "has-[[data-ov-mate-open]:hover]:bg-item-hover",
      )}
      data-lift={lifted ? reading.lift?.kind : undefined}
      data-zerops-surface="card-mate"
      role="listitem"
    >
      <span className="relative flex h-8">{face}</span>
      <span className="flex min-w-0 flex-col">
        <span className={LINE_ONE}>
          {onOpen === undefined ? (
            <span className={NAME}>{name}</span>
          ) : (
            <span className={NAME}>
              {/* The name opens the Mate: its press spans the row, under the row's own presses. */}
              <InlineButton
                aria-label={`Open ${name}`}
                className="max-w-full after:absolute after:inset-0"
                data-ov-mate-open=""
                onClick={onOpen}
                tone="plain"
              >
                <span className="truncate">{name}</span>
              </InlineButton>
            </span>
          )}
          {mark}
          {parts.length === 0 ? null : (
            // Its parts between its name and its time: they wrap onto further lines inside the
            // card, so neither the name nor the time gives way.
            <span
              className="flex min-w-0 flex-1 basis-0 flex-wrap gap-x-1.5 text-caption leading-4"
              data-zerops-surface="card-mate-parts"
            >
              {parts.map((part) => (
                <MateRowPart key={part.key} mate={name} part={part} />
              ))}
            </span>
          )}
          <span className="ms-auto inline-flex flex-none items-center gap-1.5 ps-2.5 text-caption leading-4.5 whitespace-nowrap text-muted-foreground tabular-nums">
            {time}
          </span>
        </span>
        {/* Cut at the card's edge, its whole is the row's press away: its conversation. */}
        <span className={lineTwo(reading.tone, lifted)}>{line ?? reading.text}</span>
        {drawn(actions) ? (
          <span className="relative z-1 mt-3 flex flex-wrap gap-1.5">{actions}</span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * A Mate still being created, on an overview card's row: its face asleep, its name, one statement
 * of how far its setup has got — amber where it stopped — and its ⋯ at the row's end. The row opens
 * the birth's own page, which says why and who can continue. On its project's page it is a card
 * (`ComingMateCard`).
 *
 * Props: `name`; `face` (`ComingMateFace`); `line`; `stopped`; `onOpen` (its own page; `undefined`
 * where it has none yet); `menu` (its ⋯). Renders `role="listitem"`: put it in a list.
 */
export function ComingMateRow({
  name,
  face,
  line,
  stopped = false,
  onOpen,
  menu,
}: {
  readonly name: string;
  readonly face: ReactNode;
  readonly line: string;
  readonly stopped?: boolean;
  readonly onOpen?: (() => void) | undefined;
  readonly menu?: ReactNode;
}) {
  return (
    <div
      // Under way it is busy; stopped, nothing is coming until someone continues it.
      aria-busy={stopped ? undefined : true}
      className={cn(MATE, "has-[[data-ov-mate-open]:hover]:bg-item-hover")}
      data-zerops-surface="mate-coming"
      role="listitem"
    >
      <span className="relative flex h-8">{face}</span>
      <span className="flex min-w-0 flex-col">
        <span className={LINE_ONE}>
          {onOpen === undefined ? (
            <span className={NAME}>{name}</span>
          ) : (
            <span className={NAME}>
              {/* The name opens the Mate: its press spans the row, under the row's own presses. */}
              <InlineButton
                aria-label={`Open ${name}`}
                className="max-w-full after:absolute after:inset-0"
                data-ov-mate-open=""
                onClick={onOpen}
                tone="plain"
              >
                <span className="truncate">{name}</span>
              </InlineButton>
            </span>
          )}
        </span>
        <span className={lineTwo(stopped ? "attention" : undefined, false)}>{line}</span>
      </span>
      {/* A row's end, past its words: its ⋯, a column of its own only here. */}
      {drawn(menu) ? (
        <span className="relative z-1 col-start-3 row-start-1 flex items-center self-center">
          {menu}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A part's chip on a Mate's row: a door to its preview, else to its dev, by that service's real
 * hostname; muted, with why in its title, where it has neither address.
 */
function MateRowPart({ mate, part }: { readonly mate: string; readonly part: MatePart }) {
  const door =
    part.preview?.url === undefined
      ? part.dev.find((entry) => entry.url !== undefined)
      : part.preview;
  const url = door?.url;
  const service = door?.service ?? part.preview?.service ?? part.devService;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          url === undefined ? (
            <span className="relative z-1 inline-flex h-5.5 flex-none cursor-default items-center gap-px rounded-control px-1 text-caption leading-4 text-muted-foreground/60" />
          ) : (
            <InlineButton
              aria-label={`Open ${mate}'s ${service}`}
              className="relative z-1 h-5.5"
              render={<a href={url} rel="noreferrer" target="_blank" />}
              tone="muted"
            />
          )
        }
      >
        {service}
        {url === undefined ? null : <ArrowUpRightIcon aria-hidden="true" className="size-3" />}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {url === undefined ? (part.preview?.why ?? "no address yet") : door?.host}
      </TooltipPopup>
    </Tooltip>
  );
}

/** The right of a Mate's name: the dot before its time (amber needs you, blue unseen, red broken). */
export function MateRowTime({
  dot,
  children,
}: {
  readonly dot: "attention" | "unread" | "failed" | undefined;
  readonly children: ReactNode;
}) {
  return (
    <>
      {dot === undefined ? null : <MateDot place="inline" tone={dot} />}
      <span data-zerops-surface="card-mate-time">{children}</span>
    </>
  );
}

/** A Mate on a card: its face, its name and time, its line; what waits on you lifted. */
const MATE =
  "relative grid grid-cols-[32px_minmax(0,1fr)] items-start gap-x-3 rounded-card px-1.5 py-2 transition-[background-color,box-shadow] duration-200 ease-out-strong motion-reduce:transition-opacity";
const LINE_ONE = "flex min-h-5.5 min-w-0 items-start gap-1.5";
/** The name keeps its own width, up to most of the line: parts wrap beside it, never over it. */
const NAME =
  "max-w-[65%] min-w-0 flex-none truncate text-left text-emphasis leading-5.5 font-medium";

/**
 * What was asked, over the answer: the menu row's second ink, cut at the card's edge; lifted, two
 * lines. A line that holds a change holds its Review, whose outline is drawn outside its box: the
 * line must not cut it.
 */
function lineTwo(tone: CardMateReading["tone"] | "attention" | undefined, wraps: boolean): string {
  return cn(
    "mt-px block min-h-5 min-w-0 text-body leading-5 has-[>[data-zerops-surface=card-mate-change]]:overflow-visible",
    wraps ? "line-clamp-2 text-pretty" : "truncate",
    tone === "ink"
      ? "text-foreground"
      : tone === "failed"
        ? "text-status-failed-text"
        : tone === "attention"
          ? "text-status-attention-text"
          : "text-muted-foreground",
  );
}

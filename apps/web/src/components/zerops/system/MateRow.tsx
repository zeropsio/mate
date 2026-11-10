/**
 * A Mate's row, the drawing of a Mate on its project's overview card: its face, its
 * name (a press opens its conversation), its time with the menu's dot, and its second line in the
 * menu row's own words (`cardMateReading`). Where it waits on the viewer it is lifted, its verbs
 * under its line. On its project's own page a Mate is a card (`MateCard`), from the same props.
 */
import type { MatePart } from "@t3tools/client-runtime/zerops/mateParts";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
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
      className="ov-mate"
      data-lift={lifted ? reading.lift?.kind : undefined}
      data-zerops-surface="card-mate"
      role="listitem"
    >
      <span className="ov-mate-face">{face}</span>
      <span className="ov-mate-text">
        <span className="ov-mate-l1">
          {onOpen === undefined ? (
            <span className="ov-mate-name">{name}</span>
          ) : (
            <button
              aria-label={`Open ${name}`}
              className="ov-mate-name ov-mate-open"
              onClick={onOpen}
              type="button"
            >
              {name}
            </button>
          )}
          {mark}
          {parts.length === 0 ? null : (
            <span className="ov-mate-parts" data-zerops-surface="card-mate-parts">
              {parts.map((part) => (
                <MateRowPart key={part.key} mate={name} part={part} />
              ))}
            </span>
          )}
          <span className="ov-mate-time">{time}</span>
        </span>
        {/* Cut at the card's edge, its whole is the row's press away: its conversation. */}
        <span
          className="ov-mate-l2"
          data-tone={reading.tone}
          data-wrap={lifted ? "true" : undefined}
        >
          {line ?? reading.text}
        </span>
        {drawn(actions) ? <span className="ov-acts">{actions}</span> : null}
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
      className="ov-mate"
      data-zerops-surface="mate-coming"
      role="listitem"
    >
      <span className="ov-mate-face">{face}</span>
      <span className="ov-mate-text">
        <span className="ov-mate-l1">
          {onOpen === undefined ? (
            <span className="ov-mate-name">{name}</span>
          ) : (
            <button
              aria-label={`Open ${name}`}
              className="ov-mate-name ov-mate-open"
              onClick={onOpen}
              type="button"
            >
              {name}
            </button>
          )}
        </span>
        <span className="ov-mate-l2" data-tone={stopped ? "attention" : undefined}>
          {line}
        </span>
      </span>
      {drawn(menu) ? <span className="ov-mate-end">{menu}</span> : null}
    </div>
  );
}

/**
 * A part's chip on a Mate's row: a door to its preview, else to its dev, by that service's real
 * hostname; muted, with why in its title, where it has neither address.
 */
export function MateRowPart({ mate, part }: { readonly mate: string; readonly part: MatePart }) {
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
            <span className="ov-mate-preview" data-off="" />
          ) : (
            <a
              aria-label={`Open ${mate}'s ${service}`}
              className="ov-mate-preview"
              href={url}
              rel="noreferrer"
              target="_blank"
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

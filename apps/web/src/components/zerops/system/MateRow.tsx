/**
 * A Mate's row, the one drawing of a Mate on the overview card and the project page: its face, its
 * name (a press opens its conversation), its time with the menu's dot, and its second line in the
 * menu row's own words (`cardMateReading`). Where it waits on the viewer it is lifted, its verbs
 * under its line. In a page's list (`PageRows`) its time stands after its name, and a row that
 * opens ends in a chevron while it is pointed at or focused.
 */
import type { MatePart } from "@t3tools/client-runtime/zerops/mateParts";
import { ArrowUpRightIcon, ChevronRightIcon } from "lucide-react";
import { use, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { MateDot } from "../MateDot";
import { drawn } from "../projects/flowSteps";
import type { CardMateReading } from "../projects/projectCard.logic";
import { PageRows } from "./pageRows";

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
  const page = use(PageRows);
  return (
    <div
      className="ov-mate"
      data-lift={lifted ? reading.lift?.kind : undefined}
      data-page={page ? "" : undefined}
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
      {page && onOpen !== undefined ? (
        <span className="ov-mate-end">
          <ChevronRightIcon aria-hidden="true" className="ov-go" />
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

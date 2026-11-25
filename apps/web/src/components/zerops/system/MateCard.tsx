/**
 * A Mate on its project's own page: a card in a grid, drawn as Settings › Team draws a person
 * (`FaceCard`). Top to bottom it says who (its face, large and centred, carrying its state; its
 * name), what (its one reading, two lines tall whatever it holds; a change of its that waits for
 * review, as a line of state and never a button: the page's Changes list has the change and its
 * verb), and at its foot, under a hairline, the two doors every place has: Sites and Vault
 * (`PlaceDoors`). When it last moved stands in its corner. The whole card opens its conversation;
 * what stands in its foot is a press of its own.
 *
 * The owner, 2026-11-10, on the first cut (previews as two bare links, a Review button beside the
 * second, an arrow in the corner): "why not have the sites and vault quick link also … and the
 * review done properly, if its even needed on top of some state indicator, given the review
 * requests are in the section below"; "dont think the mate card needs the top right arrow".
 */
import { GitPullRequestIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { drawn } from "../projects/flowSteps";
import { FaceCard, FaceCardLine, FaceCards } from "./FaceCard";
import type { MateRowProps } from "./MateRow";

/** The grid of a project's Mates: `MateCard`s, `ComingMateCard`s, then its `AddMateCard`. */
export function MateCards({ children }: { readonly children: ReactNode }) {
  return (
    <FaceCards label="Mates" phone="lying">
      {children}
    </FaceCards>
  );
}

/** Changes of a Mate's that wait for review: how many, and whether on the viewer. */
interface MateCardChanges {
  readonly count: number;
  readonly mine: boolean;
  /**
   * Its line where the change is not the viewer's to review (`changeStanding`): "1 change ready",
   * "Waiting for Ada K. or Sam R.", "Dana L. asks to merge". Absent: `changesWaitLine`.
   */
  readonly says?: string | undefined;
}

/** How a card says its changes wait: the page's list names them. */
function changesWaitLine(count: number): string {
  return count === 1 ? "1 change to review" : `${count} changes to review`;
}

/** The same to a person who cannot merge them: ready, for their ask to merge. */
export function changesReadyLine(count: number): string {
  return count === 1 ? "1 change ready" : `${count} changes ready`;
}

/**
 * Props: `MateRowProps` less its previews (they are behind its Sites door), with `face` at 64 px;
 * `doors` (its `PlaceDoors`, `look="card"`); `changes` (its changes that wait for review, where
 * its reading does not already say so). Its lines are two lines tall whatever they say and its
 * foot keeps its seat, so no state of the Mate changes the card's height.
 */
export function MateCard({
  name,
  face,
  time,
  reading,
  line,
  onOpen,
  actions,
  mark,
  doors,
  changes,
}: Omit<MateRowProps, "parts"> & {
  readonly doors?: ReactNode;
  readonly changes?: MateCardChanges | undefined;
}) {
  const footed = drawn(doors) || drawn(actions);
  return (
    <li className="grid">
      <FaceCard
        data-lift={reading.lift?.kind}
        data-zerops-surface="card-mate"
        figure={face}
        foot={
          footed ? (
            // Its doors, then a verb only it has (Start, an answer it waits for).
            <span className={FOOT}>
              {doors}
              {actions}
            </span>
          ) : null
        }
        footHeld
        press={onOpen === undefined ? undefined : <Button onClick={onOpen} variant="bare" />}
        rest="middle"
        ruled
        stamp={time}
        title={
          // Its name with its mark after it: the name gives way, the mark never.
          <span className="inline-flex max-w-full items-center gap-1.5 align-top">
            <span className="min-w-0 truncate">{name}</span>
            {mark}
          </span>
        }
      >
        {changes === undefined ? (
          // Cut after two lines, its whole is the card's press away: its conversation.
          <FaceCardLine lines={2} tone={reading.tone}>
            {line ?? reading.text}
          </FaceCardLine>
        ) : (
          // Two facts, a line each: what it says, then that a change of its waits.
          <span className="grid h-9 max-w-full min-w-0 justify-items-center">
            <FaceCardLine tone={reading.tone}>{line ?? reading.text}</FaceCardLine>
            <FaceCardLine
              data-zerops-surface="card-mate-changes"
              tone={changes.mine ? "ink" : undefined}
            >
              <span>
                <GitPullRequestIcon
                  aria-hidden="true"
                  className="relative top-0.5 me-1 inline-block size-3.5"
                />
                {changes.says ?? changesWaitLine(changes.count)}
              </span>
            </FaceCardLine>
          </span>
        )}
      </FaceCard>
    </li>
  );
}

/**
 * A Mate still being created, as a card: its face asleep, its name, one statement of how far its
 * setup has got — amber where it stopped — and its ⋯ at its foot. The card opens the birth's own
 * page, which says why and who can continue.
 *
 * Props: `name`; `face` (`ComingMateFace`, 64 px); `line`; `stopped`; `onOpen` (its own page;
 * `undefined` where it has none yet); `menu` (its ⋯).
 */
export function ComingMateCard({
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
    // Under way it is busy; stopped, nothing is coming until someone continues it.
    <li aria-busy={stopped ? undefined : true} className="grid">
      <FaceCard
        data-zerops-surface="mate-coming"
        figure={face}
        foot={drawn(menu) ? <span className={FOOT}>{menu}</span> : null}
        footHeld
        press={onOpen === undefined ? undefined : <Button onClick={onOpen} variant="bare" />}
        rest="middle"
        ruled
        title={name}
      >
        <FaceCardLine lines={2} tone={stopped ? "attention" : undefined}>
          {line}
        </FaceCardLine>
      </FaceCard>
    </li>
  );
}

/**
 * The grid's last cell: the one door that adds a Mate to the project, a dashed card in the look of
 * the page's empty setup cards: its mark, its words and its one line as one group in the card's
 * middle. Standing off, it says why in its line. `alone`: no Mate yet, so it is the whole section,
 * as wide as the column.
 *
 * Props: `onAdd`; `why` (why the project takes no Mate now; `null` while it does); `line` (its one
 * quiet line); `alone`.
 */
export function AddMateCard({
  onAdd,
  why,
  line,
  alone = false,
}: {
  readonly onAdd: () => void;
  readonly why: string | null;
  readonly line: string;
  readonly alone?: boolean;
}) {
  const lying =
    "max-sm:grid-cols-[48px_minmax(0,1fr)] max-sm:justify-items-start max-sm:gap-x-3 max-sm:gap-y-0 max-sm:pt-3 max-sm:pe-9 max-sm:pb-3 max-sm:ps-3 max-sm:text-start max-sm:*:col-start-2";
  return (
    <li className={cn("grid", alone && "col-span-full")}>
      <Button
        className="group/add grid"
        data-zerops-surface="add-mate"
        disabled={why !== null}
        onClick={onAdd}
        variant="bare"
      >
        <span className="relative flex min-w-0 flex-col rounded-card text-center outline-1 -outline-offset-1 outline-foreground/16 outline-dashed transition-colors duration-150 ease-out-strong group-enabled/add:group-hover/add:bg-foreground/4 max-sm:text-start">
          <span
            className={cn(
              "grid min-w-0 flex-1 content-center justify-items-center gap-1 rounded-card px-4 pt-6.5 pb-5.5",
              lying,
            )}
          >
            <span
              aria-hidden="true"
              className="mb-2 flex size-10 items-center justify-center rounded-full bg-foreground/4 text-muted-foreground group-disabled/add:opacity-55 *:size-5 max-sm:size-12"
            >
              <PlusIcon />
            </span>
            <span className="max-w-full truncate text-emphasis leading-5 font-medium text-foreground group-disabled/add:opacity-55">
              Add a Mate
            </span>
            <span className="max-w-full overflow-hidden text-body leading-4.5 text-balance text-ellipsis text-muted-foreground">
              {why ?? line}
            </span>
          </span>
        </span>
      </Button>
    </li>
  );
}

/** A card's foot: its doors, then a verb only it has, centred on one line while they fit. */
const FOOT = "flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 max-sm:justify-start";

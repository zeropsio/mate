/**
 * A Mate on its project's own page: a card in a grid, drawn as Settings › Team draws a person
 * (`FaceCard`) — its face large and centred, its name, when it last moved, its one line, and at its
 * foot its previews and its verb. It says exactly what its row says (`MateRow`, the same props):
 * the same words, the same tones, the same presses. The whole card opens its conversation; what
 * stands in its foot is a press of its own.
 */
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { drawn } from "../projects/flowSteps";
import { FaceCard, FaceCardLine, FaceCards } from "./FaceCard";
import { MateRowPart, type MateRowProps } from "./MateRow";

/** Where a card leads, in its corner: said at rest, not only under the pointer. */
const LEADS = <ChevronRightIcon />;

/** The grid of a project's Mates: `MateCard`s, `ComingMateCard`s, then its `AddMateCard`. */
export function MateCards({ children }: { readonly children: ReactNode }) {
  return <FaceCards label="Mates">{children}</FaceCards>;
}

/**
 * Props: `MateRowProps`, with `face` at 64 px. Its line is two lines tall whatever it says and its
 * foot keeps its seat, so no state of the Mate changes the card's height.
 */
export function MateCard({
  name,
  face,
  time,
  reading,
  parts = NO_PARTS,
  line,
  onOpen,
  actions,
  mark,
}: MateRowProps) {
  return (
    <li className="grid">
      <FaceCard
        corner={onOpen === undefined ? undefined : LEADS}
        data-lift={reading.lift?.kind}
        data-zerops-surface="card-mate"
        figure={face}
        foot={
          parts.length === 0 && !drawn(actions) ? null : (
            // One line while it fits: its previews, then its verb.
            <span className="mc-foot">
              {parts.length === 0 ? null : (
                <span className="ov-mate-parts" data-zerops-surface="card-mate-parts">
                  {parts.map((part) => (
                    <MateRowPart key={part.key} mate={name} part={part} />
                  ))}
                </span>
              )}
              {actions}
            </span>
          )
        }
        footHeld
        press={onOpen === undefined ? undefined : <button onClick={onOpen} type="button" />}
        rest="middle"
        title={
          <span className="mc-name">
            <span>{name}</span>
            {mark}
          </span>
        }
      >
        <span className="mc-time">{time}</span>
        {/* Cut after two lines, its whole is the card's press away: its conversation. */}
        <FaceCardLine lines={2} tone={reading.tone}>
          {line ?? reading.text}
        </FaceCardLine>
      </FaceCard>
    </li>
  );
}

const NO_PARTS: ReadonlyArray<never> = [];

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
        corner={onOpen === undefined ? undefined : LEADS}
        data-zerops-surface="mate-coming"
        figure={face}
        foot={drawn(menu) ? <span className="mc-foot">{menu}</span> : null}
        footHeld
        press={onOpen === undefined ? undefined : <button onClick={onOpen} type="button" />}
        rest="middle"
        title={name}
      >
        <span className="mc-time" />
        <FaceCardLine lines={2} tone={stopped ? "attention" : undefined}>
          {line}
        </FaceCardLine>
      </FaceCard>
    </li>
  );
}

/**
 * The grid's last cell: the one door that adds a Mate to the project, a dashed card in the look of
 * the page's empty setup cards. Standing off, it says why in its line. `alone`: no Mate yet, so it
 * is the whole section, as wide as the column.
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
  return (
    <li className="grid" data-alone={alone || undefined}>
      <button
        className="tm-card mc-add"
        data-zerops-surface="add-mate"
        disabled={why !== null}
        onClick={onAdd}
        type="button"
      >
        <span className="tm-card-body">
          <span aria-hidden="true" className="tm-card-face mc-add-mark">
            <PlusIcon />
          </span>
          <span className="tm-card-name">Add a Mate</span>
          <FaceCardLine lines={2}>{why ?? line}</FaceCardLine>
        </span>
      </button>
    </li>
  );
}

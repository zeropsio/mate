/**
 * A Mate's face, being picked: the face its colour and its shape make, big, beside a row of the
 * eight colours and a row of the eight shapes, under whatever else the form asks first (a new
 * Mate's name). The one picker wherever a face is picked: *New Mate*, the New project wizard's
 * first Mate, and *Change face…* in a Mate's menus.
 *
 * The face beside what makes it; on a phone, over it. Each row is a radio group of real buttons,
 * one Tab stop per row (the picked one), the arrow keys walking the row and picking as they go.
 * The picked one wears a ring of its tint a gap out, so nothing changes size.
 */
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import {
  MATE_SHAPE_IDS,
  MATE_SHAPES,
  MATE_TINT_IDS,
  type MateShapeId,
  type MateTintId,
} from "@t3tools/shared/brand";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { MateFace } from "./primitives";

/** The colours and the shapes by the words a screen reader says for them. */
const TINT_WORDS: Record<MateTintId, string> = {
  coral: "Coral",
  amber: "Amber",
  olive: "Olive",
  sky: "Sky",
  violet: "Violet",
  rose: "Rose",
  sand: "Sand",
  slate: "Slate",
};

const SHAPE_WORDS: Record<MateShapeId, string> = {
  squircle: "Squircle",
  gem: "Gem",
  hexagon: "Hexagon",
  pentagon: "Pentagon",
  clover: "Clover",
  flower: "Flower",
  seal: "Seal",
  pick: "Guitar pick",
};

/** A tint as the stylesheet reads it: the palette's own token, so both themes hold. */
function tintStyle(tint: MateTintId): CSSProperties {
  return { "--mate-face-tint": `var(--zerops-mate-tint-${tint})` } as CSSProperties;
}

export function MateFacePicker({
  face,
  onPickTint,
  onPickShape,
  compact = false,
  children,
}: {
  /** The face the picks make now. */
  readonly face: ZeropsMateFace;
  readonly onPickTint: (tint: MateTintId) => void;
  readonly onPickShape: (shape: MateShapeId) => void;
  /**
   * The face at 72 px rather than 112: a New project's first Mate, under the project's name,
   * which is what that dialog asks first (board D1).
   */
  readonly compact?: boolean;
  /** What the form asks before the face: a new Mate's name. */
  readonly children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center max-sm:flex-col max-sm:gap-4",
        compact ? "gap-4.5" : "gap-6",
      )}
    >
      <FacePreview className={compact ? "size-18" : "size-28"} face={face} />
      <div className="flex w-full min-w-0 flex-1 flex-col gap-3.5">
        {children}
        <div className="flex flex-col gap-0.5">
          <PickerRow
            label="Color"
            onPick={onPickTint}
            optionStyle={tintStyle}
            options={MATE_TINT_IDS}
            value={face.tint}
            words={TINT_WORDS}
          >
            {() => (
              <>
                <circle className="mate-face-ring" cx="18" cy="18" r="15.5" />
                <circle className="mate-face-mark" cx="18" cy="18" r="12" />
              </>
            )}
          </PickerRow>
          <PickerRow
            label="Shape"
            onPick={onPickShape}
            optionStyle={() => tintStyle(face.tint)}
            options={MATE_SHAPE_IDS}
            value={face.shape}
            words={SHAPE_WORDS}
          >
            {(shape) => (
              <>
                {/* Its own outline a gap out: the ring runs parallel to every shape. */}
                <path
                  className="mate-face-ring"
                  d={MATE_SHAPES[shape].d}
                  transform="translate(1 1) scale(0.34)"
                />
                <path
                  className="mate-face-mark"
                  d={MATE_SHAPES[shape].d}
                  transform="translate(5 5) scale(0.26)"
                />
              </>
            )}
          </PickerRow>
        </div>
      </div>
    </div>
  );
}

/**
 * One row of a face's pickers: a radio group of real buttons. One stop for Tab — the one picked —
 * and the arrow keys walk the row, picking as they go, as a radio group does. Kept by hand rather
 * than a kit's roving focus, whose stop stays where it started when the pick changes from outside
 * the row: in *New Mate* the shape follows the colour until one is picked, and the colour follows
 * the name.
 */
function PickerRow<T extends string>({
  label,
  options,
  value,
  words,
  optionStyle,
  onPick,
  children,
}: {
  readonly label: string;
  readonly options: ReadonlyArray<T>;
  readonly value: T;
  readonly words: Readonly<Record<T, string>>;
  /** The tint an option is drawn in. */
  readonly optionStyle: (option: T) => CSSProperties;
  readonly onPick: (option: T) => void;
  /** An option's mark and its ring, in a 36 px box. */
  readonly children: (option: T) => ReactNode;
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const step = (from: T, by: number) => {
    const next = options[(options.indexOf(from) + by + options.length) % options.length];
    if (next === undefined) return;
    onPick(next);
    buttons.current.get(next)?.focus();
  };
  return (
    <div aria-label={label} className="flex justify-between" role="radiogroup">
      {options.map((option) => (
        <button
          aria-checked={option === value}
          aria-label={words[option]}
          className="mate-face-option focus-visible:ring-2 focus-visible:ring-ring"
          data-checked={option === value ? "" : undefined}
          key={option}
          onClick={() => {
            onPick(option);
          }}
          onKeyDown={(event) => {
            const by = ARROW_STEPS[event.key];
            if (by === undefined) return;
            event.preventDefault();
            step(option, by);
          }}
          ref={(node) => {
            if (node === null) buttons.current.delete(option);
            else buttons.current.set(option, node);
          }}
          role="radio"
          style={optionStyle(option)}
          tabIndex={option === value ? 0 : -1}
          type="button"
        >
          <svg aria-hidden="true" className="size-9" viewBox="0 0 36 36">
            {children(option)}
          </svg>
        </button>
      ))}
    </div>
  );
}

const ARROW_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * The face being picked, as its hero. A change crossfades: the face before fades out under the
 * new one, which settles from a touch smaller — so a colour or a shape picked, or a name typed,
 * reads as the same somebody turning into someone else rather than a picture swapped. The first
 * paint is still, and reduced motion keeps only the fade.
 */
function FacePreview({
  face,
  className,
}: {
  readonly face: ZeropsMateFace;
  /** Its size. */
  readonly className: string;
}) {
  const [shown, setShown] = useState<{
    readonly face: ZeropsMateFace;
    readonly before: ZeropsMateFace | undefined;
    readonly turn: number;
  }>({ face, before: undefined, turn: 0 });
  if (shown.face.tint !== face.tint || shown.face.shape !== face.shape) {
    setShown({ face, before: shown.face, turn: shown.turn + 1 });
  }
  return (
    <span className="mate-face-preview" data-zerops-surface="mate-face-preview">
      {shown.before === undefined ? null : (
        <MateFace
          className={className}
          data-mate-face-preview="out"
          key={`out-${shown.turn}`}
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            setShown((current) =>
              current.turn === shown.turn ? { ...current, before: undefined } : current,
            );
          }}
          shape={shown.before.shape}
          size="lg"
          state="idle"
          tint={shown.before.tint}
        />
      )}
      <MateFace
        className={className}
        data-mate-face-preview={shown.turn === 0 ? undefined : "in"}
        key={`in-${shown.turn}`}
        shape={shown.face.shape}
        size="lg"
        state="idle"
        tint={shown.face.tint}
      />
    </span>
  );
}

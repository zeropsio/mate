/**
 * A Mate's face, being picked: the face its colour and its shape make, big, beside a row of the
 * eight colours and a row of the eight shapes, under whatever else the form asks first (a new
 * Mate's name) — or, folded, a small face, the name and *Change look* — or, apart, the rows alone,
 * the face standing elsewhere as its page's hero (`MateFacePreview`) — or, as a ring, the colours
 * and the shapes opened out around the face (`MateFaceRing`, New project's Mate step). The one
 * picker wherever a face is picked: *New Mate*, New project's first Mate, an account's first run,
 * and *Change face…* in a Mate's menus.
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
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { Button } from "../ui/button";
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

/** A colour's option: a dot, and its ring a gap out. */
function tintMark() {
  return (
    <>
      <circle className="mate-face-ring" cx="18" cy="18" r="15.5" />
      <circle className="mate-face-mark" cx="18" cy="18" r="12" />
    </>
  );
}

/** A shape's option: the shape, and its own outline a gap out, parallel to every shape. */
function shapeMark(shape: MateShapeId) {
  return (
    <>
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
  );
}

/**
 * Where an option of a ring stands, as an angle clockwise from the top: the colours down the
 * left, the shapes down the right, each arc 140° with the top and the bottom left open.
 */
function ringAngle(side: "left" | "right", index: number, count: number): number {
  const step = 140 / (count - 1);
  return side === "left" ? 340 - index * step : 20 + index * step;
}

/**
 * The face as its page's hero, with its colours and shapes as a ring around it (the owner,
 * 2026-11-23): shut, the face alone, large; open, the face a touch smaller and the options
 * coming out from its middle to their places, the colours down the left and the shapes down the
 * right; shutting, they go back into the middle and fade. Shut, the options are inert.
 */
export function MateFaceRing({
  face,
  open,
  onPickTint,
  onPickShape,
}: {
  readonly face: ZeropsMateFace;
  readonly open: boolean;
  readonly onPickTint: (tint: MateTintId) => void;
  readonly onPickShape: (shape: MateShapeId) => void;
}) {
  return (
    <div className="mate-face-ring-stage" data-open={open ? "" : undefined}>
      <span className="mate-face-ring-face">
        <MateFacePreview className="mate-face-ring-hero" face={face} tracks />
      </span>
      <div className="mate-face-ring-options" inert={!open}>
        <PickerRow
          className="contents"
          label="Color"
          onPick={onPickTint}
          optionStyle={tintStyle}
          options={MATE_TINT_IDS}
          place={(index) => ringPlace(ringAngle("left", index, MATE_TINT_IDS.length), index)}
          value={face.tint}
          words={TINT_WORDS}
        >
          {tintMark}
        </PickerRow>
        <PickerRow
          className="contents"
          label="Shape"
          onPick={onPickShape}
          optionStyle={() => tintStyle(face.tint)}
          options={MATE_SHAPE_IDS}
          place={(index) => ringPlace(ringAngle("right", index, MATE_SHAPE_IDS.length), index)}
          value={face.shape}
          words={SHAPE_WORDS}
        >
          {shapeMark}
        </PickerRow>
      </div>
    </div>
  );
}

/** An option's place on the ring, and its turn as the ring opens. */
function ringPlace(angle: number, index: number): CSSProperties {
  return { "--ring-angle": `${angle}deg`, "--ring-turn": index } as CSSProperties;
}

export function MateFacePicker({
  face,
  onPickTint,
  onPickShape,
  folded = false,
  apart = false,
  children,
}: {
  /** The face the picks make now. */
  readonly face: ZeropsMateFace;
  readonly onPickTint: (tint: MateTintId) => void;
  readonly onPickShape: (shape: MateShapeId) => void;
  /**
   * One row — the face small, the name, *Change look* — with the colours and the shapes in a
   * panel over what follows, so opening them moves nothing.
   */
  readonly folded?: boolean;
  /** The rows alone, under what the form asks first: the face is drawn elsewhere, larger. */
  readonly apart?: boolean;
  /** What the form asks before the face: a new Mate's name. */
  readonly children?: ReactNode;
}) {
  const rows = (
    <>
      <PickerRow
        label="Color"
        onPick={onPickTint}
        optionStyle={tintStyle}
        options={MATE_TINT_IDS}
        value={face.tint}
        words={TINT_WORDS}
      >
        {tintMark}
      </PickerRow>
      <PickerRow
        label="Shape"
        onPick={onPickShape}
        optionStyle={() => tintStyle(face.tint)}
        options={MATE_SHAPE_IDS}
        value={face.shape}
        words={SHAPE_WORDS}
      >
        {shapeMark}
      </PickerRow>
    </>
  );
  if (folded)
    return (
      <LookBehindButton face={face} rows={rows}>
        {children}
      </LookBehindButton>
    );
  if (apart)
    return (
      <div className="flex w-full min-w-0 flex-col gap-3.5">
        {children}
        <div className="flex flex-col gap-0.5">{rows}</div>
      </div>
    );
  return (
    <div className="flex items-center gap-6 max-sm:flex-col max-sm:gap-4">
      <MateFacePreview className="size-28" face={face} />
      <div className="flex w-full min-w-0 flex-1 flex-col gap-3.5">
        {children}
        <div className="flex flex-col gap-0.5">{rows}</div>
      </div>
    </div>
  );
}

/**
 * The folded picker: the face, the name, and *Change look*, whose panel of colours and shapes
 * stands over what follows rather than pushing it down. Escape or a press outside folds it, the
 * focus back on *Change look*; it opens on the colour picked.
 */
function LookBehindButton({
  face,
  rows,
  children,
}: {
  readonly face: ZeropsMateFace;
  readonly rows: ReactNode;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <div className="relative flex items-center gap-3" ref={root}>
      <MateFacePreview className="size-10" face={face} />
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        ref={trigger}
        variant="secondary"
      >
        Change look
      </Button>
      <div
        aria-label="Look"
        className="absolute end-0 top-full z-10 mt-2 flex w-80 flex-col gap-0.5 rounded-card border bg-popover p-2 shadow-lg"
        hidden={!open}
        id={panelId}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // The panel folds; the dialog it stands in stays.
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }}
        ref={panel}
        role="group"
      >
        {rows}
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
  place,
  className = "flex justify-between",
  children,
}: {
  readonly label: string;
  /** Where each option stands, where they are not a row (`MateFaceRing`). */
  readonly place?: (index: number) => CSSProperties;
  readonly className?: string;
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
    <div aria-label={label} className={className} role="radiogroup">
      {options.map((option, index) => (
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
          style={{ ...optionStyle(option), ...place?.(index) }}
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
export function MateFacePreview({
  face,
  className,
  tracks = false,
}: {
  readonly face: ZeropsMateFace;
  /** Its size. */
  readonly className: string;
  /** Its eyes follow the pointer: a hero that greets the person (`MateFace`). */
  readonly tracks?: boolean;
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
          size={64}
          state="idle"
          tint={shown.before.tint}
        />
      )}
      <MateFace
        className={className}
        data-mate-face-preview={shown.turn === 0 ? undefined : "in"}
        key={`in-${shown.turn}`}
        shape={shown.face.shape}
        size={64}
        state="idle"
        tint={shown.face.tint}
        tracks={tracks}
      />
    </span>
  );
}

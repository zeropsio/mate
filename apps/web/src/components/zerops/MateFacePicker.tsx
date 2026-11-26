/**
 * A Mate's face, being picked: the face its colour and its shape make, big, beside a row of the
 * eight colours and a row of the eight shapes, under whatever else the form asks first (a new
 * Mate's name) — or, apart, the rows alone,
 * the face standing elsewhere as its page's hero (`MateFacePreview`) — or, as a ring, the colours
 * and the shapes opened out around the face (`MateFaceRing`, New project's Mate step). The one
 * picker wherever a face is picked: *New Mate*, New project's first Mate, an account's first run,
 * and *Change face…* in a Mate's menus.
 *
 * The face beside what makes it; on a phone, over it. Each row is a radio group of swatches,
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
import { useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { RadioSwatch, RadioSwatchGroup } from "../ui/radio-group";
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

/** A tint as the marks read it (`--mate-face-tint`): the palette's own token, so both themes hold. */
function tintStyle(tint: MateTintId): CSSProperties {
  return { "--mate-face-tint": `var(--zerops-mate-tint-${tint})` } as CSSProperties;
}

/** An option's mark, in the tint it is given; its ring, the mark's own outline a gap out, 2 px on
 * screen whatever the mark's scale, which the kit's swatch shows on the one picked. */
const MARK_CLASS = "fill-(--mate-face-tint)";
const RING_CLASS = "stroke-(--mate-face-tint)";

/** A colour's option: a dot, and its ring a gap out. */
function tintMark() {
  return (
    <>
      <circle
        className={RING_CLASS}
        cx="18"
        cy="18"
        data-slot="radio-swatch-ring"
        fill="none"
        r="15.5"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      <circle className={MARK_CLASS} cx="18" cy="18" r="12" />
    </>
  );
}

/** A shape's option: the shape, and its own outline a gap out, parallel to every shape. */
function shapeMark(shape: MateShapeId) {
  return (
    <>
      <path
        className={RING_CLASS}
        d={MATE_SHAPES[shape].d}
        data-slot="radio-swatch-ring"
        fill="none"
        strokeWidth={2}
        transform="translate(1 1) scale(0.34)"
        vectorEffect="non-scaling-stroke"
      />
      <path
        className={MARK_CLASS}
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
 * A ring's measures: its stage, the face at full size and how far the options stand out from
 * the middle (each option's seat: `PickerRow`). `page` is New project's Mate step (a 264 × 250 stage,
 * the face 200 px, 60 % of it open, options 34 px); `dialog` is the add-Mate dialog (200 × 189,
 * the face 152 px, keeping two thirds of it open so the ring has air, options 26 px).
 */
const RING = {
  page: {
    stage: "h-62.5 w-66",
    face: "group-data-open/ring:scale-60",
    hero: "size-50",
    radius: 112,
  },
  dialog: {
    stage: "h-47.25 w-50",
    face: "group-data-open/ring:scale-66",
    hero: "size-38",
    radius: 84,
  },
} as const;

/**
 * The face as its page's hero, with its colours and shapes as a ring around it (the owner,
 * 2026-11-23): shut, the face alone, large; open, the face a touch smaller and the options
 * coming out from behind it to their places, one after another, the colours down the left and
 * the shapes down the right; shutting, they go back in behind the face and fade, and the face
 * grows back. Shut, the options are inert. Reduced motion keeps the fades.
 */
export function MateFaceRing({
  face,
  open,
  size,
  className,
  onPickTint,
  onPickShape,
}: {
  readonly face: ZeropsMateFace;
  readonly open: boolean;
  readonly size: keyof typeof RING;
  /** Its place in the form (its margins). */
  readonly className?: string;
  readonly onPickTint: (tint: MateTintId) => void;
  readonly onPickShape: (shape: MateShapeId) => void;
}) {
  const ring = RING[size];
  return (
    <div
      className={cn("group/ring relative grid place-items-center", ring.stage, className)}
      data-open={open ? "" : undefined}
    >
      <div className="absolute inset-0" inert={!open}>
        <PickerRow
          className="contents"
          label="Color"
          onPick={onPickTint}
          optionStyle={tintStyle}
          options={MATE_TINT_IDS}
          place={(index) =>
            ringPlace(ringAngle("left", index, MATE_TINT_IDS.length), index, ring.radius)
          }
          ring={size}
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
          place={(index) =>
            ringPlace(ringAngle("right", index, MATE_SHAPE_IDS.length), index, ring.radius)
          }
          ring={size}
          value={face.shape}
          words={SHAPE_WORDS}
        >
          {shapeMark}
        </PickerRow>
      </div>
      {/* Over the options: shutting, they go back in behind the face. */}
      <span
        className={cn(
          "relative grid place-items-center transition-[scale] duration-260 ease-out-strong motion-reduce:transition-none",
          ring.face,
        )}
      >
        <MateFacePreview className={ring.hero} face={face} tracks />
      </span>
    </div>
  );
}

/**
 * An option's place on the ring, `radius` out from the middle at `angle`, and its turn: each
 * option sets off 24 ms after the one before as the ring opens, 12 ms as it shuts.
 */
function ringPlace(angle: number, index: number, radius: number): CSSProperties {
  const turn = (angle * Math.PI) / 180;
  return {
    "--ring-x": `${(radius * Math.sin(turn)).toFixed(2)}px`,
    "--ring-y": `${(-radius * Math.cos(turn)).toFixed(2)}px`,
    "--ring-open-delay": `${index * 24}ms`,
    "--ring-shut-delay": `${index * 12}ms`,
  } as CSSProperties;
}

/**
 * An option's seat on a ring: its swatch fills it, so every option is drawn around the very point
 * it travels to. Shut, it rests in the middle, small and unseen; open, it travels out to its
 * place. Reduced motion leaves it in its place and only fades it.
 */
const SEAT_CLASS =
  "absolute translate-0 scale-40 opacity-0 transition-[translate,scale,opacity] delay-(--ring-shut-delay) duration-260 ease-in-out-strong group-data-open/ring:translate-x-(--ring-x) group-data-open/ring:translate-y-(--ring-y) group-data-open/ring:scale-100 group-data-open/ring:opacity-100 group-data-open/ring:delay-(--ring-open-delay) group-data-open/ring:ease-out-strong motion-reduce:translate-x-(--ring-x) motion-reduce:translate-y-(--ring-y) motion-reduce:scale-100 motion-reduce:transition-opacity";

export function MateFacePicker({
  face,
  onPickTint,
  onPickShape,
  apart = false,
  children,
}: {
  /** The face the picks make now. */
  readonly face: ZeropsMateFace;
  readonly onPickTint: (tint: MateTintId) => void;
  readonly onPickShape: (shape: MateShapeId) => void;
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
 * One row of a face's pickers: a radio group of swatches, one Tab stop for the one picked, the
 * arrow keys walking the row and picking as they go. On a ring each swatch fills a seat placed
 * around the face (`place`).
 */
function PickerRow<T extends string>({
  label,
  options,
  value,
  words,
  optionStyle,
  onPick,
  place,
  ring,
  className = "flex justify-between",
  children,
}: {
  readonly label: string;
  /** Where each option stands, where they are not a row (`MateFaceRing`). */
  readonly place?: (index: number) => CSSProperties;
  /** The ring it stands on, whose measures its seats take. */
  readonly ring?: keyof typeof RING;
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
  return (
    <RadioSwatchGroup
      aria-label={label}
      className={className}
      onValueChange={onPick}
      options={options}
      value={value}
    >
      {options.map((option, index) => {
        const swatch = (
          <RadioSwatch
            aria-label={words[option]}
            key={option}
            size={place === undefined ? "default" : "fill"}
            style={optionStyle(option)}
            value={option}
          >
            <svg aria-hidden="true" viewBox="0 0 36 36">
              {children(option)}
            </svg>
          </RadioSwatch>
        );
        return place === undefined ? (
          swatch
        ) : (
          <span
            className={cn(
              SEAT_CLASS,
              ring === "dialog"
                ? "top-[calc(50%-13px)] left-[calc(50%-13px)] size-6.5"
                : "top-[calc(50%-17px)] left-[calc(50%-17px)] size-8.5",
            )}
            key={option}
            style={place(index)}
          >
            {swatch}
          </span>
        );
      })}
    </RadioSwatchGroup>
  );
}

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
    <span
      className="grid shrink-0 *:col-start-1 *:row-start-1"
      data-zerops-surface="mate-face-preview"
    >
      {/* The face before fades out under the new one and rests unseen, so one whose fade never
          ran is gone all the same. */}
      {shown.before === undefined ? null : (
        <MateFace
          className={cn(className, "animate-face-out opacity-0")}
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
        className={shown.turn === 0 ? className : cn(className, "motion-safe:animate-face-in")}
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

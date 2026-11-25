import { useState, type CSSProperties } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";

import { personMark } from "./person.logic";

/**
 * One scale with a Mate's face (`MateFace`), so a person beside a Mate stands as tall. Each size
 * has its place: 16 in a line of text and an `xs` row, 20 in an `sm` row, 24 beside a one-line name
 * (a table's cell, a stack on a card), 32 an `md` row's lead, 64 alone on a person's own page.
 */
type PersonAvatarSize = 16 | 20 | 24 | 32 | 64;

const SIZE_CLASS: Record<PersonAvatarSize, string> = {
  16: "size-4 text-4xs",
  20: "size-5 text-3xs",
  24: "size-6 text-2xs",
  32: "size-8 text-body",
  64: "size-16 text-display",
};

/**
 * A person's disc: their picture, or their letter on their own hue (`--person-hue`, set beside
 * it), lighter at the top left, lighter on a light ground and deeper on a dark one; the letter in
 * the hue's dark ink on the light tints and white on the deep ones (`--color-person-*`). A
 * hairline keeps a pale picture off the ground. `MateOwnerMark` wears the same disc.
 */
export const PERSON_DISC =
  "relative inline-flex flex-none items-center justify-center overflow-hidden rounded-full bg-linear-140/srgb from-person-from to-person-to leading-none font-semibold text-person-ink ring-1 ring-foreground/8 select-none";

/**
 * Nobody's seat: a dashed ring in the muted ink (the menu's own muted ink on the menu), no fill
 * and no hairline, so it never reads as a person without a picture — the "no assignee"
 * convention. Twelve even dashes: `pathLength` makes the ring's length 24, so the pattern closes
 * on itself with no short dash at the seam. `MateOwnerMark` seats the same ring on a face's corner.
 * `stroke` is in the 16-unit box: a larger seat passes a thinner one, so its line stays as legible
 * as a face's strokes at that size.
 */
export function NobodyRing({ stroke = 1.25 }: { readonly stroke?: number }) {
  return (
    <svg aria-hidden="true" className="size-full" viewBox="0 0 16 16">
      <circle
        cx="8"
        cy="8"
        fill="none"
        pathLength="24"
        r={7.875 - stroke / 2}
        stroke="currentColor"
        strokeDasharray="1.25 0.75"
        strokeWidth={stroke}
      />
    </svg>
  );
}

/** The ring's line in the 16-unit box, for the face's own stroke in pixels at each size (`MateFace`). */
const NOBODY_STROKE: Record<PersonAvatarSize, number> = {
  16: 1.25,
  20: 1.2,
  24: 1.17,
  32: 1.13,
  64: 0.75,
};

/** The ring's ink: the muted ink at three quarters, the menu's own on the menu. */
const NOBODY_INK =
  "text-muted-foreground/75 in-data-[sidebar=sidebar]:text-sidebar-muted-foreground/75";

type PersonAvatarProps = Omit<React.ComponentProps<"span">, "children" | "style"> & {
  readonly size?: PersonAvatarSize;
} & (
    | {
        /** The person's name: its first word gives the letter and the hue (`personMark`). */
        readonly name: string;
        readonly picture?: string | null | undefined;
        readonly nobody?: never;
      }
    | {
        /** Nobody's: a seat no person holds (an automated Mate, a Mate nobody owns yet). */
        readonly nobody: true;
        readonly name?: never;
        readonly picture?: never;
      }
  );

/**
 * A person: their picture, or the first letter of their name on a hue of their own — the same
 * person the same colour on every surface. `nobody` is the seat where no person is: an empty
 * dashed ring, never a stand-in icon or a grey disc. Decorative on its own (the name it stands
 * for is always written beside it), so it carries no accessible name.
 */
function PersonAvatar({ className, size = 24, ...props }: PersonAvatarProps) {
  if (props.nobody === true) {
    const { nobody: _nobody, ...rest } = props;
    return (
      <span
        {...rest}
        aria-hidden="true"
        className={cn("inline-flex flex-none", SIZE_CLASS[size], NOBODY_INK, className)}
        data-zerops-avatar="nobody"
        data-zerops-primitive="avatar"
      >
        <NobodyRing stroke={NOBODY_STROKE[size]} />
      </span>
    );
  }
  const { name, picture, ...rest } = props;
  return <PersonDisc {...rest} className={className} name={name} picture={picture} size={size} />;
}

function PersonDisc({
  className,
  name,
  picture,
  size,
  ...props
}: Omit<React.ComponentProps<"span">, "children" | "style"> & {
  readonly name: string;
  readonly picture: string | null | undefined;
  readonly size: PersonAvatarSize;
}) {
  const [failed, setFailed] = useState(false);
  const mark = personMark({ name, picture });
  const shown = failed ? null : mark.picture;

  return (
    <span
      {...props}
      aria-hidden="true"
      className={cn(PERSON_DISC, SIZE_CLASS[size], className)}
      data-zerops-avatar={shown === null ? "initials" : "picture"}
      data-zerops-primitive="avatar"
      style={{ "--person-hue": mark.hue } as CSSProperties}
    >
      {mark.letter}
      {shown === null ? null : (
        <img
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => {
            setFailed(true);
          }}
          src={shown}
        />
      )}
    </span>
  );
}

/** A stack's sizes: beside a one-line summary (24) or a card's lead (32). */
type PersonAvatarStackSize = 24 | 32;

const STACK_CLASS: Record<PersonAvatarStackSize, string> = {
  24: "ps-1.5 *:-ms-1.5",
  32: "ps-2 *:-ms-2",
};

const MORE_CLASS: Record<PersonAvatarStackSize, string> = {
  24: "h-6 min-w-6 px-1 text-2xs",
  32: "h-8 min-w-8 px-1.5 text-caption",
};

interface StackPerson {
  readonly key: string;
  readonly name: string;
  readonly avatarUrl: string | null;
}

/**
 * Who has access, as faces: the first few people's avatars, each over the last and ringed in the
 * card's ground where they overlap, then how many more as `+N` on a disc of the same size.
 * Decorative: the words beside it say who and how many.
 */
function PersonAvatarStack({
  people,
  shown,
  size = 24,
  className,
}: {
  readonly people: ReadonlyArray<StackPerson>;
  /** How many faces stand before the `+N`. */
  readonly shown: number;
  readonly size?: PersonAvatarStackSize;
  readonly className?: string | undefined;
}) {
  const more = people.length - shown;
  return (
    <span
      aria-hidden="true"
      className={cn("flex flex-none *:ring-2 *:ring-card", STACK_CLASS[size], className)}
      data-zerops-primitive="avatar-stack"
    >
      {people.slice(0, shown).map((person) => (
        <PersonAvatar key={person.key} name={person.name} picture={person.avatarUrl} size={size} />
      ))}
      {more <= 0 ? null : (
        <span
          className={cn(
            "relative inline-flex items-center justify-center rounded-full bg-accent leading-none font-medium text-muted-foreground tabular-nums",
            MORE_CLASS[size],
          )}
        >
          {`+${String(more)}`}
        </span>
      )}
    </span>
  );
}

export { PersonAvatar, PersonAvatarStack };
export type { PersonAvatarSize, PersonAvatarStackSize };

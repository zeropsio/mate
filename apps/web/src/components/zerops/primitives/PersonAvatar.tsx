import { useState, type CSSProperties } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";

import { personMark } from "./person.logic";

/** One scale with a Mate's face (`MateFace`), so a person beside a Mate stands as tall. */
type PersonAvatarSize = 16 | 20 | 24 | 32 | 64;

const SIZE_CLASS: Record<PersonAvatarSize, string> = {
  16: "size-4 text-4xs",
  20: "size-5 text-3xs",
  24: "size-6 text-2xs",
  32: "size-8 text-sm",
  64: "size-16 text-2xl",
};

type PersonAvatarProps = Omit<React.ComponentProps<"span">, "children" | "style"> & {
  /** The person's name: its first word gives the letter and the hue (`personMark`). */
  readonly name: string;
  readonly picture?: string | null | undefined;
  readonly size?: PersonAvatarSize;
};

/**
 * A person: their picture, or the first letter of their name on a hue of their own — the same
 * person the same colour on every surface. Decorative on its own (the name it stands for is
 * always written beside it), so it carries no accessible name.
 */
function PersonAvatar({ className, name, picture, size = 24, ...props }: PersonAvatarProps) {
  const [failed, setFailed] = useState(false);
  const mark = personMark({ name, picture });
  const shown = failed ? null : mark.picture;

  return (
    <span
      {...props}
      aria-hidden="true"
      className={cn("person-avatar", SIZE_CLASS[size], className)}
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

export { PersonAvatar };
export type { PersonAvatarProps, PersonAvatarSize };

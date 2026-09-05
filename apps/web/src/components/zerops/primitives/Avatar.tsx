import { useState } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";

type AvatarSize = "sm" | "md";

const SIZE_CLASS: Record<AvatarSize, string> = {
  /** Beside 14 px chrome text: the bar. */
  sm: "size-6 text-[10px]",
  /** Beside a name and an email: a menu's identity block, a settings row. */
  md: "size-8 text-xs",
};

type AvatarProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** One or two letters shown when there is no picture, or until it loads. */
  readonly initials: string;
  readonly src?: string | null;
  readonly size?: AvatarSize;
};

/**
 * A person's picture, or their initials when there is none. Decorative on its
 * own — the name it stands for is always written next to it — so it carries
 * no accessible name of its own.
 */
function Avatar({ className, initials, size = "sm", src = null, ...props }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const picture = src !== null && src.length > 0 && !failed ? src : null;

  return (
    <span
      {...props}
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-muted-foreground select-none",
        SIZE_CLASS[size],
        className,
      )}
      data-zerops-avatar={picture === null ? "initials" : "picture"}
      data-zerops-primitive="avatar"
    >
      {initials}
      {picture === null ? null : (
        <img
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => {
            setFailed(true);
          }}
          src={picture}
        />
      )}
    </span>
  );
}

export { Avatar };
export type { AvatarProps, AvatarSize };

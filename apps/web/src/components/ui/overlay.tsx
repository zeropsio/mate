import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";

type OverlayKind = "drop" | "hint" | "veil";

const OVERLAY_LAYER_CLASS: Record<OverlayKind, string> = {
  drop: "absolute inset-2 z-40 items-center rounded-sheet border-2 border-dashed border-primary/60 bg-primary/4",
  hint: "fixed inset-x-0 top-1/5 z-100",
  veil: "absolute inset-0 z-10 items-center rounded-card bg-background/75 p-4 backdrop-blur-xs",
};

const OVERLAY_WORDS_CLASS: Record<OverlayKind, string> = {
  drop: "gap-2 px-4 py-2.5 text-body [&_svg]:size-4",
  hint: "gap-3 px-8 py-4 text-title [&_svg]:size-6",
  veil: "gap-2 px-4 py-2.5 text-center text-body [&_svg]:size-4",
};

/**
 * A layer laid over a surface while something lasts, saying one thing in a pill and never taking
 * a press. It stays in the document and eases in and out with `shown`, so it never cuts in.
 *
 * - `drop` — the surface takes what is dragged over it (files on the conversation): it covers its
 *   positioned parent, 8 px in, with a dashed edge in the primary ink and the faintest primary
 *   tint, its words in the middle.
 * - `veil` — the surface under it cannot be used as it stands (a visual editor while the text it
 *   edits does not parse): its card-cornered parent veiled in its own ground, blurred, what to do
 *   in the middle.
 * - `hint` — a word about a key being held ("Hold ⌘Q to quit"): over the whole window, its words
 *   in the window's upper third, larger, to be read at a glance.
 *
 * A popup tied to a press or a point is a `Popover` or a `Tooltip`; a message that stays is a
 * `Toast` or an `Alert`.
 */
function Overlay({
  kind,
  shown,
  icon,
  children,
  ...props
}: {
  readonly kind: OverlayKind;
  /** Whether it is over the surface now; it eases in and out rather than mounting. */
  readonly shown: boolean;
  /** A glyph before the words, in the primary ink. */
  readonly icon?: ReactNode;
  readonly children: ReactNode;
} & Omit<ComponentProps<"div">, "className" | "children">) {
  return (
    <div
      className={cn(
        "group/overlay pointer-events-none flex justify-center transition-[opacity,visibility] duration-150 ease-out-strong not-data-shown:invisible not-data-shown:opacity-0",
        OVERLAY_LAYER_CLASS[kind],
      )}
      data-kind={kind}
      data-shown={shown ? "" : undefined}
      data-slot="overlay"
      {...props}
    >
      <div
        className={cn(
          "dropdown-glass relative flex items-center rounded-full font-medium text-popover-foreground scale-96 shadow-popup transition-[scale] duration-150 ease-out-strong before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:shadow-edge group-data-shown/overlay:scale-100 [&_svg]:shrink-0 [&_svg]:text-primary",
          OVERLAY_WORDS_CLASS[kind],
        )}
        role="status"
      >
        {icon}
        {children}
      </div>
    </div>
  );
}

export { Overlay };

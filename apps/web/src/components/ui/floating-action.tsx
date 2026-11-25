import type { ComponentProps, ReactNode } from "react";

import { Button } from "~/components/ui/button";

/**
 * A press that floats over content scrolling under it, such as the way back to a conversation's
 * end: one round icon press, raised on a soft shadow. It stays in the document and `shown` eases
 * it in, rising 6 px and growing from 96%, and out the same way (200 ms); hidden, it is inert, out
 * of the tab order and the tree a reader hears, and a press still focused as it goes lets the focus
 * go with it. Its parent places it; it takes no look of its own.
 *
 * A press that belongs to a row or a card and shows on its hover is that row's or card's; a press
 * over a picture on the dark stage is `DialogMediaStep` or the `scrim` button.
 */
function FloatingAction({
  shown,
  label,
  children,
  ...props
}: Omit<
  ComponentProps<typeof Button>,
  "aria-label" | "children" | "className" | "inert" | "shape" | "size" | "variant"
> & {
  readonly shown: boolean;
  /** What it does, for the reader: it shows only its icon. */
  readonly label: string;
  /** Its icon. */
  readonly children: ReactNode;
}) {
  return (
    <span
      className="pointer-events-auto rounded-full shadow-lg/8 transition-[opacity,translate,scale] duration-200 ease-out-strong not-data-shown:pointer-events-none not-data-shown:translate-y-1.5 not-data-shown:scale-96 not-data-shown:opacity-0"
      data-shown={shown ? "" : undefined}
      data-slot="floating-action"
    >
      <Button
        aria-label={label}
        inert={!shown}
        shape="round"
        size="icon-md"
        variant="secondary"
        {...props}
      >
        {children}
      </Button>
    </span>
  );
}

export { FloatingAction };

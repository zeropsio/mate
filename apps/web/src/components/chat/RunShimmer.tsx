import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * Words with a band of light sweeping across them, left to right, in their own inks, while what
 * they name runs. With reduced motion the words simply stand.
 *
 * The sweep runs on the compositor: no paint-only property moves. The words stand at 70 % of their
 * ink; over them a window three times their width slides by `translate`, holding a copy of the
 * words that slides back by as much, so the copy stands still under the moving window, and the
 * window's soft-edged band adds the other 30 % of the ink where it passes — added, not laid over
 * (`plus-lighter` inside the words' own group, `isolate`), so the sum is the ink a mask of
 * 70 % → 100 % → 70 % made of it. Both slides start in the same style change, so they never drift;
 * they step (`run-shimmer.css`), so the masked, blended band redraws at each step
 * rather than on every frame of a high-refresh display. The copy is the same words in the same
 * parts, laid out in a box of the words' own width, hidden from readers and from input
 * (`aria-hidden`, `inert`): nobody hears them twice, no find or selection lands in it. The words
 * are copied as they are, so they must be words: nothing in them that keeps state.
 *
 * `inline` is for words that are part of a line cut with an ellipsis: while they sweep they stand
 * in a box of their own as wide as they are (at most the line), cut there, so the copy is cut
 * where they are. That box wears the line's own style — the words' (`className`) is on the words
 * inside it — so its line is the line's height, whole glyphs in it, and its ellipsis is the one
 * the line drew, in the line's ink. The copy's ellipsis is drawn in no ink (`run-shimmer.css`): the
 * light never touches it.
 */
export function RunShimmer({
  sweeps,
  inline = false,
  className,
  children,
}: {
  readonly sweeps: boolean;
  readonly inline?: boolean;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cn(
        inline ? undefined : className,
        // The window's three widths stay out of any scroll; across only, so no glyph is cut above
        // or below.
        sweeps && "motion-safe:relative motion-safe:isolate motion-safe:overflow-x-clip",
        sweeps &&
          inline &&
          "motion-safe:inline-block motion-safe:max-w-full motion-safe:text-ellipsis motion-safe:align-baseline",
      )}
    >
      <span className={cn(inline ? className : undefined, sweeps && "motion-safe:opacity-70")}>
        {children}
      </span>
      {sweeps ? (
        <span
          aria-hidden="true"
          data-sweep-band=""
          className="pointer-events-none hidden select-none [text-overflow:inherit] mix-blend-plus-lighter [mask-image:linear-gradient(100deg,transparent_40%,color-mix(in_srgb,currentColor_30%,transparent)_50%,transparent_60%)] motion-safe:absolute motion-safe:top-0 motion-safe:left-0 motion-safe:block motion-safe:h-full motion-safe:w-[300%]"
          inert
        >
          <span
            className="absolute top-0 left-0 block h-full w-1/3 overflow-x-clip [text-overflow:inherit]"
            data-sweep-copy=""
          >
            <span className={inline ? className : undefined} data-sweep-ink="">
              {children}
            </span>
          </span>
        </span>
      ) : null}
    </span>
  );
}

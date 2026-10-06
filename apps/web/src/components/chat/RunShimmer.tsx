import type { ReactNode } from "react";

/**
 * Words with a band of light sweeping across them, left to right, in their own inks, while what
 * they name runs (`[data-run-shimmer]` in index.css). With reduced motion the words simply stand.
 *
 * The sweep runs on the compositor: no paint-only property moves. The words stand at 70 % of their
 * ink; over them a window three times their width slides by `translate`, holding a copy of the
 * words that slides back by as much, so the copy stands still under the moving window, and the
 * window's soft-edged band adds the other 30 % of the ink where it passes. The copy is the same
 * words in the same parts, laid out in a box of the words' own width, hidden from readers and
 * from input (`aria-hidden`, `inert`): nobody hears them twice, no find or selection lands in it.
 * The words are copied as they are, so they must be words: nothing in them that keeps state.
 *
 * `inline` is for words that are part of a line cut with an ellipsis: while they sweep they stand
 * in a box of their own as wide as they are (at most the line), cut there, so the copy is cut
 * where they are. That box wears the line's own style — the words' (`className`) is on the words
 * inside it — so its line is the line's height, whole glyphs in it, and its ellipsis is the one
 * the line drew, in the line's ink. The copy's ellipsis is drawn in no ink: the light never
 * touches it.
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
      className={inline ? undefined : className}
      data-run-shimmer={sweeps ? "" : undefined}
      data-sweep-cut={sweeps && inline ? "" : undefined}
    >
      <span className={inline ? className : undefined} data-sweep-words="">
        {children}
      </span>
      {sweeps ? (
        <span aria-hidden="true" data-sweep-band="" inert>
          <span data-sweep-copy="">
            <span className={inline ? className : undefined} data-sweep-ink="">
              {children}
            </span>
          </span>
        </span>
      ) : null}
    </span>
  );
}

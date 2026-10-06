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
 * `inline` is for words that are part of a line cut with an ellipsis: they stand in a box of their
 * own as wide as they are (at most the line), cut with their own ellipsis, so the copy is cut
 * where they are.
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
      className={className}
      data-run-shimmer={sweeps ? "" : undefined}
      data-sweep-cut={sweeps && inline ? "" : undefined}
    >
      <span data-sweep-words="">{children}</span>
      {sweeps ? (
        <span aria-hidden="true" data-sweep-band="" inert>
          <span data-sweep-copy="">{children}</span>
        </span>
      ) : null}
    </span>
  );
}

import { cn } from "~/lib/utils";

/**
 * The row's second line where nobody has signed its agent in and nothing was
 * asked (`mateOwnerView`): the fact, in the muted ink, as one line of the
 * row's leading on the words' edge — in ink where the sign-in is the viewer's
 * to make, as a question waiting on them is. Nothing on it to press: the
 * row's own press opens the Mate, whose conversation holds the sign-in.
 */
export function MateSignInLine({
  words,
  waitsOnViewer,
}: {
  readonly words: string;
  readonly waitsOnViewer: boolean;
}) {
  return (
    <span
      className={cn(
        "truncate menu-line2",
        waitsOnViewer ? "text-sidebar-foreground" : "text-muted-foreground",
      )}
      data-zerops-sign-in={waitsOnViewer ? "yours" : "nobody"}
      data-zerops-surface="sidebar-mate-sign-in"
    >
      {words}
    </span>
  );
}

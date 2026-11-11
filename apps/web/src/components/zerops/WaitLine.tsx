/**
 * A wait's one line: the small spinner and the words, quiet. Only where a wait has words of its
 * own (a sign-in's return, limits still on their way under the cards, a setting still read); a
 * page that cannot draw yet stands in with its shape instead (`PageStandIn`). `inline`: inside a
 * line that already has its size and ink (a settings row's status line), at that line's height.
 */
import { Spinner } from "../ui/spinner";

export function WaitLine({
  text,
  inline = false,
}: {
  readonly text: string;
  readonly inline?: boolean;
}) {
  if (inline)
    return (
      <span className="inline-flex items-center gap-1.5 align-top" data-zerops-wait-line="">
        <Spinner size="xs" aria-hidden="true" role="presentation" />
        <span>{text}</span>
      </span>
    );
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" data-zerops-wait-line="">
      <Spinner size="sm" aria-hidden="true" role="presentation" />
      <span>{text}</span>
    </p>
  );
}

/**
 * A wait's one line: the small spinner and the words, quiet. Only where a wait has words of its
 * own (a sign-in's return, limits still on their way under the cards); a page that cannot draw yet
 * stands in with its shape instead (`PageStandIn`).
 */
import { Spinner } from "../ui/spinner";

export function WaitLine({ text }: { readonly text: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" data-zerops-wait-line="">
      <Spinner size="sm" aria-hidden="true" role="presentation" />
      <span>{text}</span>
    </p>
  );
}

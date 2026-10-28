import { Button } from "~/components/ui/button";
import { Failure } from "~/components/ui/failure";

/** A terminal read result and the reader's next attempt, in the surface that asked. */
export function ZeropsReadFailure({
  reason,
  again,
  action,
}: {
  readonly reason: string;
  readonly again?: (() => void) | undefined;
  readonly action: "Compare again" | "Read setup again" | "Review again";
}) {
  return (
    <Failure
      action={
        again === undefined ? undefined : (
          <Button onClick={again} size="sm" variant="secondary">
            {action}
          </Button>
        )
      }
      cause={reason}
    />
  );
}

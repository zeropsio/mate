import { Button } from "~/components/ui/button";

/** A terminal read result and the reader's next attempt, in the surface that asked. */
export function ZeropsReadFailure({
  reason,
  again,
  action,
}: {
  readonly reason: string;
  readonly again?: (() => void) | undefined;
  readonly action: "Compare again" | "Read recipe again";
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-muted-foreground">{reason}</p>
      {again === undefined ? null : (
        <Button onClick={again} size="sm" variant="outline">
          {action}
        </Button>
      )}
    </div>
  );
}

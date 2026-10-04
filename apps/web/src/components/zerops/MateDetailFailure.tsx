import { Button } from "../ui/button";

/** A project inventory attempt ended: its reason stays visible until the person asks again. */
export function MateDetailFailure({
  message,
  again,
}: {
  readonly message: string;
  readonly again: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
      <p className="text-center text-sm text-muted-foreground" role="status">
        Could not read this Mate. {message}
      </p>
      <Button onClick={again} size="compact" variant="pill">
        Again
      </Button>
    </div>
  );
}

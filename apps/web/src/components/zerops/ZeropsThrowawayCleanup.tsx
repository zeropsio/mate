import { Button } from "../ui/button";
import type { ThrowawaySweepView } from "../../zerops/useZeropsThrowawaySweep";

/** Inventory cleanup has its own visible result and an explicit way to ask again. */
export function ZeropsThrowawayCleanup({ view }: { readonly view: ThrowawaySweepView }) {
  const busy = view.state === "waiting" || view.state === "running";
  const line =
    view.state === "failed" || view.state === "unknown"
      ? view.state === "unknown"
        ? `Sign-in cleanup outcome unknown. ${view.failure ?? ""}`
        : view.failure
      : view.state === "waiting"
        ? "Sign-in cleanup queued."
        : view.state === "running"
          ? "Cleaning up sign-in tokens…"
          : view.state === "done"
            ? "Sign-in cleanup finished."
            : null;
  return (
    <div
      className="flex items-center gap-2 text-xs text-muted-foreground"
      role={view.state === "failed" || view.state === "unknown" ? "alert" : "status"}
    >
      {line === null ? null : <span>{line}</span>}
      <Button disabled={busy} onClick={view.again} size="compact" variant="ghost">
        {view.state === "failed" || view.state === "unknown"
          ? "Delete again"
          : "Clean up sign-in tokens"}
      </Button>
    </div>
  );
}

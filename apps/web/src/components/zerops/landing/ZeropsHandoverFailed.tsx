/**
 * The sign-in callback when it cannot finish: the platform declined, the
 * fragment came from another window, or adopting the token failed. Stands in
 * the landing shell like every other landing state — mark, title, one card —
 * so a failed sign-in looks like the sign-in it came from, not like a crash.
 */

import { Button } from "../../ui/button";
import { ZeropsLandingShell } from "./ZeropsLandingShell";

export function ZeropsHandoverFailed({
  message,
  onRetry,
  onBack,
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly onBack: () => void;
}) {
  return (
    <ZeropsLandingShell title="Sign-in didn't finish" description={message}>
      <div className="space-y-3" data-zerops-handover-failed="true">
        <Button className="w-full" onClick={onRetry}>
          Try again
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          <button
            className="underline underline-offset-2 hover:text-foreground"
            onClick={onBack}
            type="button"
          >
            Back to Zerops Mate
          </button>
        </p>
      </div>
    </ZeropsLandingShell>
  );
}

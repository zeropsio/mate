/**
 * The app when something above its router threw while it opened (the session, the account's data,
 * its inventory): it says so in the landing shell, with a reload as the one way on — never the
 * boot frame standing with nothing to say once #root's content is gone.
 */

import { Button } from "../../ui/button";
import { ZeropsLandingShell } from "./ZeropsLandingShell";

export function ZeropsAppFailed({ onReload }: { readonly onReload: () => void }) {
  return (
    <ZeropsLandingShell
      title="Mate couldn't open"
      description="Something went wrong while it opened. Your work is kept; reload to try again."
    >
      <div data-zerops-app-failed="true">
        <Button className="w-full" onClick={onReload}>
          Reload
        </Button>
      </div>
    </ZeropsLandingShell>
  );
}

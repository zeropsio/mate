/**
 * The app when something above its router threw while it opened (the session, the account's data,
 * its inventory): a whole page that failed (the kit's `Failure` page), with a reload as the one way
 * on — never the boot frame standing with nothing to say once #root's content is gone.
 */

import { MateMark } from "../../MateMark";
import { Button } from "../../ui/button";
import { Failure } from "../../ui/failure";

export function ZeropsAppFailed({ onReload }: { readonly onReload: () => void }) {
  return (
    <div className="flex h-dvh bg-background" data-zerops-app-failed="true">
      <Failure
        action={<Button onClick={onReload}>Reload</Button>}
        cause="Mate couldn't open"
        mark={<MateMark className="size-12" />}
        size="page"
      >
        Something went wrong while it opened. Your work is kept; reload to try again.
      </Failure>
    </div>
  );
}

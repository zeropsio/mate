/**
 * Who is signed in, and the way out — in the top bar of every signed-in
 * Zerops page, so leaving never depends on first choosing an organization.
 */

import { useState } from "react";

import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { Button } from "../../ui/button";

export function ZeropsAccountControl({
  email,
  busy = false,
  error = null,
  onSignOut,
}: {
  readonly email: string | null;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onSignOut: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2" data-zerops-account-control="true">
      {email === null ? null : (
        <span className="hidden max-w-64 truncate text-xs text-muted-foreground sm:inline">
          {email}
        </span>
      )}
      <Button
        disabled={busy}
        onClick={onSignOut}
        size="sm"
        variant={error === null ? "ghost" : "destructive"}
      >
        {error === null ? "Sign out" : "Sign out failed. Try again"}
      </Button>
    </div>
  );
}

/** The control wired to the session; renders nothing while nobody is signed in. */
export function ZeropsSessionAccountControl() {
  const { status, user, signOut } = useZeropsSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (status !== "signed-in") return null;
  return (
    <ZeropsAccountControl
      busy={busy}
      email={user?.email ?? null}
      error={error}
      onSignOut={() => {
        setBusy(true);
        setError(null);
        void signOut()
          .catch((cause: unknown) => {
            setError(zeropsErrorMessage(cause));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    />
  );
}

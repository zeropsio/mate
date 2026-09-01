/**
 * Where `app.zerops.io` sends the browser back after the user signed in there.
 *
 * Not nested under `/zerops` (hence the `zerops_` segment): this runs before
 * there is a session, so it must not mount anything that assumes one. The door
 * gives it a bare shell and never redirects it — a redirect would drop the
 * fragment, and with it the credential.
 */

import type { ZeropsHandoverOutcome } from "@t3tools/client-runtime/zerops/handover";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { completeZeropsHandover, startZeropsHandover } from "../zerops/handover";
import { useZeropsSession, zeropsErrorMessage } from "../zerops/ZeropsSessionProvider";

export const Route = createFileRoute("/zerops_/authorized")({
  // Read in `beforeLoad`, not in the component: this runs before anything
  // renders and before the router can normalize the URL, so the fragment
  // cannot be gone by the time we look for it. It is also where the nonce is
  // spent, so a re-render can never spend it twice.
  beforeLoad: () => ({ handover: takeZeropsHandoverFromLocation() }),
  component: ZeropsHandoverCallback,
});

type CallbackState =
  | { readonly kind: "working" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Reads the callback, spends the nonce, and takes the fragment out of the URL
 * and browser history — in that order, so the credential is never left behind
 * for a back button or a screenshot.
 */
function takeZeropsHandoverFromLocation(): ZeropsHandoverOutcome {
  const fragment = window.location.hash;
  const outcome = completeZeropsHandover({ fragment });
  if (fragment) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  return outcome;
}

function ZeropsHandoverCallback() {
  const { handover: outcome } = Route.useRouteContext();
  const { adoptHandover } = useZeropsSession();
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    // Strict mode mounts twice, and the exchange must not run twice: the
    // platform's refresh token may be single-use.
    if (started.current) return;
    started.current = true;

    if (outcome.kind === "absent") {
      void navigate({ to: "/", replace: true });
      return;
    }
    if (outcome.kind === "mismatched") {
      setState({
        kind: "failed",
        message: "That sign-in did not come from this window. Start again from Zerops Code.",
      });
      return;
    }
    if (outcome.kind === "declined") {
      setState({
        kind: "failed",
        message:
          outcome.code === "access_denied"
            ? "Sign-in was cancelled."
            : "Zerops could not complete that sign-in.",
      });
      return;
    }

    void adoptHandover({
      refreshToken: outcome.refreshToken,
      zcpClaimed: outcome.zcpClaimed,
    })
      .then(() => navigate({ to: "/", replace: true }))
      .catch((cause: unknown) => {
        setState({ kind: "failed", message: zeropsErrorMessage(cause) });
      });
  }, [adoptHandover, navigate, outcome]);

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        {state.kind === "working" ? (
          <>
            <Spinner className="mx-auto size-5" />
            <p className="text-sm text-muted-foreground">Signing you in…</p>
          </>
        ) : (
          <>
            <p className="text-sm text-foreground">{state.message}</p>
            <Button
              className="w-full"
              onClick={() => {
                window.location.href = startZeropsHandover();
              }}
            >
              Try again
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                void navigate({ to: "/", replace: true });
              }}
            >
              Back to Zerops Code
            </button>
          </>
        )}
      </div>
    </div>
  );
}

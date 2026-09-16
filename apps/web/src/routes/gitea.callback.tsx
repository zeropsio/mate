/**
 * `/gitea/callback` — where Gitea sends the browser back with the code.
 *
 * Everything it does is one call (`giteaSession.ts`): match the state this tab
 * sent, exchange the code for a token that acts as the person, keep the token
 * in memory and put them back where they were. It is a page only because the
 * OAuth flow is a navigation; there is nothing here to read.
 *
 * It paints the same height whatever happens — a line and, on a refusal, a way
 * back — so the return leg never pushes the layout around.
 */

import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { ZeropsLandingShell } from "../components/zerops/landing/ZeropsLandingShell";
import { completeGiteaSignIn } from "../zerops/giteaSession";

function GiteaCallback() {
  const navigate = useNavigate();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void completeGiteaSignIn(search).then((outcome) => {
      if (cancelled) return;
      if (outcome.ok) void navigate({ to: outcome.returnTo, replace: true });
      else setRefusal(outcome.reason);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, search]);

  return (
    <ZeropsLandingShell title="Gitea" description="Signing you in to your account's Gitea.">
      <div className="flex min-h-24 flex-col justify-center gap-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {refusal === null ? <Spinner className="size-4" /> : null}
          {refusal ?? "Finishing your Gitea sign-in…"}
        </p>
        {refusal === null ? null : (
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigate({ to: "/zerops", replace: true });
              }}
            >
              Back to projects
            </Button>
          </div>
        )}
      </div>
    </ZeropsLandingShell>
  );
}

export const Route = createFileRoute("/gitea/callback")({
  component: GiteaCallback,
});

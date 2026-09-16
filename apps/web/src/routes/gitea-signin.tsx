/**
 * *Sign in with Zerops*, the one step that happens in Mate (guide 3.6).
 *
 * Gitea sends the person to the org's broker; the broker sends them here with
 * a request id and its own origin. All this page does is say what they are
 * about to do and, on one click, prove who they are: it mints a throwaway with
 * no rights named for that one Gitea, hands it to the broker, follows the
 * answer back to Gitea's callback, and deletes the throwaway whatever
 * happened.
 *
 * **The `broker` in the query string is a claim.** Anybody can send a person
 * here naming any origin; believing it would mean minting a token that names
 * them and handing it to a stranger. So it is matched against the brokers of
 * the person's own Gitea projects (`giteaSignIn.ts`) before a token exists.
 *
 * Signed out, the request is remembered and the person signs in first — the
 * return path carries no query string, so the two values are kept beside it
 * rather than in the URL.
 */

import { completeGiteaSignIn, MateCredentialError } from "@t3tools/client-runtime/authorization";
import { deriveGiteaState, readZeropsToolKind } from "@t3tools/client-runtime/zerops";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import {
  giteaSignInRefusalMessage,
  resolveGiteaSignInRequest,
  type KnownGiteaBroker,
} from "@t3tools/client-runtime/zerops/giteaSignIn";
import { createFileRoute } from "@tanstack/react-router";
import { useContext, useMemo, useState } from "react";

import { ZeropsLandingShell } from "../components/zerops/landing/ZeropsLandingShell";
import { Button } from "../components/ui/button";
import { randomUUID } from "../lib/utils";
import { InventoryContext } from "../zerops/inventoryContext";
import { rememberSignInReturn } from "../zerops/navigationStorage";
import { startZeropsHandover } from "../zerops/handover";
import { useZeropsSession } from "../zerops/ZeropsSessionProvider";

const PENDING_KEY = "mate:gitea-signin:v1";

/** Keeps the request across a sign-in, because the return path carries no query. */
export function rememberGiteaSignInRequest(request: {
  readonly rid: string;
  readonly broker: string;
}): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(request));
  } catch {
    /* Without storage the person starts again from Gitea. */
  }
}

export function takeGiteaSignInRequest(): {
  readonly rid: string | null;
  readonly broker: string | null;
} {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (raw === null) return { rid: null, broker: null };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { rid: null, broker: null };
    const record = parsed as { readonly rid?: unknown; readonly broker?: unknown };
    return {
      rid: typeof record.rid === "string" ? record.rid : null,
      broker: typeof record.broker === "string" ? record.broker : null,
    };
  } catch {
    return { rid: null, broker: null };
  }
}

export const Route = createFileRoute("/gitea-signin")({
  validateSearch: (search: Record<string, unknown>) => ({
    rid: typeof search.rid === "string" ? search.rid : undefined,
    broker: typeof search.broker === "string" ? search.broker : undefined,
  }),
  component: GiteaSignInConsent,
});

type ConsentState =
  | { readonly kind: "idle" }
  | { readonly kind: "working" }
  | { readonly kind: "failed"; readonly message: string };

function GiteaSignInConsent() {
  const search = Route.useSearch();
  const { client, user, status } = useZeropsSession();
  // Read tolerantly: signed out this page renders before the account shell
  // exists, and it does not need the inventory to say "sign in first".
  const inventory = useContext(InventoryContext);
  const [state, setState] = useState<ConsentState>({ kind: "idle" });

  /** Every Gitea this person's account actually has, and its broker. */
  const known = useMemo<ReadonlyArray<KnownGiteaBroker>>(
    () =>
      (inventory?.projects ?? [])
        .filter((project) => readZeropsToolKind(project.tagList) === "gitea")
        .flatMap((project) => {
          const outcome = inventory?.services.get(project.id);
          if (outcome?.status !== "resolved") return [];
          const gitea = deriveGiteaState(project, outcome.services);
          return gitea.url === undefined ||
            gitea.brokerUrl === undefined ||
            project.clientId === undefined
            ? []
            : [
                {
                  brokerOrigin: gitea.brokerUrl,
                  giteaOrigin: gitea.url,
                  clientId: project.clientId,
                },
              ];
        }),
    [inventory],
  );

  const pending = takeGiteaSignInRequest();
  const request = resolveGiteaSignInRequest({
    rid: search.rid ?? pending.rid,
    broker: search.broker ?? pending.broker,
    known,
  });

  if (status !== "signed-in") {
    if (search.rid !== undefined && search.broker !== undefined) {
      rememberGiteaSignInRequest({ rid: search.rid, broker: search.broker });
    }
    return (
      <ZeropsLandingShell
        description="Sign in to Zerops first, and we will bring you back here."
        title="Sign in to Gitea"
      >
        <Button
          className="w-full"
          onClick={() => {
            rememberSignInReturn();
            window.location.href = startZeropsHandover();
          }}
        >
          Sign in to Zerops
        </Button>
      </ZeropsLandingShell>
    );
  }

  if (!request.ok) {
    return (
      <ZeropsLandingShell
        description={giteaSignInRefusalMessage(request.reason)}
        title="Sign in to Gitea"
      >
        <p className="text-sm text-muted-foreground" data-gitea-signin-refusal={request.reason}>
          Nothing has been sent anywhere.
        </p>
      </ZeropsLandingShell>
    );
  }

  const personName = user?.fullName?.trim() || user?.email || "your Zerops account";

  return (
    <ZeropsLandingShell
      description={`Sign in to ${request.giteaHost} as ${personName}.`}
      title="Sign in to Gitea"
    >
      <div className="space-y-3" data-gitea-signin-consent>
        <Button
          className="w-full"
          disabled={state.kind === "working"}
          onClick={() => {
            setState({ kind: "working" });
            void completeGiteaSignIn({
              brokerUrl: request.brokerOrigin,
              giteaUrl: request.giteaOrigin,
              clientId: request.clientId,
              rid: request.rid,
              nonce: randomUUID(),
              platform: zeropsThrowawayPlatform(client),
              fetch: globalThis.fetch.bind(globalThis),
            })
              .then(({ redirect }) => {
                window.location.assign(redirect);
              })
              .catch((cause: unknown) => {
                setState({
                  kind: "failed",
                  message:
                    cause instanceof MateCredentialError
                      ? cause.message
                      : zeropsErrorMessage(cause),
                });
              });
          }}
        >
          {state.kind === "working" ? "Signing you in…" : "Continue"}
        </Button>
        {state.kind === "failed" ? (
          <p className="text-sm text-destructive-foreground" role="alert">
            {state.message}
          </p>
        ) : null}
      </div>
    </ZeropsLandingShell>
  );
}

import type { ServerAuthBootstrapMethod } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import React, { startTransition, useEffect, useRef, useState, useCallback } from "react";

import { appBasePathHref } from "../../basePath";
import { connectPairing } from "../../connection/onboarding";
import {
  peekPairingTokenFromUrl,
  stripPairingTokenFromUrl,
  submitServerAuthCredential,
} from "../../environments/primary";
import { readHostedPairingRequest } from "../../hostedPairing";
import { MANUAL_LINK_COPY } from "./manualLinkCopy";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import { useAtomCommand } from "../../state/use-atom-command";
import { ZeropsHostedLanding } from "../zerops/landing/ZeropsHostedLanding";
import { ZeropsLandingShell } from "../zerops/landing/ZeropsLandingShell";

/**
 * Every state of a one-time link stands in the same frame as the Zerops
 * sign-in — the lockup in the bar, the live mark, a title, one sentence, a
 * card — so the link lands in the product, not on a page of its own.
 */
export function PairingPendingSurface() {
  return (
    <ZeropsLandingShell
      description={MANUAL_LINK_COPY.pending.description}
      title={MANUAL_LINK_COPY.pending.heading}
    >
      <Spinner className="mx-auto size-5" />
    </ZeropsLandingShell>
  );
}

export function PairingRouteSurface({
  methods,
  onAuthenticated,
}: {
  methods: ReadonlyArray<ServerAuthBootstrapMethod>;
  onAuthenticated: () => void;
}) {
  if (methods.includes("zerops-identity")) {
    return (
      <ZeropsHostedLanding
        manualFallback={
          <ManualPairingRouteSurface methods={[]} onAuthenticated={onAuthenticated} />
        }
      />
    );
  }

  return <ManualPairingRouteSurface methods={methods} onAuthenticated={onAuthenticated} />;
}

function ManualPairingRouteSurface({
  methods,
  onAuthenticated,
}: {
  readonly methods: ReadonlyArray<ServerAuthBootstrapMethod>;
  readonly onAuthenticated: () => void;
}) {
  // Read once, as state, so no ref is read during render.
  const [autoPairToken] = useState(peekPairingTokenFromUrl);
  const [credential, setCredential] = useState(autoPairToken ?? "");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoSubmitAttemptedRef = useRef(false);

  const submitCredential = useCallback(
    async (nextCredential: string) => {
      setIsSubmitting(true);
      setErrorMessage("");

      const submitError = await submitServerAuthCredential(nextCredential).then(
        () => null,
        (error) => errorMessageFromUnknown(error),
      );

      setIsSubmitting(false);

      if (submitError) {
        setErrorMessage(submitError);
        return;
      }

      startTransition(() => {
        onAuthenticated();
      });
    },
    [onAuthenticated],
  );

  const handleSubmit = useCallback(
    async (event?: React.SubmitEvent<HTMLFormElement>) => {
      event?.preventDefault();
      await submitCredential(credential);
    },
    [submitCredential, credential],
  );

  useEffect(() => {
    const token = autoPairToken;
    if (methods.length === 0 || !token || autoSubmitAttemptedRef.current) {
      return;
    }

    autoSubmitAttemptedRef.current = true;
    stripPairingTokenFromUrl();
    void submitCredential(token);
  }, [autoPairToken, methods.length, submitCredential]);

  return (
    <ZeropsLandingShell
      description={MANUAL_LINK_COPY.describeAuthGate(methods)}
      title={
        methods.length === 0
          ? MANUAL_LINK_COPY.credential.unavailableHeading
          : MANUAL_LINK_COPY.credential.heading
      }
    >
      {methods.length === 0 ? (
        <Button className="w-full" onClick={() => window.location.reload()} variant="outline">
          {MANUAL_LINK_COPY.credential.reloadAction}
        </Button>
      ) : (
        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="space-y-2">
            <Label htmlFor="pairing-token">{MANUAL_LINK_COPY.credential.tokenLabel}</Label>
            <Input
              id="pairing-token"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              disabled={isSubmitting}
              nativeInput
              onChange={(event) => setCredential(event.currentTarget.value)}
              placeholder={MANUAL_LINK_COPY.credential.tokenPlaceholder}
              spellCheck={false}
              value={credential}
            />
          </div>

          {errorMessage ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
              {errorMessage}
            </p>
          ) : null}

          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? <Spinner className="size-4" /> : null}
            {isSubmitting
              ? MANUAL_LINK_COPY.credential.submittingAction
              : MANUAL_LINK_COPY.credential.continueAction}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            {MANUAL_LINK_COPY.describeSupportedMethods(methods)}{" "}
            <button
              className="underline underline-offset-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-64"
              disabled={isSubmitting}
              onClick={() => window.location.reload()}
              type="button"
            >
              {MANUAL_LINK_COPY.credential.reloadAction}
            </button>
          </p>
        </form>
      )}
    </ZeropsLandingShell>
  );
}

export function HostedPairingRouteSurface() {
  const connectPairingEnvironment = useAtomCommand(connectPairing, {
    reportFailure: false,
  });
  // The request comes from the URL once; state, so no ref is read during render.
  const [request] = useState(readHostedPairingRequest);
  const [status, setStatus] = useState<"pairing" | "paired" | "error">(
    request ? "pairing" : "error",
  );
  const [message, setMessage] = useState(
    request ? MANUAL_LINK_COPY.hosted.connecting : MANUAL_LINK_COPY.hosted.missingRequest,
  );
  const [canRetry, setCanRetry] = useState(false);
  const submitAttemptedRef = useRef(false);
  const tokenSubmittedRef = useRef(false);

  const submitHostedPairingRequest = useCallback(async () => {
    if (!request) {
      setStatus("error");
      setMessage(MANUAL_LINK_COPY.hosted.missingRequest);
      setCanRetry(false);
      return;
    }

    if (tokenSubmittedRef.current) {
      setStatus("error");
      setMessage(MANUAL_LINK_COPY.hosted.submittedToken);
      setCanRetry(false);
      return;
    }

    setStatus("pairing");
    setMessage(MANUAL_LINK_COPY.hosted.connecting);
    setCanRetry(false);
    tokenSubmittedRef.current = true;

    const result = await connectPairingEnvironment({
      host: request.host,
      pairingCode: request.token,
    });
    if (result._tag === "Success") {
      setStatus("paired");
      setMessage(MANUAL_LINK_COPY.describeSavedEnvironment(request.label));
      return;
    }

    tokenSubmittedRef.current = false;
    setStatus("error");
    setCanRetry(true);
    setMessage(
      MANUAL_LINK_COPY.describeHostedFailure(
        errorMessageFromUnknown(squashAtomCommandFailure(result)),
      ),
    );
  }, [connectPairingEnvironment, request]);

  useEffect(() => {
    if (submitAttemptedRef.current) {
      return;
    }
    submitAttemptedRef.current = true;

    stripPairingTokenFromUrl();
    void submitHostedPairingRequest();
  }, [submitHostedPairingRequest]);

  return (
    <ZeropsLandingShell
      description={message}
      title={
        status === "paired"
          ? MANUAL_LINK_COPY.hosted.pairedHeading
          : status === "error"
            ? MANUAL_LINK_COPY.hosted.errorHeading
            : MANUAL_LINK_COPY.hosted.pendingHeading
      }
    >
      <div className="space-y-4">
        {request ? (
          <p className="text-center text-xs text-muted-foreground">
            {MANUAL_LINK_COPY.hosted.hostLabel}{" "}
            <span className="font-mono text-foreground/80">{request.host}</span>
          </p>
        ) : null}

        {status === "error" ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
            {MANUAL_LINK_COPY.hosted.browserRequirements}
          </p>
        ) : null}

        {status === "pairing" ? <Spinner className="mx-auto size-5" /> : null}
        {canRetry ? (
          <Button className="w-full" onClick={() => void submitHostedPairingRequest()}>
            {MANUAL_LINK_COPY.hosted.retryAction}
          </Button>
        ) : null}
        {status === "paired" ? (
          <Button className="w-full" onClick={() => (window.location.href = appBasePathHref())}>
            {MANUAL_LINK_COPY.hosted.openAction}
          </Button>
        ) : null}
      </div>
    </ZeropsLandingShell>
  );
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return MANUAL_LINK_COPY.unknownAuthenticationError;
}

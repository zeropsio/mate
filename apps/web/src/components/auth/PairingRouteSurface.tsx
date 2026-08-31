import type { ServerAuthBootstrapMethod } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import React, { startTransition, useEffect, useRef, useState, useCallback } from "react";

import { APP_DISPLAY_NAME } from "../../branding";
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
import { useAtomCommand } from "../../state/use-atom-command";
import { ZeropsHostedLanding } from "../zerops/landing/ZeropsHostedLanding";

export function PairingPendingSurface() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-emerald-500)_14%,transparent),transparent)]" />
        <div className="absolute inset-y-0 left-0 w-72 bg-[radial-gradient(28rem_18rem_at_left,color-mix(in_srgb,var(--color-sky-500)_10%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          {MANUAL_LINK_COPY.pending.heading}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {MANUAL_LINK_COPY.pending.description}
        </p>
      </section>
    </div>
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
  const autoPairTokenRef = useRef<string | null>(peekPairingTokenFromUrl());
  const [credential, setCredential] = useState(() => autoPairTokenRef.current ?? "");
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
    const token = autoPairTokenRef.current;
    if (methods.length === 0 || !token || autoSubmitAttemptedRef.current) {
      return;
    }

    autoSubmitAttemptedRef.current = true;
    stripPairingTokenFromUrl();
    void submitCredential(token);
  }, [methods.length, submitCredential]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-emerald-500)_14%,transparent),transparent)]" />
        <div className="absolute inset-y-0 left-0 w-72 bg-[radial-gradient(28rem_18rem_at_left,color-mix(in_srgb,var(--color-sky-500)_10%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          {methods.length === 0
            ? MANUAL_LINK_COPY.credential.unavailableHeading
            : MANUAL_LINK_COPY.credential.heading}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {MANUAL_LINK_COPY.describeAuthGate(methods)}
        </p>

        {methods.length === 0 ? null : (
          <>
            <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="pairing-token">
                  {MANUAL_LINK_COPY.credential.tokenLabel}
                </label>
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
                <div className="rounded-lg border border-destructive/30 bg-destructive/6 px-3 py-2 text-sm text-destructive">
                  {errorMessage}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button disabled={isSubmitting} size="sm" type="submit">
                  {isSubmitting
                    ? MANUAL_LINK_COPY.credential.submittingAction
                    : MANUAL_LINK_COPY.credential.continueAction}
                </Button>
                <Button
                  disabled={isSubmitting}
                  onClick={() => window.location.reload()}
                  size="sm"
                  variant="outline"
                >
                  {MANUAL_LINK_COPY.credential.reloadAction}
                </Button>
              </div>
            </form>

            <div className="mt-6 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
              {MANUAL_LINK_COPY.describeSupportedMethods(methods)}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function HostedPairingRouteSurface() {
  const connectPairingEnvironment = useAtomCommand(connectPairing, {
    reportFailure: false,
  });
  const hostedPairingRequestRef = useRef(readHostedPairingRequest());
  const [status, setStatus] = useState<"pairing" | "paired" | "error">(() =>
    hostedPairingRequestRef.current ? "pairing" : "error",
  );
  const [message, setMessage] = useState(() =>
    hostedPairingRequestRef.current
      ? MANUAL_LINK_COPY.hosted.connecting
      : MANUAL_LINK_COPY.hosted.missingRequest,
  );
  const [canRetry, setCanRetry] = useState(false);
  const submitAttemptedRef = useRef(false);
  const tokenSubmittedRef = useRef(false);

  const submitHostedPairingRequest = useCallback(async () => {
    const request = hostedPairingRequestRef.current;

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
  }, [connectPairingEnvironment]);

  useEffect(() => {
    if (submitAttemptedRef.current) {
      return;
    }
    submitAttemptedRef.current = true;

    stripPairingTokenFromUrl();
    void submitHostedPairingRequest();
  }, [submitHostedPairingRequest]);

  const request = hostedPairingRequestRef.current;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-emerald-500)_14%,transparent),transparent)]" />
        <div className="absolute inset-y-0 left-0 w-72 bg-[radial-gradient(28rem_18rem_at_left,color-mix(in_srgb,var(--color-sky-500)_10%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          {status === "paired"
            ? MANUAL_LINK_COPY.hosted.pairedHeading
            : status === "error"
              ? MANUAL_LINK_COPY.hosted.errorHeading
              : MANUAL_LINK_COPY.hosted.pendingHeading}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>

        {request ? (
          <div className="mt-5 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
            {MANUAL_LINK_COPY.hosted.hostLabel}{" "}
            <span className="font-mono text-foreground/80">{request.host}</span>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/6 px-3 py-2 text-sm text-destructive">
            {MANUAL_LINK_COPY.hosted.browserRequirements}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          {status === "pairing" ? (
            <Button disabled size="sm">
              {MANUAL_LINK_COPY.hosted.submittingAction}
            </Button>
          ) : canRetry ? (
            <Button size="sm" onClick={() => void submitHostedPairingRequest()}>
              {MANUAL_LINK_COPY.hosted.retryAction}
            </Button>
          ) : null}
          {status === "paired" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => (window.location.href = appBasePathHref())}
            >
              {MANUAL_LINK_COPY.hosted.openAction}
            </Button>
          ) : null}
        </div>
      </section>
    </div>
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

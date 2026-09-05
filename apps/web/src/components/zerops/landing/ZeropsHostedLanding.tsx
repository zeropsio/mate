/**
 * What the hosted client shows when nothing is connected yet: sign in or sign
 * up with Zerops, then pick a project. Upstream's manual-connect empty state
 * stays reachable from here — a non-Zerops user is never locked out.
 */

import { isZeropsCaptchaRejection } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useRef, useState, type ReactNode } from "react";

import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { useZeropsTurnstile } from "~/zerops/turnstile";

import { ZeropsProjectsPage } from "../ZeropsProjectsPage";
import { startZeropsHandover } from "~/zerops/handover";
import {
  readZeropsNativeSignInBridge,
  runZeropsNativeSignIn,
  type ZeropsNativeSignInState,
} from "~/zerops/nativeSignIn";

import {
  ZEROPS_GUI_REGISTRATION_URL,
  ZeropsHandedOffBanner,
  ZeropsHandoverActions,
  ZeropsLandingShell,
  ZeropsLandingWait,
  ZeropsPasswordDisclosure,
  ZeropsRegisterForm,
  ZeropsRegistrationUnavailable,
  ZeropsSignInForm,
  ZeropsTotpForm,
} from "./ZeropsLandingShell";

type LandingMode = "sign-in" | "register" | "handed-off";

/** Opens the platform's own sign-up in a new tab, the way a plain link click would. */
function openZeropsSignUpTab(): void {
  window.open(ZEROPS_GUI_REGISTRATION_URL, "_blank", "noopener,noreferrer");
}

export function ZeropsHostedLanding({
  exclusive = false,
  manualFallback,
}: {
  readonly exclusive?: boolean;
  readonly manualFallback: ReactNode;
}) {
  const { status, signIn, register, verifyTotp, adoptHandover } = useZeropsSession();
  const [mode, setMode] = useState<LandingMode>("sign-in");
  const [showManual, setShowManual] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the platform itself refuses the captcha, which is the same dead
  // end as a widget that will not render on this origin.
  const [captchaRefusal, setCaptchaRefusal] = useState<string | null>(null);
  const turnstile = useZeropsTurnstile();
  const [nativeSignInState, setNativeSignInState] = useState<ZeropsNativeSignInState>({
    kind: "idle",
  });
  // Bumped on every new attempt and by Cancel; a resolution that arrives
  // after either must not touch the UI the user has already moved past.
  const nativeSignInGeneration = useRef(0);

  const startNativeSignIn = (input: { readonly intent?: "register" }): boolean => {
    const zeropsSignIn = readZeropsNativeSignInBridge();
    if (!zeropsSignIn) return false;
    const generation = ++nativeSignInGeneration.current;
    void runZeropsNativeSignIn(
      { zeropsSignIn, adoptHandover },
      input,
      setNativeSignInState,
      () => nativeSignInGeneration.current === generation,
    );
    return true;
  };
  const cancelNativeSignIn = () => {
    nativeSignInGeneration.current += 1;
    setNativeSignInState({ kind: "idle" });
  };

  if (showManual && !exclusive) {
    return <>{manualFallback}</>;
  }

  // Signed in: the picker is the landing. It brings its own full-width frame.
  if (status === "signed-in") {
    return <ZeropsProjectsPage />;
  }

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void action()
      .catch((cause: unknown) => {
        if (isZeropsCaptchaRejection(cause)) {
          setCaptchaRefusal(zeropsErrorMessage(cause));
          return;
        }
        setError(zeropsErrorMessage(cause));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const showSignIn = () => {
    setError(null);
    setCaptchaRefusal(null);
    setMode("sign-in");
  };

  const openManual = () => {
    setShowManual(true);
  };
  const manualConnect = exclusive ? undefined : openManual;

  if (status === "loading") {
    // Under a second, usually. Nothing is written that the next frame will
    // replace, so the mark waits with a spinner.
    return (
      <ZeropsLandingWait data-zerops-session-check="true" label="Checking your Zerops session…" />
    );
  }

  if (status === "totp-required") {
    return (
      <ZeropsLandingShell
        title="One more step"
        description="Enter the code from your authenticator app."
        onManualConnect={manualConnect}
      >
        <ZeropsTotpForm
          busy={busy}
          error={error}
          onSubmit={(code) => {
            run(() => verifyTotp(code));
          }}
        />
      </ZeropsLandingShell>
    );
  }

  if (mode === "register") {
    // Either the widget refuses this origin or the platform refused its token;
    // both mean signing up has to happen on Zerops' own page.
    const unavailable =
      captchaRefusal ?? (turnstile.state.status === "unavailable" ? turnstile.state.reason : null);

    return (
      <ZeropsLandingShell
        title="Create a Zerops account"
        description="Your agent runs inside your own Zerops project."
        onManualConnect={manualConnect}
      >
        {unavailable === null ? (
          <ZeropsRegisterForm
            busy={busy}
            error={error}
            captcha={turnstile.widget}
            captchaPending={turnstile.state.status !== "ready"}
            onSubmit={(input) => {
              const token = turnstile.state.token;
              if (token === null) return;
              run(() => register({ ...input, turnstileToken: token }));
            }}
            onSwitchToSignIn={showSignIn}
          />
        ) : (
          <ZeropsRegistrationUnavailable
            reason={unavailable}
            onSignIn={showSignIn}
            onHandOff={() => {
              openZeropsSignUpTab();
              setMode("handed-off");
            }}
          />
        )}
      </ZeropsLandingShell>
    );
  }

  if (mode === "handed-off") {
    return (
      <ZeropsLandingShell
        title="Sign in to Mate"
        description="Pick an environment and start talking to the agent inside it."
        onManualConnect={manualConnect}
      >
        <ZeropsHandedOffBanner onOpenSignUpAgain={openZeropsSignUpTab} />
        <ZeropsSignInForm
          busy={busy}
          error={error}
          onSubmit={({ email, password }) => {
            run(() => signIn(email, password));
          }}
          onSwitchToRegister={() => {
            setError(null);
            setMode("register");
          }}
        />
      </ZeropsLandingShell>
    );
  }

  return (
    <ZeropsLandingShell
      title="Sign in to Mate"
      description="Pick an environment and start talking to the agent inside it."
      onManualConnect={manualConnect}
    >
      <ZeropsPasswordDisclosure
        open={showPasswordForm}
        handover={
          <ZeropsHandoverActions
            onContinue={() => {
              if (startNativeSignIn({})) return;
              // A full-page navigation in this tab, never a new one: the callback
              // reads the nonce back out of this tab's storage.
              window.location.href = startZeropsHandover();
            }}
            onCreateAccount={() => {
              if (startNativeSignIn({ intent: "register" })) return;
              window.location.href = startZeropsHandover({ intent: "register" });
            }}
            nativeSignIn={
              readZeropsNativeSignInBridge()
                ? {
                    busy: nativeSignInState.kind === "busy",
                    error: nativeSignInState.kind === "error" ? nativeSignInState.message : null,
                    onCancel: cancelNativeSignIn,
                  }
                : undefined
            }
          />
        }
        onToggle={() => {
          setError(null);
          setShowPasswordForm((open) => !open);
        }}
      >
        <ZeropsSignInForm
          busy={busy}
          error={error}
          onSubmit={({ email, password }) => {
            run(() => signIn(email, password));
          }}
          onSwitchToRegister={() => {
            setError(null);
            setMode("register");
          }}
        />
      </ZeropsPasswordDisclosure>
    </ZeropsLandingShell>
  );
}

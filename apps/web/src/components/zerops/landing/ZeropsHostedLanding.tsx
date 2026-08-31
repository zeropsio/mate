/**
 * What the hosted client shows when nothing is connected yet: sign in or sign
 * up with Zerops, then pick a project. Upstream's manual-connect empty state
 * stays reachable from here — a non-Zerops user is never locked out.
 */

import { isZeropsCaptchaRejection } from "@t3tools/client-runtime/zerops";
import { useState, type ReactNode } from "react";

import { Spinner } from "../../ui/spinner";
import { useZeropsSession, zeropsErrorMessage } from "~/zerops/ZeropsSessionProvider";
import { useZeropsTurnstile } from "~/zerops/turnstile";

import { ZeropsProjectsPage } from "../ZeropsProjectsPage";
import { startZeropsHandover } from "~/zerops/handover";

import {
  ZEROPS_GUI_REGISTRATION_URL,
  ZeropsHandedOffBanner,
  ZeropsHandoverActions,
  ZeropsLandingShell,
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

export function ZeropsHostedLanding({ manualFallback }: { readonly manualFallback: ReactNode }) {
  const { status, signIn, register, verifyTotp } = useZeropsSession();
  const [mode, setMode] = useState<LandingMode>("sign-in");
  const [showManual, setShowManual] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the platform itself refuses the captcha, which is the same dead
  // end as a widget that will not render on this origin.
  const [captchaRefusal, setCaptchaRefusal] = useState<string | null>(null);
  const turnstile = useZeropsTurnstile();

  if (showManual) {
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

  if (status === "loading") {
    return (
      <ZeropsLandingShell
        title="Zerops Code"
        description="Checking your Zerops session…"
        onManualConnect={openManual}
      >
        <div className="flex justify-center py-4">
          <Spinner className="size-5" />
        </div>
      </ZeropsLandingShell>
    );
  }

  if (status === "totp-required") {
    return (
      <ZeropsLandingShell
        title="One more step"
        description="Enter the code from your authenticator app."
        onManualConnect={openManual}
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
        onManualConnect={openManual}
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
        title="Sign in to Zerops"
        description="Pick a project and start talking to the agent inside it."
        onManualConnect={openManual}
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
      title="Sign in to Zerops"
      description="Pick a project and start talking to the agent inside it."
      onManualConnect={openManual}
    >
      <ZeropsHandoverActions
        onContinue={() => {
          // A full-page navigation in this tab, never a new one: the callback
          // reads the nonce back out of this tab's storage.
          window.location.href = startZeropsHandover();
        }}
        onCreateAccount={() => {
          window.location.href = startZeropsHandover({ intent: "register" });
        }}
      />
      <ZeropsPasswordDisclosure
        open={showPasswordForm}
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

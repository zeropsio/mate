import { useRef, useState } from "react";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { startZeropsHandover } from "~/zerops/handover";
import {
  readZeropsNativeSignInBridge,
  runZeropsNativeSignIn,
  type ZeropsNativeSignInState,
} from "~/zerops/nativeSignIn";
import { ZeropsProjectsPage } from "../ZeropsProjectsPage";
import { ZeropsHandoverActions, ZeropsLandingShell, ZeropsLandingWait } from "./ZeropsLandingShell";

/** Registration and second factors belong to the Zerops account application. */
export function ZeropsHostedLanding() {
  const { status, adoptHandover, signOut } = useZeropsSession();
  const [nativeState, setNativeState] = useState<ZeropsNativeSignInState>({ kind: "idle" });
  const generation = useRef(0);
  if (status === "signed-in") return <ZeropsProjectsPage />;
  if (status === "loading") return <ZeropsLandingWait label="Checking your Zerops account…" />;
  if (status === "unavailable")
    return (
      <ZeropsLandingShell
        title="Could not verify your account"
        description="Zerops is currently unreachable. Your saved work is still on this device."
      >
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </button>
      </ZeropsLandingShell>
    );
  const start = (intent?: "register") => {
    const zeropsSignIn = readZeropsNativeSignInBridge();
    if (!zeropsSignIn) {
      window.location.href = startZeropsHandover(intent ? { intent } : {});
      return;
    }
    const attempt = ++generation.current;
    void runZeropsNativeSignIn(
      { zeropsSignIn, adoptHandover },
      intent ? { intent } : {},
      setNativeState,
      () => generation.current === attempt,
    );
  };
  return (
    <ZeropsLandingShell
      title="Sign in to Mate"
      description="Sign in with your Zerops account to open your projects."
    >
      <ZeropsHandoverActions
        onContinue={() => start()}
        onCreateAccount={() => start("register")}
        nativeSignIn={
          readZeropsNativeSignInBridge()
            ? {
                busy: nativeState.kind === "busy",
                error: nativeState.kind === "error" ? nativeState.message : null,
                onCancel: () => {
                  generation.current += 1;
                  setNativeState({ kind: "idle" });
                },
              }
            : undefined
        }
      />
    </ZeropsLandingShell>
  );
}

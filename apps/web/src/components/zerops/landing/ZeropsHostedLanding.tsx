import { lazy, Suspense, useRef, useState } from "react";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { startZeropsHandover } from "~/zerops/handover";
import {
  readZeropsNativeSignInBridge,
  runZeropsNativeSignIn,
  type ZeropsNativeSignInState,
} from "~/zerops/nativeSignIn";
import { SurfaceLoading } from "../../SurfaceLoading";
import { ZeropsFrameWait, ZeropsHandoverActions, ZeropsLandingShell } from "./ZeropsLandingShell";

const ZeropsProjectsPage = lazy(() =>
  import("../ZeropsProjectsPage").then((module) => ({ default: module.ZeropsProjectsPage })),
);

/** Registration and second factors belong to the Zerops account application. */
export function ZeropsHostedLanding() {
  const { status, adoptHandover, signOut, verifyAgain, retrying } = useZeropsSession();
  const [nativeState, setNativeState] = useState<ZeropsNativeSignInState>({ kind: "idle" });
  const generation = useRef(0);
  if (status === "signed-in")
    return (
      <Suspense fallback={<SurfaceLoading />}>
        <ZeropsProjectsPage />
      </Suspense>
    );
  if (status === "loading")
    return <ZeropsFrameWait label="Checking your Zerops account…" signedIn={false} />;
  if (status === "unavailable")
    return (
      <ZeropsLandingShell
        title="Could not verify your account"
        description="Zerops is currently unreachable. Your saved work is still on this device."
      >
        <button type="button" onClick={verifyAgain}>
          Verify again
        </button>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </button>
        {/* A background retry speaks here, in room the line always holds: nothing moves. */}
        <p className="min-h-4 text-center text-xs text-muted-foreground" aria-live="polite">
          {retrying === true ? "Trying again…" : null}
        </p>
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

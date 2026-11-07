import { Button } from "../../ui/button";
import { useRef, useState } from "react";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { startZeropsHandover } from "~/zerops/handover";
import {
  readZeropsNativeSignInBridge,
  readZeropsNativeSignInProgress,
  runZeropsNativeSignIn,
  type ZeropsNativeSignInState,
} from "~/zerops/nativeSignIn";
import { ZeropsProjectsPage } from "../ZeropsProjectsPage";
import { ZeropsFrameWait, ZeropsHandoverActions, ZeropsLandingShell } from "./ZeropsLandingShell";

/** Registration and second factors belong to the Zerops account application. */
export function ZeropsHostedLanding() {
  const { status, adoptHandover, adoptDeviceLogin, signOut, verifyAgain, retrying, zeropsHq } =
    useZeropsSession();
  const [nativeState, setNativeState] = useState<ZeropsNativeSignInState>({ kind: "idle" });
  const generation = useRef(0);
  if (status === "signed-in") return <ZeropsProjectsPage />;
  if (status === "loading")
    return <ZeropsFrameWait label="Checking your Zerops account…" signedIn={false} />;
  if (status === "unavailable")
    return (
      <ZeropsLandingShell
        title="Could not verify your account"
        description="Account verification failed. Try again to check your access."
      >
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={verifyAgain}>Verify again</Button>
          <Button
            variant="secondary"
            onClick={() => {
              void signOut();
            }}
          >
            Sign out
          </Button>
        </div>
        {/* A background retry speaks here, in room the line always holds: nothing moves. */}
        <p className="min-h-4 text-center text-xs text-muted-foreground" aria-live="polite">
          {retrying === true ? "Trying again…" : null}
        </p>
      </ZeropsLandingShell>
    );
  const start = (intent?: "register") => {
    const zeropsSignIn = readZeropsNativeSignInBridge();
    // Runs on the click: where HQ's bridge refuses this origin, its device login opens a window.
    if (!zeropsSignIn && zeropsHq !== null) {
      zeropsHq.signIn(intent);
      return;
    }
    if (!zeropsSignIn) {
      window.location.href = startZeropsHandover(intent ? { intent } : {});
      return;
    }
    const attempt = ++generation.current;
    void runZeropsNativeSignIn(
      {
        zeropsSignIn,
        onProgress: readZeropsNativeSignInProgress(),
        adoptHandover,
        adoptDeviceLogin,
      },
      intent ? { intent } : {},
      setNativeState,
      () => generation.current === attempt,
    );
  };
  return (
    <ZeropsLandingShell
      title="Sign in to Mate"
      description="Mates are coding agents that build and ship your apps on Zerops."
    >
      <ZeropsHandoverActions
        onContinue={() => start()}
        onCreateAccount={() => start("register")}
        nativeSignIn={
          readZeropsNativeSignInBridge()
            ? {
                busy: nativeState.kind === "busy",
                userCode: nativeState.kind === "busy" ? (nativeState.userCode ?? null) : null,
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

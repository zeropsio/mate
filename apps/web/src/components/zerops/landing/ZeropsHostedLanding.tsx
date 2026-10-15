import { Button } from "../../ui/button";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useEffect, useRef, useState } from "react";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import {
  runZeropsDeviceLogin,
  zeropsSignInMode,
  type ZeropsDeviceLoginRun,
  type ZeropsDeviceLoginStage,
} from "~/zerops/deviceLogin";
import { startZeropsHandover } from "~/zerops/handover";
import { dismissZeropsHqSignIn, retryZeropsHqSignIn, useZeropsHqSignIn } from "~/zerops/hqSignIn";
import {
  readZeropsNativeSignInBridge,
  readZeropsNativeSignInProgress,
  runZeropsNativeSignIn,
  type ZeropsNativeSignInState,
} from "~/zerops/nativeSignIn";
import { ZeropsProjectsPage } from "../ZeropsProjectsPage";
import { ZeropsDeviceLoginWait } from "./ZeropsDeviceLoginWait";
import { ZeropsHandoverFailed } from "./ZeropsHandoverFailed";
import { ZeropsFrameWait, ZeropsHandoverActions, ZeropsLandingShell } from "./ZeropsLandingShell";

type Intent = "register" | undefined;

/** A device login on this landing: the Zerops window open, the account opening, or a failure. */
type DeviceLoginState =
  | { readonly kind: "idle" }
  | { readonly kind: "waiting"; readonly stage: ZeropsDeviceLoginStage }
  | { readonly kind: "adopting" }
  | { readonly kind: "failed"; readonly message: string; readonly intent: Intent };

const DEVICE_LOGIN_ENDED: Record<"denied" | "expired", string> = {
  denied: "Sign-in was cancelled.",
  expired: "The Zerops window timed out. Start again.",
};

/** Registration and second factors belong to the Zerops account application. */
export function ZeropsHostedLanding() {
  const { client, status, adoptHandover, adoptDeviceLogin, signOut, verifyAgain, retrying } =
    useZeropsSession();
  const [nativeState, setNativeState] = useState<ZeropsNativeSignInState>({ kind: "idle" });
  const [device, setDevice] = useState<DeviceLoginState>({ kind: "idle" });
  // A trip through HQ from its Mate card (`hqSignIn.ts`), run beside the session check.
  const hq = useZeropsHqSignIn();
  const generation = useRef(0);
  const deviceRun = useRef<ZeropsDeviceLoginRun | null>(null);
  // Signed in — here, or by another tab — the Zerops window has nothing left to answer.
  useEffect(() => {
    if (status !== "signed-in") return;
    deviceRun.current?.cancel();
    setDevice({ kind: "idle" });
  }, [status]);
  useEffect(() => () => deviceRun.current?.cancel(), []);
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
  if (hq.kind === "running")
    return <ZeropsFrameWait label="Signing you in…" line="Signing you in…" signedIn={false} />;
  if (hq.kind === "failed")
    return (
      <ZeropsHandoverFailed
        message={hq.message}
        onBack={dismissZeropsHqSignIn}
        onRetry={() => retryZeropsHqSignIn({ apiBase: client.baseUrl, adopt: adoptDeviceLogin })}
      />
    );
  // Runs on the click: the Zerops window must open before anything is awaited.
  const startDeviceLogin = (intent: Intent) => {
    deviceRun.current?.cancel();
    const attempt = ++generation.current;
    const current = () => generation.current === attempt;
    const run = runZeropsDeviceLogin({
      kind: "login",
      apiBase: client.baseUrl,
      ...(intent ? { intent } : {}),
      onStage: (stage) => {
        if (current()) setDevice({ kind: "waiting", stage });
      },
    });
    deviceRun.current = run;
    void run.outcome
      .then(async (outcome) => {
        if (!current()) return;
        if (outcome.kind === "cancelled") return setDevice({ kind: "idle" });
        if (outcome.kind !== "approved")
          return setDevice({ kind: "failed", message: DEVICE_LOGIN_ENDED[outcome.kind], intent });
        if (outcome.session === null)
          throw new Error("Zerops approved the sign-in without a session.");
        setDevice({ kind: "adopting" });
        await adoptDeviceLogin(outcome.session);
      })
      .catch((cause: unknown) => {
        if (current()) setDevice({ kind: "failed", message: zeropsErrorMessage(cause), intent });
      });
  };
  if (device.kind === "adopting")
    return <ZeropsFrameWait label="Signing you in…" line="Signing you in…" signedIn />;
  if (device.kind === "failed")
    return (
      <ZeropsHandoverFailed
        message={device.message}
        onBack={() => setDevice({ kind: "idle" })}
        onRetry={() => startDeviceLogin(device.intent)}
      />
    );
  const start = (intent?: "register") => {
    const zeropsSignIn = readZeropsNativeSignInBridge();
    if (!zeropsSignIn && zeropsSignInMode() === "device-login") {
      startDeviceLogin(intent);
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
      {device.kind === "waiting" ? (
        <ZeropsDeviceLoginWait
          stage={device.stage}
          onReopen={() => deviceRun.current?.reopen()}
          onCancel={() => {
            generation.current += 1;
            deviceRun.current?.cancel();
            setDevice({ kind: "idle" });
          }}
        />
      ) : (
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
      )}
    </ZeropsLandingShell>
  );
}

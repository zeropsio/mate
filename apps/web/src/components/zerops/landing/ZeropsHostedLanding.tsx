import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { useRef, useState, useSyncExternalStore } from "react";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { zeropsHqLoginUrl, type ZeropsHqPrompt, type ZeropsHqPrompts } from "~/zerops/zeropsHq";
import { startZeropsHandover } from "~/zerops/handover";
import {
  readZeropsNativeSignInBridge,
  readZeropsNativeSignInProgress,
  runZeropsNativeSignIn,
  type ZeropsNativeSignInState,
} from "~/zerops/nativeSignIn";
import { ZeropsProjectsPage } from "../ZeropsProjectsPage";
import { ZeropsDeviceLoginWait } from "./ZeropsDeviceLoginWait";
import {
  ZeropsFrameWait,
  ZeropsHandoverActions,
  ZeropsHqSignInFrame,
  ZeropsLandingShell,
} from "./ZeropsLandingShell";

const CLOSED: ZeropsHqPrompt = { kind: "closed" };
const noPrompts = () => () => undefined;

/**
 * How tall HQ's login and sign-up stand in the landing's card, their heading included: the frame's
 * height until HQ's page says its own, so the card seldom moves when it does.
 */
const HQ_FIRST_HEIGHT = { login: 726, register: 936 } as const;

const TITLE = "Sign in to Mate";
const DESCRIPTION = "Mates are coding agents that build and ship your apps on Zerops.";

/** Registration and second factors belong to the Zerops account application. */
export function ZeropsHostedLanding() {
  const { status, adoptHandover, adoptDeviceLogin, signOut, verifyAgain, retrying, zeropsHq } =
    useZeropsSession();
  const [nativeState, setNativeState] = useState<ZeropsNativeSignInState>({ kind: "idle" });
  const generation = useRef(0);
  const prompt = useSyncExternalStore(
    zeropsHq?.subscribe ?? noPrompts,
    zeropsHq?.state ?? (() => CLOSED),
  );
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
  // HQ's sign-in, out by itself where HQ's bridge serves Mate, or from a click in a device login.
  if (zeropsHq !== null && prompt.kind === "sign-in") {
    if (
      prompt.embedded &&
      (prompt.phase === "starting" || prompt.phase === "framed" || prompt.phase === "shown")
    )
      return (
        <ZeropsHqSignInFrame
          src={prompt.frame}
          shown={prompt.phase === "shown"}
          height={prompt.frameHeight ?? HQ_FIRST_HEIGHT[prompt.intent ?? "login"]}
        />
      );
    return (
      <ZeropsLandingShell title={TITLE} description={DESCRIPTION}>
        <ZeropsHqSignInState prompts={zeropsHq} prompt={prompt} />
      </ZeropsLandingShell>
    );
  }
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
    <ZeropsLandingShell title={TITLE} description={DESCRIPTION}>
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

/** HQ's sign-in where it isn't HQ's page in the card: a device login's wait, or why it didn't start. */
function ZeropsHqSignInState({
  prompts,
  prompt,
}: {
  readonly prompts: ZeropsHqPrompts;
  readonly prompt: Exclude<ZeropsHqPrompt, { kind: "closed" }>;
}) {
  switch (prompt.phase) {
    case "waiting":
      return prompt.progress === null ? (
        <Spinner size="lg" className="mx-auto" />
      ) : (
        <ZeropsDeviceLoginWait
          progress={prompt.progress}
          onReopen={prompts.reopen}
          onCancel={prompts.close}
        />
      );
    case "unreachable":
      return (
        <div className="space-y-4 text-center">
          <p className="text-sm font-medium" role="alert">
            Can't reach Zerops HQ.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={prompts.retry}>Try again</Button>
            <Button
              variant="secondary"
              render={<a href={zeropsHqLoginUrl(window.location.href)} />}
            >
              Go to Zerops HQ
            </Button>
          </div>
        </div>
      );
    case "failed":
      return (
        <div className="space-y-4 text-center">
          <p className="text-sm" role="alert">
            {prompt.failure}
          </p>
          <Button onClick={prompts.retry}>Try again</Button>
        </div>
      );
    default:
      return <Spinner size="lg" className="mx-auto" />;
  }
}

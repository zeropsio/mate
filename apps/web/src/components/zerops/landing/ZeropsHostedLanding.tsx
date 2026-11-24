import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { useSyncExternalStore } from "react";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { zeropsHqLoginUrl, type ZeropsHqPrompt, type ZeropsHqPrompts } from "~/zerops/zeropsHq";
import { ZeropsProjectsPage } from "../ZeropsProjectsPage";
import { ZeropsDeviceLoginWait } from "./ZeropsDeviceLoginWait";
import {
  ZeropsFrameWait,
  ZeropsHqSignInFrame,
  ZeropsLandingShell,
  ZeropsSignInActions,
} from "./ZeropsLandingShell";

/**
 * How tall HQ's login and sign-up stand in the landing's card, their heading included: the frame's
 * height until HQ's page says its own, so the card seldom moves when it does.
 */
const HQ_FIRST_HEIGHT = { login: 726, register: 936 } as const;

const TITLE = "Sign in to Mate";
const DESCRIPTION = "Mates are coding agents that build and ship your apps on Zerops.";

/** Registration and second factors belong to the Zerops account application. */
export function ZeropsHostedLanding() {
  const { status, signOut, verifyAgain, retrying, zeropsHq } = useZeropsSession();
  // A server render reads the prompt as the browser would: nothing differs before hydration.
  const prompt = useSyncExternalStore(zeropsHq.subscribe, zeropsHq.state, zeropsHq.state);
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
        <p className="min-h-4 text-center text-caption text-muted-foreground" aria-live="polite">
          {retrying === true ? "Trying again…" : null}
        </p>
      </ZeropsLandingShell>
    );
  // HQ's sign-in, out by itself where HQ's bridge serves Mate, or from a click in a device login.
  if (prompt.kind === "sign-in") {
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
  // Runs on the click: where HQ's bridge refuses this origin, its device login opens a window.
  const start = (intent?: "register") => zeropsHq.signIn(intent);
  return (
    <ZeropsLandingShell title={TITLE} description={DESCRIPTION}>
      <ZeropsSignInActions onContinue={() => start()} onCreateAccount={() => start("register")} />
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
          <p className="text-body font-medium" role="alert">
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
          <p className="text-body" role="alert">
            {prompt.failure}
          </p>
          <Button onClick={prompts.retry}>Try again</Button>
        </div>
      );
    default:
      return <Spinner size="lg" className="mx-auto" />;
  }
}

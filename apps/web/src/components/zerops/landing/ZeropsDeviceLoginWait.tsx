/**
 * The sign-in while the person finishes in the Zerops window. The window may hide behind this
 * one, close, or never open (a popup blocker): each has a way on from here, and Cancel is the
 * way back. The code is named as the one to expect: signed out, the window asks the person to
 * log in or sign up first, and Zerops may then let them in without showing a code at all. Once the
 * request was renewed under an open window, that window may hold the lapsed one: the card says the
 * code may have changed and offers opening it again first.
 */
import { Spinner } from "../../ui/spinner";
import { Button, InlineButton } from "../../ui/button";
import type { ZeropsDeviceLoginStage } from "~/zerops/deviceLogin";

export function ZeropsDeviceLoginWait({
  stage,
  onReopen,
  onCancel,
}: {
  readonly stage: ZeropsDeviceLoginStage;
  readonly onReopen: () => void;
  readonly onCancel: () => void;
}) {
  const blocked = stage.kind === "waiting" && stage.blocked;
  const older = stage.kind === "waiting" && stage.windowMayBeOlder;
  return (
    <div
      className="space-y-3 text-center"
      data-zerops-device-login={blocked ? "blocked" : "waiting"}
    >
      {blocked ? (
        <>
          <p className="text-sm text-muted-foreground">
            Your browser kept the Zerops window from opening.
          </p>
          <Button className="w-full" render={<a href={stage.url} rel="noopener" target="_blank" />}>
            Continue in Zerops
          </Button>
        </>
      ) : older ? (
        <>
          <p className="text-sm text-muted-foreground">
            The sign-in was renewed, so the code in the Zerops window may have changed.
          </p>
          <Button className="w-full" onClick={onReopen}>
            Reopen the Zerops window
          </Button>
        </>
      ) : (
        <>
          <Spinner size="lg" className="mx-auto" />
          <p className="text-sm text-muted-foreground">Finish in the Zerops window.</p>
        </>
      )}
      {/* The code's line is held from the first frame: its arrival a moment later moves nothing. */}
      <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
        {stage.kind === "waiting" ? (
          <>
            {older ? "The code is now " : "If Zerops shows a code, it's "}
            <span className="font-mono text-foreground">{stage.userCode}</span>
          </>
        ) : null}
      </p>
      <p className="space-x-3 text-xs text-muted-foreground">
        {stage.kind === "waiting" && !blocked && !older ? (
          <InlineButton tone="muted" onClick={onReopen}>
            Reopen the Zerops window
          </InlineButton>
        ) : null}
        <InlineButton tone="muted" onClick={onCancel}>
          Cancel sign-in
        </InlineButton>
      </p>
    </div>
  );
}

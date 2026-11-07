/**
 * The sign-in while the person finishes in the Zerops window. The window may hide behind this
 * one, close, or never open (a popup blocker): each has a way on from here, and Cancel is the
 * way back. The code is named as the one to expect: signed out, the window asks the person to
 * log in or sign up first, and Zerops may then let them in without showing a code at all.
 */
import type { DeviceLoginProgress } from "@zerops/session/session.device-login";

import { Spinner } from "../../ui/spinner";
import { Button, InlineButton } from "../../ui/button";

export function ZeropsDeviceLoginWait({
  progress,
  onReopen,
  onCancel,
}: {
  readonly progress: DeviceLoginProgress;
  readonly onReopen: () => void;
  readonly onCancel: () => void;
}) {
  const closed = !progress.windowOpen;
  return (
    <div
      className="space-y-3 text-center"
      data-zerops-device-login={closed ? "blocked" : "waiting"}
    >
      {closed ? (
        <>
          <p className="text-sm text-muted-foreground">The Zerops window isn't open.</p>
          <Button
            className="w-full"
            render={<a href={progress.consentUrl} rel="noopener" target="_blank" />}
          >
            Continue in Zerops
          </Button>
        </>
      ) : (
        <>
          <Spinner size="lg" className="mx-auto" />
          <p className="text-sm text-muted-foreground">Finish in the Zerops window.</p>
        </>
      )}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        If Zerops shows a code, it's{" "}
        <span className="block pt-1 font-mono text-2xl font-medium tracking-widest text-foreground">
          {progress.userCode}
        </span>
      </p>
      <p className="space-x-3 text-xs text-muted-foreground">
        {closed ? null : (
          <InlineButton tone="muted" onClick={onReopen}>
            Reopen the Zerops window
          </InlineButton>
        )}
        <InlineButton tone="muted" onClick={onCancel}>
          Cancel sign-in
        </InlineButton>
      </p>
    </div>
  );
}

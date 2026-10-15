/**
 * The sign-in while the person finishes in the Zerops window. The window may hide behind this
 * one, close, or never open (a popup blocker): each has a way on from here, and Cancel is the
 * way back. The code is named as the one to expect: signed out, the window asks the person to
 * log in or sign up first, and Zerops may then let them in without showing a code at all.
 */
import { Spinner } from "../../ui/spinner";
import { Button } from "../../ui/button";
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
      ) : (
        <>
          <Spinner size="lg" className="mx-auto" />
          <p className="text-sm text-muted-foreground">Finish in the Zerops window.</p>
        </>
      )}
      {stage.kind === "waiting" ? (
        <p className="text-xs text-muted-foreground">
          If Zerops shows a code, it's{" "}
          <span className="font-mono text-foreground">{stage.userCode}</span>
        </p>
      ) : null}
      <p className="space-x-3 text-xs text-muted-foreground">
        {stage.kind === "waiting" && !blocked ? (
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={onReopen}
          >
            Open it again
          </button>
        ) : null}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={onCancel}
        >
          Cancel
        </button>
      </p>
    </div>
  );
}

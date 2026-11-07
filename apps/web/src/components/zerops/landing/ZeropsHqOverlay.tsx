/**
 * Zerops HQ's pages over Mate, in a `zerops-hq` build: its sign-in, and its sudo prompt for a reveal
 * that needs one (`zeropsHq.ts`). Where HQ's bridge refuses this origin, it is a device login's wait
 * instead, while the person answers in the Zerops window.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

import type { ZeropsHqPrompt, ZeropsHqPrompts } from "~/zerops/zeropsHq";
import { zeropsHqLoginUrl } from "~/zerops/zeropsHq";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";

import { Button } from "../../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../../ui/dialog";
import { Spinner } from "../../ui/spinner";
import { ZeropsDeviceLoginWait } from "./ZeropsDeviceLoginWait";

const CLOSED: ZeropsHqPrompt = { kind: "closed" };
const noPrompts = () => () => undefined;

export function ZeropsHqOverlay() {
  const prompts = useZeropsSessionOptional()?.zeropsHq ?? null;
  const prompt = useSyncExternalStore(
    prompts?.subscribe ?? noPrompts,
    prompts?.state ?? (() => CLOSED),
  );
  if (prompts === null || prompt.kind === "closed") return null;
  return <ZeropsHqPanel prompts={prompts} prompt={prompt} />;
}

function ZeropsHqPanel({
  prompts,
  prompt,
}: {
  readonly prompts: ZeropsHqPrompts;
  readonly prompt: Exclude<ZeropsHqPrompt, { kind: "closed" }>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const shown = prompt.phase === "shown";
  // Chromium refuses HQ's passkey prompt to a page without focus, and the keyboard works there.
  useEffect(() => {
    if (shown) frame.current?.focus();
  }, [shown]);
  const sudo = prompt.kind === "sudo";
  const sizes = prompts.frameSizes();
  const size = sizes === null ? null : sudo ? sizes.sudo : sizes.signIn;
  const framing = prompt.frame !== null && (prompt.phase === "framed" || shown);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !prompt.busy) prompts.close();
      }}
    >
      <DialogPopup
        className="max-w-fit"
        showCloseButton={!prompt.busy}
        placement="center"
        bottomStickOnMobile={false}
      >
        <DialogTitle className="sr-only">
          {sudo ? "Confirm it's you" : "Sign in with Zerops"}
        </DialogTitle>
        {framing ? (
          <div
            className="relative max-h-[calc(100dvh-3rem)] max-w-[calc(100vw-3rem)]"
            style={size === null ? undefined : { width: size.width, height: size.height }}
          >
            {shown ? null : <Spinner size="lg" className="absolute inset-0 m-auto" />}
            {/* The address is HQ's, built by the session package from this build's own settings. */}
            <iframe
              ref={frame}
              className={shown ? "size-full" : "invisible size-full"}
              src={prompt.frame ?? undefined}
              title={sudo ? "Confirm it's you" : "Sign in with Zerops"}
              allow="publickey-credentials-get; publickey-credentials-create; clipboard-write"
            />
          </div>
        ) : (
          <div className="w-sm max-w-full space-y-4 p-6 text-center">
            <ZeropsHqBody prompts={prompts} prompt={prompt} />
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
}

function ZeropsHqBody({
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
        <>
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
        </>
      );
    case "failed":
      return (
        <>
          <p className="text-sm" role="alert">
            {prompt.failure}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={prompts.retry}>Try again</Button>
            <Button variant="secondary" onClick={prompts.close}>
              Close
            </Button>
          </div>
        </>
      );
    default:
      return <Spinner size="lg" className="mx-auto" />;
  }
}
